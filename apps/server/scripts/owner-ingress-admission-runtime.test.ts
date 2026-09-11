import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database, D1PreparedStatement, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import { OWNER_INGRESS_EXECUTION_ENVELOPE } from '../src/budgets/owner-ingress-admission.service';
import { OwnerIngressAdmissionCache } from '../src/budgets/owner-ingress-admission.service';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import { BudgetAuthorityRepository, OWNER_INGRESS_AUTHORITY_D1_READ_BOUND } from '../src/repositories/budget-authority.repository';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { splitSql } from './split-sql';
import { SignJWT } from 'jose';

const NOW = Date.now();
const serverRoot = resolve(import.meta.dirname, '..');
const JWT_SECRET = 'synthetic-owner-ingress-secret-at-least-32-bytes';

async function applyMigrations(db: D1Database): Promise<void> {
  const directory = join(serverRoot, 'migrations');
  for (const migration of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(directory, migration), 'utf8')).map(statement => db.prepare(statement)));
  }
}

function ownerPolicy() {
  const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents'] as const;
  return { schemaVersion: 1, policyId: 'owner-ingress-policy', revision: 1, deploymentId: 'owner-ingress-deployment',
    mode: 'conservative', catalogueVersion: 'catalogue-1', maxGrantLifetimeMs: 60_000,
    budgets: dimensions.map(dimension => ({ dimension, allocationId: `owner-${dimension}`,
      window: { kind: 'interval' as const, id: 'native-window', startsAt: NOW - 1, endsAt: NOW + 3_600_000 },
      limit: 2_000_000, recoveryPercent: 20, provenance: 'owner-allocation' })) };
}

function restriction(policy = ownerPolicy()) {
  return { schemaVersion: 1, tenantId: 'tenant-a', ownerPolicyId: 'owner-ingress-policy', ownerPolicyRevision: 1,
    revision: 1, mode: 'conservative', limits: Object.fromEntries(policy.budgets.map(budget => [budget.dimension, budget.limit])), disabledFeatures: [] };
}

async function seed(db: D1Database, policy = ownerPolicy()): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('tenant-a','actor-a','actor-a@example.test','admin',1)"),
    db.prepare("INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at) VALUES ('owner-ingress-deployment',1,'active',?)").bind(NOW),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('owner-ingress-deployment','owner-ingress-policy',1,1,'owner-ingress-aggregate',64,30000,?)`).bind(JSON.stringify(policy)),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('owner-ingress-deployment','tenant-a','owner-ingress-policy',1,1,'owner-ingress-tenant-a',?,'active')`).bind(JSON.stringify(restriction(policy))),
  ]);
}

function meterReads(database: D1Database): { database: D1Database; rows: () => number } {
  let rows = 0;
  const raw = new WeakMap<object, D1PreparedStatement>();
  const record = <T extends D1Result<unknown> | D1Result<unknown>[]>(result: T): T => {
    for (const item of Array.isArray(result) ? result : [result]) rows += item.meta.rows_read ?? 0;
    return result;
  };
  const statement = (target: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(target as object, { get(value, property) {
      if (property === 'bind') return (...args: unknown[]) => statement((value as D1PreparedStatement).bind(...args));
      if (property === 'all') return async () => record(await (value as D1PreparedStatement).all());
      const member = Reflect.get(value, property);
      return typeof member === 'function' ? member.bind(value) : member;
    } }) as D1PreparedStatement;
    raw.set(proxy as object, target); return proxy;
  };
  const metered = new Proxy(database as object, { get(target, property) {
    if (property === 'prepare') return (sql: string) => statement((target as D1Database).prepare(sql));
    if (property === 'batch') return async (statements: D1PreparedStatement[]) => record(await (target as D1Database)
      .batch(statements.map(item => raw.get(item as object) ?? item)));
    const member = Reflect.get(target, property);
    return typeof member === 'function' ? member.bind(target) : member;
  } }) as D1Database;
  return { database: metered, rows: () => rows };
}

async function fixture(name: string, policy = 'owner-ingress-v1') {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'owner-ingress-admission-runtime-entry.ts')],
    bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name, modules: true, compatibilityDate: '2024-04-03', script: bundled.outputFiles[0].text,
    compatibilityFlags: ['nodejs_compat'], bindings: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', OWNER_INGRESS_ADMISSION_POLICY: policy, JWT_SECRET },
    d1Databases: { DB: `${name}-d1` }, durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' },
    unsafeEphemeralDurableObjects: true }] }));
  const db = await mf.getD1Database('DB'); await applyMigrations(db);
  return { mf, db };
}

