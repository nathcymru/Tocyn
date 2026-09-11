import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { Ticket } from '../types';
import type { StaffMutationCommit, StaffMutationNamespace, StaffMutationReceipt } from '../types/staff-ticket-mutation';
import { MAX_SESSION_BUDGET_GROUPS } from './session-budget-authority.repository';
import { budgetCommitConstraint } from './budget-commit-fence';
import type { StaffReplyPreconditionConstraint } from './staff-reply-precondition.repository';

const namespaceWhere = 'tenant_id=? AND principal_id=? AND operation=? AND key_hash=?';
const namespaceValues = (scope: VerifiedTenantScope, ns: StaffMutationNamespace) => [scope.tenantId,ns.principalId,ns.operation,ns.keyHash];

export class StaffTicketMutationRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}
  async findActive(ns: StaffMutationNamespace): Promise<StaffMutationReceipt | null> {
    if (ns.principalId !== this.scope.actorId) return null;
    return this.db.prepare(`SELECT payload_hash,fingerprint_version,response_version,lifecycle,result_ticket_id,result_article_id,response_status,response_snapshot
      FROM staff_ticket_mutation_receipts WHERE ${namespaceWhere} AND expires_at>unixepoch()`)
      .bind(...namespaceValues(this.scope,ns)).first<StaffMutationReceipt>();
  }
  async ticket(id: string): Promise<Ticket | null> {
    return this.db.prepare('SELECT * FROM tickets WHERE tenant_id=? AND id=? LIMIT 1').bind(this.scope.tenantId,id).first<Ticket>();
  }
  async articleExists(ticketId: string, articleId: string): Promise<boolean> {
    return !!await this.db.prepare('SELECT 1 FROM articles WHERE tenant_id=? AND ticket_id=? AND id=? LIMIT 1')
      .bind(this.scope.tenantId,ticketId,articleId).first();
  }
  async customer(email: string): Promise<{ id: string } | null> {
    // Preserve dashboard's existing link-to-existing-user behavior; no customer creation.
    return this.db.prepare('SELECT id FROM users WHERE tenant_id=? AND email=? LIMIT 1').bind(this.scope.tenantId,email).first();
  }
  async responsibleOwnerAdmission(ticketId: string, ownerId: string | null, capacityOverride: boolean): Promise<'eligible' | 'unavailable' | 'at_capacity' | 'denied'> {
    const row = await this.db.prepare(`SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=? AND t.id=?) THEN 'denied'
      WHEN ? IS NULL THEN 'eligible'
      WHEN NOT EXISTS (SELECT 1 FROM tickets t JOIN users owner ON owner.tenant_id=t.tenant_id AND owner.id=?
        WHERE t.tenant_id=? AND t.id=? AND owner.role IN ('admin','agent')
          AND (t.group_id IS NULL OR EXISTS (SELECT 1 FROM user_groups membership WHERE membership.tenant_id=t.tenant_id AND membership.user_id=owner.id AND membership.group_id=t.group_id))) THEN 'denied'
      WHEN EXISTS (SELECT 1 FROM operator_routing_profiles p WHERE p.tenant_id=? AND p.user_id=? AND p.is_available=0) THEN 'unavailable'
      WHEN ?=1 OR NOT EXISTS (SELECT 1 FROM operator_routing_profiles p WHERE p.tenant_id=? AND p.user_id=? AND p.assignment_capacity IS NOT NULL) THEN 'eligible'
      WHEN (SELECT count(*) FROM tickets active WHERE active.tenant_id=? AND active.assigned_to=? AND active.id<>? AND active.status IN ('open','pending'))
        < (SELECT assignment_capacity FROM operator_routing_profiles WHERE tenant_id=? AND user_id=?) THEN 'eligible'
      ELSE 'at_capacity' END AS result`)
      .bind(this.scope.tenantId,ticketId,ownerId,ownerId,this.scope.tenantId,ticketId,this.scope.tenantId,ownerId,
        capacityOverride ? 1 : 0,this.scope.tenantId,ownerId,this.scope.tenantId,ownerId,ticketId,this.scope.tenantId,ownerId)
      .first<{ result: 'eligible' | 'unavailable' | 'at_capacity' | 'denied' }>();
    return row?.result ?? 'denied';
  }
  /**
   * Select one candidate from the authoritative tenant queue. Current work is
   * the primary fairness measure; the persisted selection time only breaks
   * equal-load ties. Missing profiles deliberately retain the established
   * available/unlimited default, while a configured profile supplies hard
   * availability and capacity facts.
   */
  async routingCandidate(ticketId: string): Promise<string | null> {
    const row = await this.db.prepare(`WITH ticket AS (
      SELECT id,group_id FROM tickets WHERE tenant_id=? AND id=? AND assigned_to IS NULL AND status IN ('open','pending')
    ), candidates AS (
      SELECT operator.id,
        (SELECT count(*) FROM tickets active WHERE active.tenant_id=operator.tenant_id
          AND active.assigned_to=operator.id AND active.status IN ('open','pending')) AS active_work,
        fairness.last_selection_sequence
      FROM ticket
      JOIN users operator ON operator.tenant_id=? AND operator.role IN ('admin','agent')
      LEFT JOIN operator_routing_profiles profile ON profile.tenant_id=operator.tenant_id AND profile.user_id=operator.id
      LEFT JOIN operator_routing_fairness fairness ON fairness.tenant_id=operator.tenant_id AND fairness.user_id=operator.id
      WHERE (ticket.group_id IS NULL OR EXISTS (SELECT 1 FROM user_groups membership
          WHERE membership.tenant_id=operator.tenant_id AND membership.user_id=operator.id AND membership.group_id=ticket.group_id))
        AND COALESCE(profile.is_available,1)=1
        AND (profile.assignment_capacity IS NULL OR (SELECT count(*) FROM tickets active WHERE active.tenant_id=operator.tenant_id
          AND active.assigned_to=operator.id AND active.status IN ('open','pending')) < profile.assignment_capacity)
    ) SELECT id FROM candidates
      ORDER BY active_work ASC,CASE WHEN last_selection_sequence IS NULL THEN 0 ELSE 1 END ASC,last_selection_sequence ASC,id ASC LIMIT 1`)
      .bind(this.scope.tenantId,ticketId,this.scope.tenantId).first<{ id: string }>();
    return row?.id ?? null;
  }
}

