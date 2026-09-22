import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { RESOURCE_DIMENSIONS, STOCK_DIMENSIONS } from '@luminatick/shared';
import { costPolicySchema, effectiveTenantPolicy } from '../src/utils/cost-policy';

const TENANTS = ['fixture-tenant-a', 'fixture-tenant-b'] as const;
const PREVIEW_WINDOW_MS = 8 * 60 * 60 * 1000;
const GRANT_LIFETIME_MS = 60_000;
// Disposable eight-hour human review: D1 read grants reserve far more than
// the rows actually read, so the former 10M limit exhausted during browsing.
const PREVIEW_D1_ROWS_READ_LIMIT = 1_000_000_000;
// The disposable review UI issues several admitted reads per route change.
// Keep a finite ceiling without exhausting a human test session after 64 reads.
const PREVIEW_MAX_RESERVATIONS = 1024;

/** Only the explicit, disposable local-beta launcher may change its generated config. */
export function configureLocalBetaTicketAdmission(config: { vars: Record<string, string>; compatibility_flags?: string[] }, enabled: boolean): void {
  if (!enabled) return;
  assert.equal(config.vars.ENVIRONMENT, 'local');
  assert.equal(config.vars.BUDGET_ADMISSION_POLICY, 'off');
  assert.ok(Array.isArray(config.compatibility_flags), 'A local Worker compatibility flag list is required');
  config.vars.LOCAL_BETA_ENABLED = 'true';
  config.vars.BUDGET_ADMISSION_POLICY = 'ticket-mutations-v1';
  // The checked-in 2024-04-01 date predates Durable Object RPC. Scope the
  // required runtime opt-in to this disposable beta config only.
  if (!config.compatibility_flags.includes('rpc')) config.compatibility_flags.push('rpc');
}

/** Seed complete synthetic owner authority into the already migrated, run-owned D1 file. */
export function initializeLocalBetaTicketAdmission(db: Database.Database, runId: string, now = Date.now()): void {
  assert.ok(Number.isSafeInteger(now) && now >= 1_000 && now <= Number.MAX_SAFE_INTEGER - PREVIEW_WINDOW_MS);
  const deploymentId = `${runId}-budget`;
  const policyId = 'local-beta-preview-policy';
  const limitFor = (dimension: typeof RESOURCE_DIMENSIONS[number]) => dimension === 'd1RowsRead'
    ? PREVIEW_D1_ROWS_READ_LIMIT : dimension === 'logEvents' ? 200_000_000 : 10_000_000;
  const ownerPolicy = costPolicySchema.parse({
    schemaVersion: 1, policyId, revision: 1, deploymentId, mode: 'conservative',
    catalogueVersion: 'local-beta-preview-catalogue', maxGrantLifetimeMs: GRANT_LIFETIME_MS,
    budgets: RESOURCE_DIMENSIONS.map(dimension => ({
      dimension,
      allocationId: `local-beta-${dimension}`,
      window: STOCK_DIMENSIONS.includes(dimension)
        ? { kind: 'stock', id: `local-beta-${dimension}-stock` }
        : { kind: 'interval', id: 'local-beta-preview-window', startsAt: now - 1_000, endsAt: now + PREVIEW_WINDOW_MS },
      limit: limitFor(dimension), recoveryPercent: 20, provenance: 'owner-allocation',
    })),
  });
  const restrictionFor = (tenantId: string) => ({
    schemaVersion: 1, tenantId, ownerPolicyId: policyId, ownerPolicyRevision: 1,
    revision: 1, mode: 'conservative',
    limits: Object.fromEntries(RESOURCE_DIMENSIONS.map(dimension => [dimension, limitFor(dimension)])),
    disabledFeatures: [],
  });
  for (const tenantId of TENANTS) effectiveTenantPolicy(ownerPolicy, restrictionFor(tenantId), tenantId);

  db.transaction(() => {
    const policy = db.prepare('SELECT run_id,state FROM local_beta_policy WHERE singleton=1').get() as { run_id: string; state: string } | undefined;
    assert.deepEqual(policy, { run_id: runId, state: 'running' }, 'The current guarded local-beta run must be active');
    const tenants = db.prepare('SELECT tenant_id FROM local_beta_tenants WHERE run_id=? ORDER BY tenant_id').all(runId) as Array<{ tenant_id: string }>;
    assert.deepEqual(tenants.map(row => row.tenant_id), [...TENANTS], 'Only the two synthetic fixture tenants may receive authority');
    assert.equal((db.prepare('SELECT count(*) AS count FROM budget_deployment_authority').get() as { count: number }).count, 0,
      'The disposable authority may be initialized only once');
    db.prepare("INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at) VALUES (?,1,'active',?)")
      .run(deploymentId, now);
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES (?,?,1,1,?,?,?,?)`)
      .run(deploymentId, policyId, `${runId}-coordinator`, PREVIEW_MAX_RESERVATIONS, GRANT_LIFETIME_MS, JSON.stringify(ownerPolicy));
    for (const [index, tenantId] of TENANTS.entries()) {
      db.prepare(`INSERT INTO budget_tenant_allocations
        (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES (?,?,?,?,?,?,?,'active')`)
        .run(deploymentId, tenantId, policyId, 1, 1, `${runId}-namespace-${index}`, JSON.stringify(restrictionFor(tenantId)));
    }
  })();
}
