import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import { balancedAssignmentFingerprint, BALANCED_ASSIGNMENT_CANDIDATES, BalancedAssignmentError, type BalancedAssignmentCommit, type BalancedAssignmentDecision, type BalancedAssignmentOutcome } from '../types/balanced-assignment';
import { staffMutationStatements } from './staff-ticket-mutation.repository';
import { budgetGrantOperationStatements } from './budget-commit-fence';
import { auditedTicketUpdateStatements } from './conversation-audit.repository';
import { operatorCapacityLoadSql } from './operator-capacity-predicate';
import { ticketQueuePredicate } from './ticket-queue-predicate';
import type { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import type { OperatorActivityRepository } from './operator-activity.repository';
/** Bound the available policy pool before joins/filtering. Oversized pools never produce sampled winners. */
export const BALANCED_ASSIGNMENT_DECISION_SQL = `WITH
 target AS MATERIALIZED (SELECT t.id,t.tenant_id,t.group_id FROM tickets t WHERE t.tenant_id=? AND t.id=? AND t.assigned_to IS NULL AND (t.group_id IS NULL OR length(CAST(t.group_id AS BLOB))<=128) AND ${ticketQueuePredicate('actionable', 't').sql}),
 pool AS MATERIALIZED (SELECT p.user_id,p.revision,p.assignment_ceiling FROM operator_capacity p INDEXED BY idx_operator_capacity_available
   WHERE p.tenant_id=? AND p.availability='available' ORDER BY p.user_id COLLATE BINARY LIMIT ${BALANCED_ASSIGNMENT_CANDIDATES + 1}),
 eligible AS MATERIALIZED (SELECT p.user_id,p.revision,p.assignment_ceiling,COALESCE(r.sequence,0) AS last_sequence,
   ${operatorCapacityLoadSql('t.tenant_id', 'p.user_id')} AS current_work
   FROM pool p JOIN target t JOIN users u ON u.tenant_id=t.tenant_id AND u.id=p.user_id
   LEFT JOIN operator_routing_sequence r ON r.tenant_id=t.tenant_id AND r.user_id=p.user_id
   WHERE (SELECT count(*) FROM pool)<=${BALANCED_ASSIGNMENT_CANDIDATES} AND p.assignment_ceiling>0 AND u.role IN ('admin','agent')
     AND (t.group_id IS NULL OR EXISTS(SELECT 1 FROM user_groups g WHERE g.tenant_id=t.tenant_id AND g.user_id=u.id AND g.group_id=t.group_id))),
 winner AS MATERIALIZED (SELECT user_id,revision FROM eligible WHERE current_work<assignment_ceiling
   ORDER BY current_work,last_sequence,user_id COLLATE BINARY LIMIT 1)
 SELECT t.group_id AS groupId,(SELECT count(*) FROM pool) AS candidateCount,
   EXISTS(SELECT 1 FROM pool WHERE length(CAST(user_id AS BLOB)) NOT BETWEEN 1 AND 128 OR user_id GLOB '*[^A-Za-z0-9._:-]*' OR substr(user_id,1,1) NOT GLOB '[A-Za-z0-9]') AS unsupportedPool,
   (SELECT user_id FROM winner) AS ownerId,(SELECT revision FROM winner) AS policyRevision,
   COALESCE((SELECT sequence FROM tenant_routing_sequence WHERE tenant_id=t.tenant_id),0) AS sequence FROM target t`;
export class BalancedAssignmentRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope, private readonly activity: OperatorActivityRepository, private readonly beta?: LocalBetaAdmissionRepository) { }
  private async verify(commit: BalancedAssignmentCommit) {
    // Fixed operation envelope plus bounded grant identities keeps the new journal row inside its stock allowance.
    if (new TextEncoder().encode(JSON.stringify(commit.authority.grant?.operationEnvelope ?? {})).length > 2048)
      throw new BalancedAssignmentError(503, 'routing_unavailable');
    if (commit.payloadHash !== await balancedAssignmentFingerprint(this.scope.tenantId, this.scope.actorId, commit.ticketId, commit.keyHash))
      throw new BalancedAssignmentError(403, 'routing_denied');
  }
  private guard(commit: BalancedAssignmentCommit): D1PreparedStatement[] {
    if (commit.credential.tenantId !== this.scope.tenantId || commit.credential.actorId !== this.scope.actorId
      || commit.authority.operationId !== commit.operationId || commit.authority.operationFingerprint !== commit.payloadHash
      || commit.requirements.readTicketId !== commit.ticketId)
      throw new BalancedAssignmentError(403, 'routing_denied');
    const grant = commit.authority.grant;
    if (!grant || grant.tenantId !== this.scope.tenantId || grant.operationId !== commit.operationId || grant.operationFingerprint !== commit.payloadHash)
      throw new BalancedAssignmentError(403, 'routing_denied');
    return [...staffMutationStatements(this.db, this.scope, { credential: commit.credential, requirements: commit.requirements, authority: commit.authority }),
    this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) SELECT ?,CASE WHEN NOT EXISTS
     (SELECT 1 FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?) AND EXISTS
    (SELECT 1 FROM tickets t WHERE t.tenant_id=? AND t.id=? AND NOT EXISTS(SELECT 1 FROM ticket_cleanup_claims cc WHERE cc.tenant_id=t.tenant_id AND cc.ticket_id=t.id) AND (?='admin' OR t.group_id IS NULL OR EXISTS
     (SELECT 1 FROM user_groups g WHERE g.tenant_id=t.tenant_id AND g.user_id=? AND g.group_id=t.group_id))) THEN 1 ELSE 0 END
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId, this.scope.tenantId, grant.reservationId, grant.holderId, this.scope.tenantId, commit.ticketId, commit.credential.role, this.scope.actorId)];
  }
  async replay(commit: BalancedAssignmentCommit): Promise<BalancedAssignmentOutcome | null> {
    await this.verify(commit);
    const results = await this.db.batch([...this.guard(commit), this.db.prepare(`SELECT payload_hash,lifecycle,outcome,owner_id,sequence FROM balanced_assignment_receipts
   WHERE tenant_id=? AND actor_id=? AND key_hash=? AND expires_at>unixepoch()`)
      .bind(this.scope.tenantId, this.scope.actorId, commit.keyHash)]);
    const row = results.at(-1)?.results[0] as {
      payload_hash: string;
      lifecycle: 'completed' | 'gone';
      outcome: 'assigned' | 'no_capacity' | null;
      owner_id: string | null;
      sequence: number;
    } | undefined;
    if (!row)
      return null;
    if (row.payload_hash !== commit.payloadHash)
      throw new BalancedAssignmentError(409, 'idempotency_conflict');
    if (row.lifecycle === 'gone')
      throw new BalancedAssignmentError(410, 'routing_result_gone');
    if (row.outcome !== 'assigned' && row.outcome !== 'no_capacity')
      throw new BalancedAssignmentError(503, 'routing_unavailable');
    return { outcome: row.outcome, ownerId: row.owner_id, sequence: row.sequence, replayed: true };
  }
  async completeReplay(commit: BalancedAssignmentCommit): Promise<void> {
    await this.verify(commit);
    await this.db.batch([...this.guard(commit), ...budgetGrantOperationStatements(this.db, this.scope, commit.authority)]);
  }
  async decide(commit: BalancedAssignmentCommit): Promise<BalancedAssignmentDecision> {
    await this.verify(commit);
    const results = await this.db.batch([...this.guard(commit), this.db.prepare(BALANCED_ASSIGNMENT_DECISION_SQL).bind(this.scope.tenantId, commit.ticketId, this.scope.tenantId)]);
    const row = results.at(-1)?.results[0] as BalancedAssignmentDecision | undefined;
    if (!row)
      throw new BalancedAssignmentError(409, 'routing_ticket_changed');
    if (row.unsupportedPool !== 0 || row.candidateCount > BALANCED_ASSIGNMENT_CANDIDATES || !Number.isSafeInteger(row.sequence) || row.sequence >= Number.MAX_SAFE_INTEGER)
      throw new BalancedAssignmentError(503, 'routing_unavailable');
    return row;
  }
  async commit(commit: BalancedAssignmentCommit, decision: BalancedAssignmentDecision, now: string): Promise<BalancedAssignmentOutcome> {
    await this.verify(commit);
    if (decision.unsupportedPool !== 0 || decision.candidateCount > BALANCED_ASSIGNMENT_CANDIDATES || decision.sequence >= Number.MAX_SAFE_INTEGER)
      throw new BalancedAssignmentError(503, 'routing_unavailable');
    const tid = this.scope.tenantId, owner = decision.ownerId;
    const statements = this.guard(commit);
    // Ranking and tenant sequence are authoritative here, in the same transaction as owner/cursor/audit/receipt.
    statements.push(this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
    SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM (${BALANCED_ASSIGNMENT_DECISION_SQL}) d
      WHERE d.unsupportedPool=0 AND d.candidateCount<=${BALANCED_ASSIGNMENT_CANDIDATES} AND d.groupId IS ? AND d.ownerId IS ? AND d.policyRevision IS ? AND d.sequence=?) THEN 1 ELSE 0 END
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
      .bind(tid, tid, commit.ticketId, tid, decision.groupId, owner, decision.policyRevision, decision.sequence));
    statements.push(...budgetGrantOperationStatements(this.db, this.scope, commit.authority));
    if (owner) {
      const eventId = crypto.randomUUID();
      const audit = auditedTicketUpdateStatements(this.db, this.scope, this.beta, commit.ticketId, { assigned_to: owner }, { kind: 'staff', id: this.scope.actorId, source: 'dashboard' }, true, { 'ticket.assignment_changed': eventId }, null, true);
      statements.push(...audit.statements);
      statements.push((await this.activity.prepareAssignmentFromCanonicalEvent({ id: crypto.randomUUID(), ticketId: commit.ticketId, recipientUserId: owner, eventId, producerId: this.scope.actorId })).statement);
      statements.push(this.db.prepare(`INSERT INTO tenant_routing_sequence(tenant_id,sequence) VALUES (?,?)
     ON CONFLICT(tenant_id) DO UPDATE SET sequence=excluded.sequence`).bind(tid, decision.sequence + 1));
      statements.push(this.db.prepare(`INSERT INTO operator_routing_sequence(tenant_id,user_id,sequence) VALUES (?,?,?)
     ON CONFLICT(tenant_id,user_id) DO UPDATE SET sequence=excluded.sequence`).bind(tid, owner, decision.sequence + 1));
      statements.push(this.db.prepare(`UPDATE conversation_events SET facts=json_set(facts,'$.routing',json_object('method','balanced-v1','policyRevision',?,'sequence',?))
     WHERE tenant_id=? AND ticket_id=? AND id=?`).bind(decision.policyRevision, decision.sequence + 1, tid, commit.ticketId, eventId));
    }
    statements.push(this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) SELECT ?,CASE WHEN EXISTS
    (SELECT 1 FROM tickets WHERE tenant_id=? AND id=? AND assigned_to IS ?) THEN 1 ELSE 0 END
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(tid, tid, commit.ticketId, owner));
    statements.push(this.db.prepare(`DELETE FROM balanced_assignment_receipts WHERE tenant_id=? AND actor_id=? AND key_hash=? AND expires_at<=unixepoch()`).bind(tid, this.scope.actorId, commit.keyHash));
    statements.push(this.db.prepare(`DELETE FROM balanced_assignment_receipts WHERE rowid IN(SELECT rowid FROM balanced_assignment_receipts
    WHERE tenant_id=? AND actor_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 99)`).bind(tid, this.scope.actorId));
    statements.push(this.db.prepare(`INSERT INTO balanced_assignment_receipts(tenant_id,actor_id,key_hash,ticket_id,payload_hash,outcome,owner_id,sequence,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,unixepoch()+86400) RETURNING outcome,owner_id,sequence`)
      .bind(tid, this.scope.actorId, commit.keyHash, commit.ticketId, commit.payloadHash, owner ? 'assigned' : 'no_capacity', owner, decision.sequence + (owner ? 1 : 0), now));
    const result = await this.db.batch(statements);
    const row = result.at(-1)?.results[0] as {
      outcome: 'assigned' | 'no_capacity';
      owner_id: string | null;
      sequence: number;
    } | undefined;
    if (!row)
      throw new BalancedAssignmentError(503, 'routing_unavailable');
    return { outcome: row.outcome, ownerId: row.owner_id, sequence: row.sequence, replayed: false };
  }
}
