import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { SupportSlaMutationCommit, SupportSlaMutationNamespace, SupportSlaMutationReceipt } from '../types/support-sla-mutation';
import { staffMutationStatements } from './staff-ticket-mutation.repository';

const namespaceWhere = 'tenant_id=? AND principal_id=? AND operation=? AND key_hash=?';
const values = (scope: VerifiedTenantScope, ns: SupportSlaMutationNamespace) => [scope.tenantId, ns.principalId, ns.operation, ns.keyHash];

export class SupportSlaMutationRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}
  async ticketGroup(ticketId: string): Promise<{ group_id: string | null } | null> {
    return this.db.prepare('SELECT group_id FROM tickets WHERE tenant_id=? AND id=? LIMIT 1')
      .bind(this.scope.tenantId, ticketId).first<{ group_id: string | null }>();
  }
  async findActive(ns: SupportSlaMutationNamespace): Promise<SupportSlaMutationReceipt | null> {
    if (ns.principalId !== this.scope.actorId) return null;
    return this.db.prepare(`SELECT payload_hash,lifecycle,response_status,response_snapshot FROM support_sla_mutation_receipts
      WHERE ${namespaceWhere} AND expires_at>unixepoch()`).bind(...values(this.scope, ns)).first<SupportSlaMutationReceipt>();
  }
}

/** The established current-session/capability/group/budget fence with only the receipt cleanup target changed. */
export function supportSlaFenceStatements(db: D1Database, scope: VerifiedTenantScope, commit: SupportSlaMutationCommit): D1PreparedStatement[] {
  // Reuse the audited staff fence for its exact current-session, MFA, target
  // group, capability and admitted-authority predicates. Its receipt cleanup
  // is intentionally not used because these operations have their own table.
  const staffLike = { ...commit, namespace: commit.namespace } as unknown as Parameters<typeof staffMutationStatements>[2];
  const assertion = staffMutationStatements(db, scope, staffLike)[0];
  return [assertion,
    db.prepare(`DELETE FROM support_sla_mutation_receipts WHERE ${namespaceWhere} AND expires_at<=unixepoch()`)
      .bind(...values(scope, commit.namespace)),
    db.prepare(`DELETE FROM support_sla_mutation_receipts WHERE rowid IN
      (SELECT rowid FROM support_sla_mutation_receipts WHERE tenant_id=? AND principal_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 99)`)
      .bind(scope.tenantId, commit.credential.actorId),
  ];
}

export function supportSlaReceiptStatement(db: D1Database, scope: VerifiedTenantScope, ns: SupportSlaMutationNamespace,
  responseStatus: 200 | 201, snapshot: string, snapshotValues: unknown[], requirePreviousChange = false): D1PreparedStatement {
  return db.prepare(`INSERT INTO support_sla_mutation_receipts
    (tenant_id,principal_id,operation,key_hash,payload_hash,result_ticket_id,response_status,response_snapshot)
    SELECT ?,?,?,?,?,?,CASE WHEN ?='dashboard.ticket.sla.initialize' THEN CASE WHEN changes()=1 THEN 201 ELSE 200 END ELSE ? END,${snapshot} WHERE json_type(${snapshot})='object' AND (?=0 OR changes()=1)`)
    .bind(...values(scope, ns), ns.payloadHash, ns.ticketId ?? null, ns.operation, responseStatus, ...snapshotValues, ...snapshotValues, requirePreviousChange ? 1 : 0);
}

const definitionSnapshot = `json((SELECT json_object('tenant_id',tenant_id,'id',id,'legacy_status',legacy_status,
  'internal_label',internal_label,'public_label',public_label,'waiting_reason_required',waiting_reason_required,
  'next_action_required',next_action_required,'is_compatibility_default',is_compatibility_default,'is_active',is_active,
  'created_at',created_at,'updated_at',updated_at) FROM support_state_definitions WHERE tenant_id=? AND id=?))`;
const stateSnapshot = `json((SELECT json_object('ticket_id',s.ticket_id,'definition_id',s.definition_id,'lifecycle',d.legacy_status,
  'internal_label',d.internal_label,'public_label',d.public_label,'waiting_reason',s.waiting_reason,'next_action',s.next_action,
  'changed_at',s.changed_at,'revision',s.revision) FROM ticket_support_state s JOIN support_state_definitions d
  ON d.tenant_id=s.tenant_id AND d.id=s.definition_id WHERE s.tenant_id=? AND s.ticket_id=?))`;
const policySnapshot = `json_object('calendar',json(calendar_json),'responseTargetMs',response_target_ms,
  'resolutionTargetMs',resolution_target_ms,'reopenPolicy',json_object('response',response_reopen_policy,'resolution',resolution_reopen_policy),'revision',revision)`;

export const SUPPORT_SLA_RECEIPT_SNAPSHOTS = Object.freeze({
  definition: definitionSnapshot,
  state: stateSnapshot,
  policy: `json((SELECT ${policySnapshot} FROM sla_policies WHERE tenant_id=?))`,
  success: `json_object('success',json('true'))`,
  initialized: `json_object('initialized',json(CASE WHEN changes()=1 THEN 'true' ELSE 'false' END))`,
});
