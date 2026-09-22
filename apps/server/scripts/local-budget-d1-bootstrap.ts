/** Synthetic, pre-serve owner authority for one run-owned local D1 database.
 * This creates no Worker binding, grant or provider authority. */
import { RESOURCE_DIMENSIONS, STOCK_DIMENSIONS } from '@luminatick/shared';
import { costPolicySchema, effectiveTenantPolicy } from '../src/utils/cost-policy';
import { BUDGET_AUTHORITY_MAX_JSON_BYTES } from '../src/repositories/budget-authority.repository';

type Input = Readonly<{ runId: string; tenantIds: readonly string[]; now: number; intervalWindowMs: number }>;
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value);

export async function initializeSyntheticLocalBudgetAuthority(db: D1Database, input: Input): Promise<void> {
  const tenantIds = [...input.tenantIds];
  if (!identifier(input.runId) || tenantIds.length !== 2 || !tenantIds.every(identifier)
    || new Set(tenantIds).size !== 2 || !Number.isSafeInteger(input.now) || input.now < 1_000
    || !Number.isSafeInteger(input.intervalWindowMs) || input.intervalWindowMs < 60_000
    || input.intervalWindowMs > 86_400_000
    || input.now > Number.MAX_SAFE_INTEGER - input.intervalWindowMs) throw new Error('Invalid synthetic local budget bootstrap');

  const deploymentId = 'fixture-combined-beta-deployment';
  const policyId = 'fixture-combined-beta-policy';
  const limits = Object.fromEntries(RESOURCE_DIMENSIONS.map(dimension =>
    [dimension, dimension === 'logEvents' ? 200_000_000 : 10_000_000]));
  const ownerPolicy = costPolicySchema.parse({
    schemaVersion: 1, policyId, revision: 1, deploymentId, mode: 'conservative',
    catalogueVersion: 'fixture-combined-beta-catalogue', maxGrantLifetimeMs: 60_000,
    budgets: RESOURCE_DIMENSIONS.map(dimension => ({
      dimension, allocationId: `fixture-combined-${dimension}`,
      window: STOCK_DIMENSIONS.includes(dimension)
        ? { kind: 'stock', id: `fixture-combined-${dimension}-stock` }
        : { kind: 'interval', id: 'fixture-combined-window', startsAt: input.now - 1_000,
          endsAt: input.now + input.intervalWindowMs },
      limit: limits[dimension], recoveryPercent: 20, provenance: 'owner-allocation',
    })),
  });
  const restrictions = tenantIds.map(tenantId => {
    const value = { schemaVersion: 1, tenantId, ownerPolicyId: policyId, ownerPolicyRevision: 1,
      revision: 1, mode: 'conservative', limits, disabledFeatures: [] };
    effectiveTenantPolicy(ownerPolicy, value, tenantId);
    return JSON.stringify(value);
  });
  const policyJson = JSON.stringify(ownerPolicy);
  if (new TextEncoder().encode(policyJson).byteLength > BUDGET_AUTHORITY_MAX_JSON_BYTES
    || restrictions.some(value => new TextEncoder().encode(value).byteLength > BUDGET_AUTHORITY_MAX_JSON_BYTES)) {
    throw new Error('Synthetic local budget authority exceeds bounded JSON size');
  }

  // One D1 transaction fences against wrong tenant catalogues, policy changes,
  // and any pre-existing owner authority before making that authority visible.
  await db.batch([
    db.prepare(`INSERT INTO local_beta_assertion(singleton,accepted)
      VALUES(1,CASE WHEN EXISTS(SELECT 1 FROM local_beta_policy WHERE run_id=? AND revision=1 AND state='running')
        AND (SELECT COUNT(*) FROM local_beta_tenants WHERE run_id=?)=2
        AND (SELECT COUNT(*) FROM local_beta_tenants WHERE run_id=? AND tenant_id IN (?,?))=2
        AND NOT EXISTS(SELECT 1 FROM budget_deployment_authority)
        AND NOT EXISTS(SELECT 1 FROM budget_owner_policies)
        AND NOT EXISTS(SELECT 1 FROM budget_tenant_allocations) THEN 1 ELSE 0 END)
      ON CONFLICT(singleton) DO UPDATE SET accepted=excluded.accepted`)
      .bind(input.runId, input.runId, input.runId, tenantIds[0], tenantIds[1]),
    db.prepare(`INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at)
      VALUES (?,1,'active',?)`).bind(deploymentId, input.now),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES (?,?,1,1,?,64,60000,?)`).bind(deploymentId, policyId, 'fixture-combined-beta-coordinator', policyJson),
    ...tenantIds.map((tenantId, index) => db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES (?,?,?,1,1,?,?,'active')`).bind(deploymentId, tenantId, policyId,
      `fixture-combined-namespace-${index}`, restrictions[index])),
    // The assertion is a transactional guard, not persistent authority. Leave
    // the disposable runtime's first admitted mutation able to exercise the
    // cold assertion INSERT as well as the later conflict-UPDATE path.
    db.prepare('DELETE FROM local_beta_assertion WHERE singleton=1'),
  ]);
}
