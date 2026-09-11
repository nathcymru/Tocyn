import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';

/** Actor-independent, exact admitted policy fence, evaluated inside canonical D1 batches. */
export function budgetCommitConstraint(authority: BudgetCommitAuthority, tenantId: string): { sql: string; values: unknown[] } {
  const s = authority.snapshot;
  if (authority.purpose !== 'new-work' || s.tenant_id !== tenantId || !Number.isSafeInteger(authority.expiresAt)) {
    return { sql: '0', values: [] };
  }
  return { sql: `EXISTS (SELECT 1 FROM budget_tenant_allocations a
    JOIN budget_owner_policies p ON p.deployment_id=a.deployment_id AND p.policy_id=a.policy_id AND p.policy_revision=a.policy_revision
    JOIN budget_deployment_authority d ON d.deployment_id=a.deployment_id
    WHERE a.tenant_id=? AND a.deployment_id=? AND a.state='active' AND d.state='active'
      AND d.authority_revision=? AND a.authority_revision=d.authority_revision AND p.authority_revision=d.authority_revision
      AND a.policy_id=? AND a.policy_revision=? AND a.reservation_namespace=? AND a.restriction_json=?
      AND p.coordinator_id=? AND p.max_reservations=? AND p.authority_max_age_ms=? AND p.policy_json=?
      AND (CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) < ?)`,
    values: [tenantId,s.deployment_id,s.authority_revision,s.policy_id,s.policy_revision,s.reservation_namespace,s.restriction_json,
      s.coordinator_id,s.max_reservations,s.authority_max_age_ms,s.policy_json,authority.expiresAt] };
}

export type ApiMutationCommit = Readonly<{ apiKeyId: string; authority: BudgetCommitAuthority }>;
function grantLink(authority: BudgetCommitAuthority): { sql: string; values: unknown[] } {
  const grant = authority.grant;
  const identity = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001F\u007f]/.test(value);
  if (!grant || !identity(grant.tenantId) || !identity(grant.aggregateId) || !identity(grant.reservationId) || !identity(grant.holderId)
    || !identity(grant.operationId) || !identity(grant.operationFingerprint)) return { sql: '0', values: [] };
  return { sql: `?=? AND ?=? AND ?=?`, values: [grant.operationId,authority.operationId,grant.operationFingerprint,authority.operationFingerprint,grant.tenantId,authority.snapshot.tenant_id] };
}
/** Current API credential and exact admission are checked in the same D1 transaction. */
export function apiBudgetMutationStatements(db: D1Database, scope: VerifiedTenantScope, commit: ApiMutationCommit): readonly D1PreparedStatement[] {
  const budget = budgetCommitConstraint(commit.authority,scope.tenantId);
  const link = grantLink(commit.authority), grant = commit.authority.grant;
  const valid = scope.actorId === commit.apiKeyId && scope.roles.includes('integration');
  const assertion = db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
    VALUES (?,CASE WHEN ?=1 AND ${budget.sql} AND EXISTS (SELECT 1 FROM api_keys
      WHERE tenant_id=? AND id=? AND is_active=1 AND instr(','||replace(permissions,' ','')||',',',tickets:write,')>0)
      THEN 1 ELSE 0 END) ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
    .bind(scope.tenantId,valid ? 1 : 0,...budget.values,scope.tenantId,commit.apiKeyId);
  // The closure predicate is evaluated in this canonical batch: after a
  // holder is sealed, no delayed operation can acquire durable evidence.
  const operation = db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ${link.sql} AND NOT EXISTS (SELECT 1 FROM budget_grant_closures
      WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`)
    .bind(scope.tenantId,grant?.reservationId ?? '',grant?.holderId ?? '',grant?.operationId ?? '',grant?.aggregateId ?? '',
      grant?.operationFingerprint ?? '',JSON.stringify(grant?.operationEnvelope ?? {}),...link.values,
      scope.tenantId,grant?.reservationId ?? '',grant?.holderId ?? '');
  const exact = db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN NOT EXISTS (SELECT 1 FROM budget_grant_closures
      WHERE tenant_id=? AND reservation_id=? AND holder_id=?) AND EXISTS (SELECT 1 FROM budget_grant_operations
      WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND operation_id=? AND aggregate_id=?
        AND operation_fingerprint=? AND operation_envelope_json=?) THEN 1 ELSE 0 END WHERE tenant_id=?`)
    .bind(scope.tenantId,grant?.reservationId ?? '',grant?.holderId ?? '',scope.tenantId,grant?.reservationId ?? '',grant?.holderId ?? '',grant?.operationId ?? '',grant?.aggregateId ?? '',
      grant?.operationFingerprint ?? '',JSON.stringify(grant?.operationEnvelope ?? {}),scope.tenantId);
  return [assertion,operation,exact];
}