/** Fixed guard only: no request-provided SQL or assertion callbacks. */
export function staffMutationStatements(db: D1Database, scope: VerifiedTenantScope, commit: StaffMutationCommit,
  precondition?: StaffReplyPreconditionConstraint): D1PreparedStatement[] {
  const c = commit.credential, requirement = commit.requirements;
  const valid = c.tenantId === scope.tenantId && c.actorId === scope.actorId && scope.roles.includes(c.role)
    && c.sessionVersion === scope.authVersion && c.mfaVerified === true && ['admin','agent'].includes(c.role)
    && Number.isSafeInteger(c.expiresAt) && Number.isSafeInteger(c.sessionVersion)
    && (!commit.namespace || commit.namespace.principalId === c.actorId);
  const budget = budgetCommitConstraint(commit.authority, scope.tenantId);
  const sql = [`?=1`, `EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=? AND mfa_enabled=1 AND ?>unixepoch())`, budget.sql];
  const values: unknown[] = [valid ? 1 : 0,scope.tenantId,c.actorId,c.role,c.sessionVersion,c.expiresAt,...budget.values];
  if (precondition) { sql.push(`(${precondition.sql})`); values.push(...precondition.values); }
  if (requirement.ticket) {
    sql.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=? AND t.id=? AND t.group_id IS ?
      AND (?='admin' OR t.group_id IS NULL OR EXISTS (SELECT 1 FROM user_groups WHERE tenant_id=t.tenant_id AND user_id=? AND group_id=t.group_id)))`);
    values.push(scope.tenantId,requirement.ticket.id,requirement.ticket.groupId,c.role,c.actorId);
  }
  if (commit.responsibleOwner) {
    const assignment = commit.responsibleOwner;
    // `assigned_to` remains the single canonical responsible-handler field.
    // Availability and the current-work ceiling are rechecked in this same
    // D1 batch, so two assignments cannot both consume the final slot.
    sql.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=? AND t.id=?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM users owner WHERE owner.tenant_id=t.tenant_id AND owner.id=?
        AND owner.role IN ('admin','agent') AND (t.group_id IS NULL OR EXISTS (SELECT 1 FROM user_groups membership
          WHERE membership.tenant_id=t.tenant_id AND membership.user_id=owner.id AND membership.group_id=t.group_id)))))`);
    values.push(scope.tenantId,assignment.ticketId,assignment.ownerId,assignment.ownerId);
    sql.push(`(? IS NULL OR NOT EXISTS (SELECT 1 FROM operator_routing_profiles p WHERE p.tenant_id=? AND p.user_id=? AND p.is_available=0))`);
    values.push(assignment.ownerId,scope.tenantId,assignment.ownerId);
    sql.push(`(? IS NULL OR ?=1 OR NOT EXISTS (SELECT 1 FROM operator_routing_profiles p WHERE p.tenant_id=? AND p.user_id=? AND p.assignment_capacity IS NOT NULL)
      OR (SELECT count(*) FROM tickets active WHERE active.tenant_id=? AND active.assigned_to=? AND active.id<>? AND active.status IN ('open','pending'))
        < (SELECT assignment_capacity FROM operator_routing_profiles p WHERE p.tenant_id=? AND p.user_id=?))`);
    values.push(assignment.ownerId,assignment.capacityOverride && c.role === 'admin' ? 1 : 0,scope.tenantId,assignment.ownerId,
      scope.tenantId,assignment.ownerId,assignment.ticketId,scope.tenantId,assignment.ownerId);
  }
  if (commit.routingSelection) {
    const assignment = commit.routingSelection;
    // A queue route is only for an unassigned active ticket. This makes a
    // concurrent manual/automatic assignment fail the whole batch rather than
    // becoming a receipted no-op under a different routing decision.
    sql.push(`EXISTS (SELECT 1 FROM tickets WHERE tenant_id=? AND id=? AND assigned_to IS NULL AND status IN ('open','pending'))`);
    values.push(scope.tenantId,assignment.ticketId);
  }
  if (requirement.capability) {
    const f = requirement.capability;
    const same = f.tenantId === c.tenantId && f.actorId === c.actorId && f.role === c.role && f.sessionVersion === c.sessionVersion;
    // Each correlated membership read stops at the 65th row, including if a
    // membership is added after the advisory gate. Never call the unbounded variant.
    const groups = `SELECT m.group_id,r.enabled,r.revision FROM
      (SELECT group_id FROM user_groups WHERE tenant_id=? AND user_id=? ORDER BY group_id COLLATE BINARY LIMIT ${MAX_SESSION_BUDGET_GROUPS + 1}) m
      LEFT JOIN tenant_group_capability_constraints r ON r.tenant_id=? AND r.group_id=m.group_id AND r.capability=?`;
    const groupValues = [scope.tenantId,c.actorId,scope.tenantId,f.capability];
    // D1 binds JavaScript numbers as REAL; cast the final session revision so
    // its JSON representation matches the INTEGER column used by #79.
    sql.push(`?=1 AND EXISTS (SELECT 1 FROM deployment_capability_ceiling o
      JOIN deployment_role_capability_grants r ON r.capability=o.capability AND r.role=?
      LEFT JOIN tenant_role_capability_policies t ON t.tenant_id=? AND t.role=? AND t.capability=o.capability
      WHERE o.capability=? AND o.enabled=1 AND r.enabled=1 AND (?<>'agent' OR t.enabled=1)
        AND (SELECT count(*) FROM (${groups}))<=${MAX_SESSION_BUDGET_GROUPS}
        AND NOT EXISTS (SELECT 1 FROM (${groups}) WHERE enabled=0)
        AND json_array(o.revision,r.revision,CASE WHEN ?='agent' THEN t.revision ELSE NULL END,
          json((SELECT json_group_array(json_array(group_id,revision)) FROM (${groups} ORDER BY m.group_id COLLATE BINARY) WHERE enabled IS NOT NULL)),CAST(? AS INTEGER))=?)`);
    values.push(same ? 1 : 0,c.role,scope.tenantId,c.role,f.capability,c.role,...groupValues,...groupValues,
      c.role,...groupValues,c.sessionVersion,f.policyFingerprint);
  }
  const statements = [db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN ${sql.join(' AND ')} THEN 1 ELSE 0 END)
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(scope.tenantId,...values)];
  if (commit.namespace) {
    statements.push(db.prepare(`DELETE FROM staff_ticket_mutation_receipts WHERE ${namespaceWhere} AND expires_at<=unixepoch()`)
      .bind(...namespaceValues(scope,commit.namespace)));
    statements.push(db.prepare(`DELETE FROM staff_ticket_mutation_receipts WHERE rowid IN
      (SELECT rowid FROM staff_ticket_mutation_receipts WHERE tenant_id=? AND principal_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 99)`)
      .bind(scope.tenantId,c.actorId));
  }
  return statements;
}

