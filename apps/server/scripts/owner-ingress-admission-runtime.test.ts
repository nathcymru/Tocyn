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
import { BudgetAuthorityRepository, OWNER_INGRESS_AUTHORITY_D1_READ_BOUND } from '../src/repositories/budget-authority.repository';
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
    compatibilityFlags: ['nodejs_compat'], bindings: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', OWNER_INGRESS_ADMISSION_POLICY: policy, JWT_SECRET,
      PORTAL_URL: 'https://portal.example.test' },
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
      assert.equal(afterOwner.ownerIngress.closedCharges.find(charge => charge.dimension === dimension && charge.purpose === 'new-work')?.units, units * 2,
        `${dimension} records the two anonymous executions without an isolate-local warm block`);
    }

    const token = await new SignJWT({ tenant_id: 'tenant-a', role: 'admin', session_version: 1, mfa_verified: true })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('actor-a').setAudience('app').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const handoffStatuses: number[] = [];
    for (let index = 0; index < 15; index++) {
      handoffStatuses.push((await f.mf.dispatchFetch(`http://example.test/api/handoff?tenant=tenant-b&n=${index}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      })).status);
    }
    assert.equal(handoffStatuses.every(status => status === 200), true, JSON.stringify(handoffStatuses));
    const afterHandoff = await coordinator.inspectForTrustedRuntime();
    for (const [dimension, units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)) {
      assert.equal(afterHandoff.ownerIngress.closedCharges.find(charge => charge.dimension === dimension && charge.purpose === 'new-work')?.units, units * 2,
        `${dimension} keeps the email guard and owner-only execution after exact warm-block handoff`);
    }
    const tenantA = afterHandoff.tenantStates.find(tenant => tenant.tenantId === 'tenant-a');
    const tenantB = afterHandoff.tenantStates.find(tenant => tenant.tenantId === 'tenant-b');
    assert.ok(tenantA?.grants.length, 'tenant-a receives the server-derived handoff envelope');
    assert.equal(tenantB, undefined, 'a client query cannot select another tenant ledger');
    assert.ok(tenantA.grants.some(grant => (grant.envelope.d1RowsRead ?? 0) >= OWNER_INGRESS_EXECUTION_ENVELOPE.d1RowsRead!));
    const operationRows=await f.db.prepare(`SELECT operation_envelope_json FROM budget_grant_operations
      WHERE tenant_id='tenant-a' ORDER BY operation_id LIMIT 16`).all<{operation_envelope_json:string}>();
    assert.equal(operationRows.results.length,15);
    for(const row of operationRows.results)for(const [dimension,units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)){
      assert.ok((JSON.parse(row.operation_envelope_json)[dimension]??0)>=units*2,
        `${dimension} prepays both permitted ingress attempts in the tenant operation`);
    }
    assert.equal(tenantA.closedCharges.length,0,'retirement creates no fresh tenant reservation or charge');

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
        units * 3, `${dimension} retains the denied signed execution after transferring only the seven durably proven predecessors`);
    }

    const recovery = await f.mf.dispatchFetch('http://example.test/api/auth/logout', { method: 'POST' });
    assert.equal(recovery.status, 401);
    const afterRecovery = await coordinator.inspectForTrustedRuntime();
    assert.equal(afterRecovery.ownerIngress.closedCharges.find(charge => charge.dimension === 'workerRequests' && charge.purpose === 'recovery')?.units, 1);
  } finally { await f.mf.dispose(); }
});

test('distributed coordinator limits unauthenticated non-API ingress before owner reservation while preserving health and signed flow', async () => {
  const f = await fixture('owner-ingress-pre-admission');
  try {
    await seed(f.db);
    const namespace = await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = namespace.get(namespace.idFromName('owner-ingress-aggregate')) as unknown as BudgetCoordinatorDO;
    const statuses: number[] = [];
    const invalid = (url: string, headers: Record<string, string>) => f.mf.dispatchFetch(url, { headers });
    statuses.push((await invalid('http://example.test/unverified-owner-only', { Authorization: 'Bearer malformed', 'cf-connecting-ip': '198.51.100.10' })).status);
    statuses.push((await invalid('http://example.test/unverified-owner-only', { Cookie: 'lumina_customer_token=malformed', 'cf-connecting-ip': '198.51.100.10' })).status);
    statuses.push((await invalid('http://example.test/api/realtime?token=malformed', { 'cf-connecting-ip': '198.51.100.10' })).status);
    for (let index = 0; index < 6; index++) {
      statuses.push((await invalid('http://example.test/unverified-owner-only', { Authorization: 'Bearer malformed', 'cf-connecting-ip': '198.51.100.10' })).status);
    }
    assert.deepEqual(statuses.slice(0, 5), Array(5).fill(401));
    assert.deepEqual(statuses.slice(5), Array(4).fill(429));

    const afterFlood = await coordinator.inspectForTrustedRuntime();
    for (const [dimension, units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)) {
      assert.equal(afterFlood.ownerIngress.closedCharges.find(charge => charge.dimension === dimension && charge.purpose === 'new-work')?.units, units * 5,
        `${dimension} has exactly five one-request owner reservations after the invalid non-API flood`);
    }

    const health = await f.mf.dispatchFetch('http://example.test/health');
    assert.equal(health.status, 200, 'health remains available after anonymous admission is saturated');
    assert.equal(await health.text(), 'OK');
    const afterHealth = await coordinator.inspectForTrustedRuntime();
    assert.deepEqual(afterHealth.ownerIngress.grants, afterFlood.ownerIngress.grants,
      'health does not reserve owner capacity');

    const token = await new SignJWT({ tenant_id: 'tenant-a', role: 'admin', session_version: 1, mfa_verified: true })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('actor-a').setAudience('app').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const cookieSession = await f.mf.dispatchFetch('http://example.test/api/handoff', {
      method: 'POST', headers: { Cookie: `lumina_customer_token=${token}`, Origin: 'https://portal.example.test', 'cf-connecting-ip': '198.51.100.10' },
    });
    assert.equal(cookieSession.status, 200, 'a signed portal cookie bypasses the saturated unverified bucket');
    const realtimeSession = await f.mf.dispatchFetch(`http://example.test/api/realtime?token=${token}`, {
      headers: { 'cf-connecting-ip': '198.51.100.10' },
    });
    assert.equal(realtimeSession.status, 426, 'a signed realtime query credential bypasses the saturated unverified bucket');
    const preflight = await f.mf.dispatchFetch('http://example.test/api/handoff', {
      method: 'OPTIONS', headers: { Origin: 'https://portal.example.test', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(preflight.status, 204, 'CORS preflight remains available after anonymous admission is saturated');
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://portal.example.test');
  } finally { await f.mf.dispose(); }
});

test('separate Worker-isolate caches share an atomic anonymous reservation ceiling', async () => {
  const f = await fixture('owner-ingress-isolate-atomic');
  try {
    await seed(f.db);
    // Env exposes the Cloudflare binding as an unparameterized namespace; the
    // runtime proxy below is deliberately typed only at its RPC call boundary.
    const namespace = await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace;
    const coordinator = namespace.get(namespace.idFromName('owner-ingress-aggregate')) as unknown as BudgetCoordinatorDO;
    const caches = [new OwnerIngressAdmissionCache(), new OwnerIngressAdmissionCache()];
    const repository = new BudgetAuthorityRepository(f.db);
    let deliveries = 0;
    const lossy = { idFromName: namespace.idFromName.bind(namespace), get: () => ({
      reserveUnverifiedIngressFromTrustedAuthority: async (input: Parameters<BudgetCoordinatorDO['reserveUnverifiedIngressFromTrustedAuthority']>[0]) => {
        deliveries++;
        const result = await coordinator.reserveUnverifiedIngressFromTrustedAuthority(input);
        if (deliveries === 1) throw new Error('synthetic lost anonymous reservation acknowledgement');
        return result;
      },
      handoffIngressBatchFromTrustedAuthority: coordinator.handoffIngressBatchFromTrustedAuthority.bind(coordinator),
    }) } as unknown as DurableObjectNamespace;
    const first = await caches[0].admitUnverified({
      repository, namespace: lossy, purpose: 'new-work', now: () => NOW, limit: 5, windowMs: 60_000,
    });
    assert.equal(first.status, 'admitted');
    assert.equal(deliveries, 2, 'the lost acknowledgement retries with its original reservation identity');
    const outcomes = [first, ...await Promise.all(Array.from({ length: 5 }, (_, index) => caches[index % caches.length].admitUnverified({
      repository, namespace, purpose: 'new-work', now: () => NOW, limit: 5, windowMs: 60_000,
    })) )];
    assert.equal(outcomes.filter(outcome => outcome.status === 'admitted').length, 5);
    assert.equal(outcomes.filter(outcome => outcome.status === 'rejected' && outcome.reason === 'unverified-limit').length, 1);
    await Promise.all(outcomes.flatMap(outcome => outcome.status === 'admitted' ? [outcome.admission.finish(NOW + 1)] : []));
    const state = await coordinator.inspectForTrustedRuntime();
    for (const [dimension, units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)) {
      assert.equal(state.ownerIngress.closedCharges.find(charge => charge.dimension === dimension && charge.purpose === 'new-work')?.units, units * 5,
        `${dimension} has one owner envelope per accepted anonymous request across isolate caches`);
    }
    assert.equal(state.ownerIngress.grants.filter(grant => !grant.compacted).length, 0,
      'every accepted anonymous reservation closes independently; no isolate retains a warm owner block');
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

test('tenant admission prepays ingress liability before effects and fails closed on held-balance exhaustion',async()=>{
  const f=await fixture('owner-ingress-tenant-prepay'),g=await fixture('owner-ingress-tenant-held');
  try{
    await seed(f.db);
    const token=await new SignJWT({tenant_id:'tenant-a',role:'admin',session_version:1,mfa_verified:true})
      .setProtectedHeader({alg:'HS256'}).setSubject('actor-a').setAudience('app').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const constrained={...restriction(),limits:{...restriction().limits,workerRequests:4}};
    await f.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='tenant-a'").bind(JSON.stringify(constrained)).run();
    const denied=await f.mf.dispatchFetch('http://example.test/api/handoff',{method:'POST',headers:{Authorization:`Bearer ${token}`}});
    assert.equal(denied.status,503,'old business/control capacity cannot admit without both ingress attempts prepaid');
    assert.equal((await f.db.prepare('SELECT count(*) AS total FROM budget_grant_operations').first<{total:number}>())?.total,0);

    await seed(g.db);
    const enough={...restriction(),limits:{...restriction().limits,workerRequests:50}};
    await g.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='tenant-a'").bind(JSON.stringify(enough)).run();
    const statuses=[];for(let index=0;index<9;index++)statuses.push((await g.mf.dispatchFetch(`http://example.test/api/handoff?n=${index}`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`}})).status);
    assert.deepEqual(statuses.slice(0,8),Array(8).fill(200));
    assert.equal(statuses[8],503,'a spent prepaid tenant block cannot refill beyond tenant capacity');
    const namespace=await g.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const state=await (namespace.get(namespace.idFromName('owner-ingress-aggregate')) as unknown as BudgetCoordinatorDO).inspectForTrustedRuntime();
    assert.equal(state.tenantStates[0].grants.length,1);
  }finally{await f.mf.dispose();await g.mf.dispose()}
});

test('one canonical operation releases at most its two admitted ingress attempts across blocks',async()=>{
  const f=await fixture('owner-ingress-attempt-bound');
  try{
    await seed(f.db);
    const token=await new SignJWT({tenant_id:'tenant-a',role:'admin',session_version:1,mfa_verified:true})
      .setProtectedHeader({alg:'HS256'}).setSubject('actor-a').setAudience('app').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const send=(operation:string)=>f.mf.dispatchFetch(`http://example.test/api/handoff?operation=${operation}`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`}});
    const second=await send('canonical-replay');assert.equal(second.status,200,JSON.stringify(await second.json()));
    for(let index=0;index<7;index++)assert.equal((await send(`first-fill-${index}`)).status,200);
    const retry=await send('canonical-replay');assert.equal(retry.status,200,JSON.stringify(await retry.json()));
    for(let index=0;index<7;index++)assert.equal((await send(`second-fill-${index}`)).status,200);
    assert.equal((await send('canonical-replay')).status,503,'the third attempt receives no tenant proof');
    for(let index=0;index<7;index++)assert.equal((await send(`third-fill-${index}`)).status,200);
    const namespace=await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const state=await (namespace.get(namespace.idFromName('owner-ingress-aggregate')) as unknown as BudgetCoordinatorDO).inspectForTrustedRuntime();
    assert.equal(state.ownerIngress.closedCharges.find(charge=>charge.dimension==='workerRequests'&&charge.purpose==='new-work')?.units,1,
      'only the rejected third attempt remains charged to owner ingress');
    assert.equal((await f.db.prepare("SELECT count(*) AS total FROM budget_grant_operations WHERE operation_id='canonical-replay'").first<{total:number}>())?.total,1,
      'both admitted attempts reuse one exact durable business operation');
  }finally{await f.mf.dispose()}
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
        handoffIngressBatchFromTrustedAuthority: async (input: Parameters<BudgetCoordinatorDO['handoffIngressBatchFromTrustedAuthority']>[0]) => {
          reconcileCalls++;
          const result = await target.handoffIngressBatchFromTrustedAuthority(input);
          if (reconcileCalls === 1) throw new Error('synthetic lost closure acknowledgement');
          return result;
        },
      }),
    } as unknown as DurableObjectNamespace;
    const cache = new OwnerIngressAdmissionCache();
    let proofReads=0;
    const repository=new BudgetAuthorityRepository(f.db);
    repository.hasDurableGrantOperation=async()=>{proofReads++;return false};
    const admissions = [];
    for(let index=0;index<8;index++){
      const admitted=await cache.admit({repository,namespace:lossy,purpose:'new-work',now:()=>NOW});
      assert.equal(admitted.status,'admitted');if(admitted.status!=='admitted')throw new Error('expected warm admission');
      admitted.admission.tenantHandoff('tenant-a',NOW);
      admitted.admission.handoffToTenant('tenant-a',{grant:{tenantId:'tenant-a',aggregateId:'owner-ingress-aggregate',
        reservationId:'synthetic-business',holderId:'synthetic-holder',operationId:`operation-${index}`,
        operationFingerprint:`fingerprint-${index}`,operationEnvelope:{workerRequests:2}}} as never);
      admissions.push(admitted.admission);
    }
    const rollover=cache.admit({repository,namespace:lossy,purpose:'new-work',now:()=>NOW+1});
    await Promise.all(admissions.map(admission=>admission.finish(NOW+1)));
    assert.equal((await rollover).status,'admitted');
    assert.equal(reserveCalls,3,'one lost initial delivery plus one first block and one rollover reservation');
    assert.equal(reconcileCalls, 2);
    assert.equal(proofReads,8,'concurrent rollover performs one sealed bounded proof-read sequence');
    const state = await target.inspectForTrustedRuntime();
    assert.equal(state.ownerIngress.grants.length,2,'rollover creates exactly one next warm block');
    assert.equal(state.ownerIngress.grants[0].holderSeedAttempts,2,'lost delivery acknowledgement reuses the first reservation');
    assert.equal(state.ownerIngress.grants.filter(grant=>!grant.compacted).length,1,'only the rollover block remains open');
    assert.equal(state.ownerIngress.closedCharges.find(charge => charge.dimension === 'workerRequests')?.units,8);

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

test('concurrent failed discovery is serialized and trips the bounded latch by wave', async()=>{
  const cache=new OwnerIngressAdmissionCache(),identity={},namespace={} as DurableObjectNamespace;
  let discoveries=0;
  const repository={bindingIdentity:identity,resolveForDeploymentIngress:async()=>{discoveries++;await Promise.resolve();return null;}} as unknown as BudgetAuthorityRepository;
  for(let wave=1;wave<=3;wave++){
    const results=await Promise.all(Array.from({length:32},()=>cache.admit({repository,namespace,purpose:'new-work',now:()=>NOW})));
    assert.equal(results.every(result=>result.status==='rejected'),true);
    assert.equal(discoveries,wave,'one discovery is shared by all concurrent requests in a failed wave');
  }
  await Promise.all(Array.from({length:32},()=>cache.admit({repository,namespace,purpose:'new-work',now:()=>NOW})));
  assert.equal(discoveries,3,'terminal failure blocks later discovery without additional I/O');
  assert.deepEqual(cache.inspectForTrustedRuntime(),{bindings:1,failedAdmissions:3,terminalFailures:1});
});

test('concurrent callers recheck shared warm-block capacity after allocation',async()=>{
  const cache=new OwnerIngressAdmissionCache(),identity={};let release:()=>void=()=>{};
  const discovered=new Promise<void>(resolve=>{release=resolve});let reservations=0;
  const authority={aggregateId:'concurrent-owner-ingress',ownerPolicy:{policyId:'concurrent-policy',revision:1,budgets:[]},tenantAllocations:[],
    authorityCheckedAt:NOW,authorityRevision:1,authorityExpiresAt:NOW+60_000,maxReservations:64};
  const coordinator={refreshFromTrustedAuthority:async()=>{},reserveIngressFromTrustedAuthority:async()=>({status:'granted' as const,
    reservation:{reservationId:`reservation-${++reservations}`,holderId:'holder',expiresAt:NOW+60_000}}),
    handoffIngressBatchFromTrustedAuthority:async()=>({status:'handed-off' as const})};
  const repository={bindingIdentity:identity,resolveForDeploymentIngress:async()=>{await discovered;return authority;},hasDurableGrantOperation:async()=>false} as unknown as BudgetAuthorityRepository;
  const namespace={idFromName:(name:string)=>name,get:()=>coordinator} as unknown as DurableObjectNamespace;
  const admissions=Array.from({length:9},()=>cache.admit({repository,namespace,purpose:'new-work',now:()=>NOW}));
  await Promise.resolve();release();
  const results=await Promise.all(admissions);
  assert.equal(results.every(result=>result.status==='admitted'),true);
  assert.equal(reservations,2,'the ninth caller rolls over after the eight shared warm slots are issued');
});