test('native ingress charges owner-only attempts and hands admitted tenant work off without duplicate owner charge', async () => {
  const f = await fixture('owner-ingress-native');
  try {
    await seed(f.db);
    const emailGuard = await f.mf.dispatchFetch('http://example.test/email-readiness-guard');
    assert.deepEqual(await emailGuard.json(), { rejection: 'Inbound email admission is not available' });
    const namespace = await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = namespace.get(namespace.idFromName('owner-ingress-aggregate')) as unknown as BudgetCoordinatorDO;
    const ownerOnly = await f.mf.dispatchFetch('http://example.test/api/owner-only');
    assert.equal(ownerOnly.status, 401);
    const afterOwner = await coordinator.inspectForTrustedRuntime();
    for (const [dimension, units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)) {
      assert.equal(afterOwner.ownerIngress.closedCharges.find(charge => charge.dimension === dimension && charge.purpose === 'new-work')?.units, units);
    }

    const token = await new SignJWT({ tenant_id: 'tenant-a', role: 'admin', session_version: 1, mfa_verified: true })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('actor-a').setAudience('app').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const handoffStatuses: number[] = [];
    for (let index = 0; index < 12; index++) {
      handoffStatuses.push((await f.mf.dispatchFetch(`http://example.test/api/handoff?tenant=tenant-b&n=${index}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      })).status);
    }
    assert.equal(handoffStatuses.every(status => status === 200), true, JSON.stringify(handoffStatuses));
    const afterHandoff = await coordinator.inspectForTrustedRuntime();
    for (const [dimension, units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)) {
      assert.equal(afterHandoff.ownerIngress.closedCharges.find(charge => charge.dimension === dimension && charge.purpose === 'new-work')?.units, units,
        `${dimension} owner charge must not grow after exact tenant handoff`);
    }
    const tenantA = afterHandoff.tenantStates.find(tenant => tenant.tenantId === 'tenant-a');
    const tenantB = afterHandoff.tenantStates.find(tenant => tenant.tenantId === 'tenant-b');
    assert.ok(tenantA?.grants.length, 'tenant-a receives the server-derived handoff envelope');
    assert.equal(tenantB, undefined, 'a client query cannot select another tenant ledger');
    assert.ok(tenantA.grants.some(grant => (grant.envelope.d1RowsRead ?? 0) >= OWNER_INGRESS_EXECUTION_ENVELOPE.d1RowsRead!));
    for (const [dimension, units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)) {
      assert.equal(tenantA.closedCharges.find(charge => charge.dimension === dimension && charge.purpose === 'new-work')?.units,
        units * 12, `${dimension} is charged once per successful tenant handoff`);
    }

    const tenantGrantCount = tenantA.grants.length;
    await f.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='actor-a'").run();
    const revoked = await f.mf.dispatchFetch('http://example.test/api/handoff', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(revoked.status, 401, 'a post-ingress session revocation cannot hand work to the tenant');
    const afterRevocation = await coordinator.inspectForTrustedRuntime();
    assert.equal(afterRevocation.tenantStates[0].grants.length, tenantGrantCount);
    for (const [dimension, units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)) {
      assert.equal(afterRevocation.ownerIngress.closedCharges.find(charge => charge.dimension === dimension && charge.purpose === 'new-work')?.units,
        units * 2, `${dimension} keeps the denied current-credential attempt in owner ingress`);
    }

    const recovery = await f.mf.dispatchFetch('http://example.test/api/auth/logout', { method: 'POST' });
    assert.equal(recovery.status, 401);
    const afterRecovery = await coordinator.inspectForTrustedRuntime();
    assert.equal(afterRecovery.ownerIngress.closedCharges.find(charge => charge.dimension === 'workerRequests' && charge.purpose === 'recovery')?.units, 1);
  } finally { await f.mf.dispose(); }
});

test('native ingress fails closed for missing authority, malformed policy, and ambiguous active deployments', async () => {
  const off = await fixture('owner-ingress-off', 'off');
  try {
    assert.equal((await off.mf.dispatchFetch('http://example.test/api/owner-only')).status, 401);
  } finally { await off.mf.dispose(); }

  const missing = await fixture('owner-ingress-missing');
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await missing.mf.dispatchFetch('http://example.test/api/owner-only')).status, 503);
    }
  } finally { await missing.mf.dispose(); }

  const invalid = await fixture('owner-ingress-invalid', 'unknown-policy');
  try {
    assert.equal((await invalid.mf.dispatchFetch('http://example.test/api/owner-only')).status, 503);
  } finally { await invalid.mf.dispose(); }

  const exhausted = await fixture('owner-ingress-exhausted');
  try {
    const policy = { ...ownerPolicy(), budgets: ownerPolicy().budgets.map(budget => budget.dimension === 'workerRequests' ? { ...budget, limit: 1 } : budget) };
    await seed(exhausted.db, policy);
    const response = await exhausted.mf.dispatchFetch('http://example.test/api/owner-only');
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('Retry-After')) >= 1);
  } finally { await exhausted.mf.dispose(); }

  const ambiguous = await fixture('owner-ingress-ambiguous');
  try {
    await seed(ambiguous.db);
    await ambiguous.db.batch([
      ambiguous.db.prepare("INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at) VALUES ('other-deployment',1,'active',?)").bind(NOW),
      ambiguous.db.prepare(`INSERT INTO budget_owner_policies
        (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('other-deployment','owner-ingress-policy',1,1,'other-aggregate',64,30000,?)`).bind(JSON.stringify({ ...ownerPolicy(), deploymentId: 'other-deployment' })),
    ]);
    assert.equal((await ambiguous.mf.dispatchFetch('http://example.test/api/owner-only')).status, 503);
  } finally { await ambiguous.mf.dispose(); }
});

test('0063 bounds the server-derived deployment and policy candidate scan', async () => {
  const f = await fixture('owner-ingress-plan');
  try {
    await seed(f.db);
    const plan = await f.db.prepare(`EXPLAIN QUERY PLAN SELECT d.deployment_id FROM budget_deployment_authority d
      JOIN budget_owner_policies p ON p.deployment_id=d.deployment_id AND p.authority_revision=d.authority_revision
      WHERE d.state='active' ORDER BY d.deployment_id,p.policy_id,p.policy_revision LIMIT 2`).all<{ detail: string }>();
    const detail = plan.results.map((row: { detail: string }) => row.detail).join('\n');
    assert.match(detail, /idx_budget_deployment_active_authority/);
    assert.match(detail, /idx_budget_owner_policy_authority/);
    const meter = meterReads(f.db);
    assert.ok(await new BudgetAuthorityRepository(meter.database).resolveForDeploymentIngress(NOW));
    assert.ok(meter.rows() > 0 && meter.rows() <= OWNER_INGRESS_AUTHORITY_D1_READ_BOUND,
      `native authority snapshot read ${meter.rows()} rows within ${OWNER_INGRESS_AUTHORITY_D1_READ_BOUND}`);
  } finally { await f.mf.dispose(); }
});

test('native lost acknowledgements reuse one ingress reservation and terminal certificate', async () => {
  const f = await fixture('owner-ingress-lost-ack');
  try {
    await seed(f.db);
    const raw = await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const target = raw.get(raw.idFromName('owner-ingress-aggregate')) as unknown as BudgetCoordinatorDO;
    let reserveCalls = 0, reconcileCalls = 0;
    const lossy = {
      idFromName: raw.idFromName.bind(raw),
      get: () => ({
        refreshFromTrustedAuthority: target.refreshFromTrustedAuthority.bind(target),
        reserveIngressFromTrustedAuthority: async (input: Parameters<BudgetCoordinatorDO['reserveIngressFromTrustedAuthority']>[0]) => {
          reserveCalls++;
          const result = await target.reserveIngressFromTrustedAuthority(input);
          if (reserveCalls === 1) throw new Error('synthetic lost reserve acknowledgement');
          return result;
        },
        reconcileIngressFromTrustedAuthority: async (input: Parameters<BudgetCoordinatorDO['reconcileIngressFromTrustedAuthority']>[0]) => {
          reconcileCalls++;
          const result = await target.reconcileIngressFromTrustedAuthority(input);
          if (reconcileCalls === 1) throw new Error('synthetic lost closure acknowledgement');
          return result;
        },
      }),
    } as unknown as DurableObjectNamespace;
    const cache = new OwnerIngressAdmissionCache();
    const admitted = await cache.admit({ repository: new BudgetAuthorityRepository(f.db), namespace: lossy, purpose: 'new-work', now: () => NOW });
    assert.equal(admitted.status, 'admitted');
    if (admitted.status !== 'admitted') throw new Error('expected recovered ingress admission');
    assert.equal(await admitted.admission.finish(NOW + 1), 'closed');
    assert.equal(reserveCalls, 2);
    assert.equal(reconcileCalls, 2);
    const state = await target.inspectForTrustedRuntime();
    assert.equal(state.ownerIngress.grants.length, 1, 'lost delivery acknowledgement does not create another credential/grant');
    assert.equal(state.ownerIngress.grants[0].holderSeedAttempts, 2);
    assert.equal(state.ownerIngress.closedCharges.find(charge => charge.dimension === 'workerRequests')?.units, 1);

    const transferable = await cache.admit({ repository: new BudgetAuthorityRepository(f.db), namespace: raw as unknown as DurableObjectNamespace, purpose: 'new-work', now: () => NOW + 2 });
    assert.equal(transferable.status, 'admitted');
    if (transferable.status !== 'admitted') throw new Error('expected transferable ingress admission');
    let handoffCalls = 0;
    const handoffLossy = {
      idFromName: raw.idFromName.bind(raw),
      get: () => ({
        refreshFromTrustedAuthority: target.refreshFromTrustedAuthority.bind(target),
        reserveFromTrustedAuthority: target.reserveFromTrustedAuthority.bind(target),
        handoffIngressFromTrustedAuthority: async (input: Parameters<BudgetCoordinatorDO['handoffIngressFromTrustedAuthority']>[0]) => {
          handoffCalls++;
          const result = await target.handoffIngressFromTrustedAuthority(input);
          if (handoffCalls === 1) throw new Error('synthetic lost atomic handoff acknowledgement');
          return result;
        },
      }),
    } as unknown as DurableObjectNamespace;
    const scope = createVerifiedTenantScope('tenant-a', 'actor-a', ['admin'], 1);
    const tenantAdmission = await new IsolateBudgetAdmissionCache().admit({
      repository: new BudgetAuthorityRepository(f.db, scope, f.db, transferable.admission),
      namespace: handoffLossy,
      authorization: { authorize: async () => ({ kind: 'session' as const, sessionVersion: 1 }) },
      scope,
      credentialKey: 'staff:actor-a:1',
      intent: { operationId: 'lost-handoff-operation', operationFingerprint: 'lost-handoff-fingerprint', workScopeKey: 'lost-handoff-scope' },
      business: { workerRequests: 1, d1RowsWritten: 1 },
      now: () => NOW + 2,
    });
    assert.equal(tenantAdmission.status, 'spent');
    assert.equal(handoffCalls, 2, 'one lost transfer acknowledgement replays the exact atomic handoff once');
    assert.equal(await transferable.admission.finish(NOW + 3), 'closed');
    const afterTransfer = await target.inspectForTrustedRuntime();
    assert.equal(afterTransfer.ownerIngress.grants.filter(grant => !grant.compacted).length, 0);
    assert.equal(afterTransfer.tenantStates[0].grants.filter(grant => grant.holderId.startsWith('owner-ingress:')).length, 1,
      'lost acknowledgement retains one exact compacted tenant ingress record');

    let failedRefreshes = 0;
    const unavailable = { idFromName: raw.idFromName.bind(raw), get: () => ({ refreshFromTrustedAuthority: async () => {
      failedRefreshes++; throw new Error('synthetic unavailable coordinator');
    } }) } as unknown as DurableObjectNamespace;
    const bounded = new OwnerIngressAdmissionCache();
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await bounded.admit({ repository: new BudgetAuthorityRepository(f.db, undefined, f.db), namespace: unavailable, purpose: 'new-work', now: () => NOW })).status, 'rejected');
    }
    assert.equal(failedRefreshes, 6, 'three executions receive two finite delivery attempts; later requests perform no D1/DO loop');
    assert.deepEqual(bounded.inspectForTrustedRuntime(), { bindings: 1, failedAdmissions: 3, terminalFailures: 1 });
  } finally { await f.mf.dispose(); }
});
