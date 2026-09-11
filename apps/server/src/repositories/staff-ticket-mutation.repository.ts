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
    return this.db.prepare(`SELECT payload_hash,fingerprint_version,response_version,lifecycle,result_ticket_id,result_article_id,response_snapshot
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

export function staffMutationReceiptStatement(db: D1Database, scope: VerifiedTenantScope, ns: StaffMutationNamespace,
  ticketId: string, articleId: string, snapshot: string, values: unknown[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO staff_ticket_mutation_receipts
    (tenant_id,principal_id,operation,key_hash,payload_hash,result_ticket_id,result_article_id,response_snapshot)
    VALUES (?,?,?,?,?,?,?,${snapshot}) RETURNING response_snapshot`)
    .bind(...namespaceValues(scope,ns),ns.payloadHash,ticketId,articleId,...values);
}
