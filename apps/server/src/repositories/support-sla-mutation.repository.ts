import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { SupportSlaMutationCommit, SupportSlaMutationNamespace, SupportSlaMutationReceipt } from '../types/support-sla-mutation';
import { staffMutationStatements } from './staff-ticket-mutation.repository';

const namespaceWhere = 'tenant_id=? AND principal_id=? AND operation=? AND key_hash=?';
const values = (scope: VerifiedTenantScope, ns: SupportSlaMutationNamespace) => [scope.tenantId, ns.principalId, ns.operation, ns.keyHash];

export class SupportSlaMutationRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}
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
    SELECT ?,?,?,?,?,?,?,${snapshot} WHERE json_type(${snapshot})='object' AND (?=0 OR changes()=1)`)
    .bind(...values(scope, ns), ns.payloadHash, ns.ticketId ?? null, responseStatus, ...snapshotValues, ...snapshotValues, requirePreviousChange ? 1 : 0);
}
