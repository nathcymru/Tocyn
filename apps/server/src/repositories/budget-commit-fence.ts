import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';

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