/** Written after the audited ticket update, so failed/no-op routes never move the fairness cursor. */
export function routingSelectionStatement(db: D1Database, scope: VerifiedTenantScope,
  selection: Readonly<{ ticketId: string; ownerId: string }>): D1PreparedStatement {
  return db.prepare(`INSERT INTO operator_routing_fairness (tenant_id,user_id,last_selection_sequence,last_selected_at)
    SELECT ?,?,COALESCE((SELECT max(last_selection_sequence) FROM operator_routing_fairness WHERE tenant_id=?),0)+1,CURRENT_TIMESTAMP
    FROM tickets WHERE tenant_id=? AND id=? AND assigned_to=?
    ON CONFLICT(tenant_id,user_id) DO UPDATE SET last_selection_sequence=excluded.last_selection_sequence,last_selected_at=excluded.last_selected_at`)
    .bind(scope.tenantId,selection.ownerId,scope.tenantId,scope.tenantId,selection.ticketId,selection.ownerId);
}

export function staffMutationReceiptStatement(db: D1Database, scope: VerifiedTenantScope, ns: StaffMutationNamespace,
  ticketId: string, articleId: string | null, responseVersion: 1 | 2, responseStatus: 200 | 201,
  snapshot: string, values: unknown[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO staff_ticket_mutation_receipts
    (tenant_id,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,result_ticket_id,result_article_id,response_status,response_snapshot)
    VALUES (?,?,?,?,?,1,?,?,?,?,${snapshot}) RETURNING response_snapshot`)
    .bind(...namespaceValues(scope,ns),ns.payloadHash,responseVersion,ticketId,articleId,responseStatus,...values);
}
