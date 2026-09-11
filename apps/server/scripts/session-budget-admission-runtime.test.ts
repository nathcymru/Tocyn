import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { CapabilityPolicyService } from '../src/repositories/capability-policy.repository';
import { SESSION_BUDGET_GROUP_CAPABILITY_SQL, SessionBudgetAuthorityRepository, type SessionBudgetCredential, type SessionBudgetRequirements } from '../src/repositories/session-budget-authority.repository';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import { SessionBudgetAdmissionService } from '../src/budgets/session-admission.service';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';

const NOW = Date.UTC(2026, 8, 11, 10, 0, 0);
const root = resolve(import.meta.dirname, '..');

/** Real D1/DO adapter proof; token signature verification and dashboard HTTP wiring are not claimed here. */
async function fixture(workerLimit = 1_000) {
  const bundled = await build({ entryPoints: ['scripts/budget-coordinator-do-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'session-budget-proof', modules: true,
    compatibilityDate: '2024-04-03', script: bundled.outputFiles[0].text, d1Databases: { DB: 'session-budget-d1' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
  }] }));
  try {
  const db = await mf.getD1Database('DB');
  for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
  }
  const limits = { workerRequests: workerLimit, d1RowsRead: 10_000_000, d1RowsWritten: 10_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 };
  const owner = { schemaVersion: 1, policyId: 'session-policy', revision: 1, deploymentId: 'session-deployment', mode: 'conservative',
    catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000,
    budgets: Object.entries(limits).map(([dimension, limit]) => ({ dimension, limit, allocationId: `session-${dimension}`, recoveryPercent: 20,
      provenance: 'owner-allocation', window: { kind: 'interval', id: 'session-window', startsAt: NOW - 1, endsAt: NOW + 3_600_000 } })) };
  await db.batch([
    db.prepare("INSERT INTO budget_deployment_authority VALUES ('session-deployment',1,'active',?)").bind(NOW),
    db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('session-deployment','session-policy',1,1,'session-aggregate',64,30000,?)`).bind(JSON.stringify(owner)),
  ]);
  for (const tenantId of ['tenant-a', 'tenant-b']) {
    const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: 'session-policy', ownerPolicyRevision: 1, revision: 1, mode: 'conservative', limits, disabledFeatures: [] };
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'shared-actor',?,'agent',1,1)").bind(tenantId, `${tenantId}@example.test`),
      db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES (?,'shared-group','Synthetic group')").bind(tenantId),
      db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,'shared-actor','shared-group')").bind(tenantId),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES (?,'shared-ticket','Synthetic','customer@example.test','shared-group','dashboard')").bind(tenantId),
      db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES ('session-deployment',?,'session-policy',1,1,?,?,'active')`).bind(tenantId, `session-${tenantId}`, JSON.stringify(restriction)),
      db.prepare("INSERT INTO tenant_role_capability_policies (tenant_id,role,capability,enabled,revision) VALUES (?,'agent','ticket-fields.manage',1,1)").bind(tenantId),
    ]);
  }
  await db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('tenant-b','only-b','Synthetic B','customer@example.test','shared-group','dashboard')").run();
  const rawNamespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
  const coordinator = rawNamespace.get(rawNamespace.idFromName('session-aggregate')) as unknown as BudgetCoordinatorDO;
  const calls = { refresh: 0, reserve: 0 };
  let loseAck = false;
  const namespace = {
    idFromName: (name: string) => rawNamespace.idFromName(name),
    get: () => ({
      refreshFromTrustedAuthority: async (value: Parameters<BudgetCoordinatorDO['refreshFromTrustedAuthority']>[0]) => { calls.refresh++; return coordinator.refreshFromTrustedAuthority(value); },
      reserveFromTrustedAuthority: async (value: Parameters<BudgetCoordinatorDO['reserveFromTrustedAuthority']>[0]) => {
        calls.reserve++; const outcome = await coordinator.reserveFromTrustedAuthority(value);
        if (loseAck && outcome.status === 'granted') { loseAck = false; throw new Error('synthetic lost committed grant reply'); }
        return outcome;
      },
    }),
  } as unknown as DurableObjectNamespace;
  const cache = new IsolateBudgetAdmissionCache();
  const service = new SessionBudgetAdmissionService(cache);
  const scopeFor = (tenantId: string) => createVerifiedTenantScope(tenantId, 'shared-actor', ['agent'], 1);
  const credentialFor = (tenantId: string): SessionBudgetCredential => ({ tenantId, actorId: 'shared-actor', role: 'agent', sessionVersion: 1, expiresAt: NOW / 1000 + 60, mfaVerified: true });
  const requirements: SessionBudgetRequirements = { ticket: { id: 'shared-ticket', groupId: 'shared-group' } };
  const admit = (operation: string, tenantId = 'tenant-a', credential = credentialFor(tenantId), needed = requirements) => {
    const scope = scopeFor(tenantId);
    return service.admit({ repository: new BudgetAuthorityRepository(db, scope), sessions: new SessionBudgetAuthorityRepository(db, scope),
      namespace, scope, credential, requirements: needed, now: () => NOW,
      intent: { operationId: operation, operationFingerprint: `digest:${operation}`, workScopeKey: 'synthetic-ticket-work' },
      business: { d1RowsRead: 2_560, d1RowsWritten: 1, logEvents: 136 } });
  };
  return { mf, db, coordinator, calls, cache, admit, scopeFor, credentialFor, requirements, loseAck: () => { loseAck = true; } };
  } catch (error) { await mf.dispose(); throw error; }
}

test('live session adapter shares warm grants for one authorized scope and isolates colliding tenant/actor/ticket IDs', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.admit('same-operation')).status, 'spent');
    const cold = { ...f.calls };
    assert.equal((await f.admit('second-operation')).status, 'spent');
    assert.equal((await f.admit('second-operation')).status, 'idempotent');
    assert.equal((await f.admit('second-operation')).reason, 'replay-exhausted');
    assert.deepEqual(f.calls, cold, 'all warm spends and bounded replays make zero budget DO calls');
    assert.equal((await f.admit('same-operation', 'tenant-b')).status, 'spent');
    const states = (await f.coordinator.inspectForTrustedRuntime()).tenantStates;
    assert.equal(states.find(state => state.tenantId === 'tenant-a')?.grants.length, 1);
    assert.equal(states.find(state => state.tenantId === 'tenant-b')?.grants.length, 1);
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 3);
  } finally { await f.mf.dispose(); }
});

test('session tenant/actor/role/MFA/expiry and wrong-target failures have no admission side effects', async () => {
  const f = await fixture();
  try {
    const credential = f.credentialFor('tenant-a');
    for (const changed of [
      { ...credential, tenantId: 'tenant-b' }, { ...credential, actorId: 'missing' }, { ...credential, role: 'admin' as const },
      { ...credential, sessionVersion: 0 }, { ...credential, expiresAt: NOW / 1000 }, { ...credential, mfaVerified: false },
    ]) assert.equal((await f.admit('denied', 'tenant-a', changed)).status, 'rejected');
    assert.equal((await f.admit('foreign', 'tenant-a', credential, { ticket: { id: 'only-b', groupId: 'shared-group' } })).status, 'rejected');
    assert.equal((await f.admit('wrong-group', 'tenant-a', credential, { ticket: { id: 'shared-ticket', groupId: null } })).status, 'rejected');
    assert.deepEqual(f.calls, { refresh: 0, reserve: 0 });
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>())?.count, 3);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM articles').first<{ count: number }>())?.count, 0);
  } finally { await f.mf.dispose(); }
});

for (const [label, mutation] of [
  ["session revocation", "UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='shared-actor'"],
  ["role change", "UPDATE users SET role='customer' WHERE tenant_id='tenant-a' AND id='shared-actor'"],
  ["MFA disable", "UPDATE users SET mfa_enabled=0 WHERE tenant_id='tenant-a' AND id='shared-actor'"],
  ["group membership removal", "DELETE FROM user_groups WHERE tenant_id='tenant-a' AND user_id='shared-actor' AND group_id='shared-group'"],
] as const) test(`live session changes reject a previously warm grant: ${label}`, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.admit('before-change')).status, 'spent');
    const before = { ...f.calls };
    await f.db.prepare(mutation).run();
    assert.equal((await f.admit('after-change')).status, 'rejected');
    assert.deepEqual(f.calls, before);
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 1);
    assert.equal((await f.admit('unaffected-other-tenant', 'tenant-b')).status, 'spent');
  } finally { await f.mf.dispose(); }
});

test('existing capability fences match the current owner/role/tenant/group contract and reject changed policy', async () => {
  const f = await fixture();
  try {
    const principal = { tenantId: 'tenant-a', actorId: 'shared-actor', role: 'agent', sessionVersion: 1 };
    const policy = new CapabilityPolicyService(f.db, f.scopeFor('tenant-a'));
    const decision = await policy.authorize(principal, 'ticket-fields.manage');
    assert.equal(decision.allowed, true);
    const needed = { ...f.requirements, capability: { ...principal, capability: decision.capability, policyFingerprint: decision.policyFingerprint } };
    assert.equal((await f.admit('capability-first', 'tenant-a', f.credentialFor('tenant-a'), needed)).status, 'spent');
    assert.equal((await f.admit('capability-warm', 'tenant-a', f.credentialFor('tenant-a'), needed)).status, 'spent');
    const before = { ...f.calls };
    await f.db.prepare(`INSERT INTO tenant_group_capability_constraints (tenant_id,group_id,capability,enabled,revision)
      VALUES ('tenant-a','shared-group','ticket-fields.manage',0,1)`).run();
    assert.equal((await f.admit('capability-denied', 'tenant-a', f.credentialFor('tenant-a'), needed)).status, 'rejected');
    assert.deepEqual(f.calls, before);
  } finally { await f.mf.dispose(); }
});

test('session capability membership reads stop at a 65-row sentinel and use tenant/user index lookup', async () => {
  const f = await fixture();
  try {
    const ids = Array.from({ length: 64 }, (_, index) => `bounded-group-${String(index).padStart(2, '0')}`);
    await f.db.batch(ids.flatMap(id => [
      f.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('tenant-a',?,?)").bind(id, id),
      f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('tenant-a','shared-actor',?)").bind(id),
    ]));
    const principal = { tenantId: 'tenant-a', actorId: 'shared-actor', role: 'agent', sessionVersion: 1 };
    const decision = await new CapabilityPolicyService(f.db, f.scopeFor('tenant-a')).authorize(principal, 'ticket-fields.manage');
    assert.equal(decision.allowed, true, 'the existing capability remains permitted; the budget adapter applies its finite-work bound');
    const needed = { ...f.requirements, capability: { ...principal, capability: decision.capability, policyFingerprint: decision.policyFingerprint } };
    assert.equal((await f.admit('too-many-groups', 'tenant-a', f.credentialFor('tenant-a'), needed)).status, 'rejected');
    const plan = await f.db.prepare(`EXPLAIN QUERY PLAN ${SESSION_BUDGET_GROUP_CAPABILITY_SQL}`)
      .bind('tenant-a', 'shared-actor', 'tenant-a', 'ticket-fields.manage').all<{ detail: string }>();
    assert.ok(plan.results.some((row: { detail: string }) => /SEARCH user_groups USING COVERING INDEX/.test(row.detail) && /tenant_id=\? AND user_id=\?/.test(row.detail)));
    assert.ok(plan.results.some((row: { detail: string }) => /SEARCH constraint_row USING INDEX/.test(row.detail) && /tenant_id=\? AND group_id=\? AND capability=\?/.test(row.detail)));
    assert.deepEqual(f.calls, { refresh: 0, reserve: 0 });
  } finally { await f.mf.dispose(); }
});

test('session adapter keeps finite cold retry and quota rejection before further accepted work', async () => {
  const f = await fixture(3);
  try {
    f.loseAck();
    assert.equal((await f.admit('only-capacity')).status, 'spent');
    assert.deepEqual(f.calls, { refresh: 2, reserve: 2 });
    const first = (await f.coordinator.inspectForTrustedRuntime()).tenantStates.find(state => state.tenantId === 'tenant-a')!.grants;
    assert.equal(first.length, 1); assert.equal(first[0].holderSeedAttempts, 2);
    assert.equal((await f.admit('exhausted')).reason, 'exhausted');
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 1);
  } finally { await f.mf.dispose(); }
});


test('session warm admission retires an exact same-revision source edit without affecting another tenant',async()=>{
  const f=await fixture();try{
    assert.equal((await f.admit('original')).status,'spent');
    assert.equal((await f.admit('original','tenant-b')).status,'spent');
    const calls={...f.calls};
    const original=(await f.db.prepare("SELECT restriction_json FROM budget_tenant_allocations WHERE tenant_id='tenant-a'").first<{restriction_json:string}>())!.restriction_json;
    const before=await f.coordinator.inspectForTrustedRuntime();
    await f.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=restriction_json||' ' WHERE tenant_id='tenant-a'").run();
    assert.equal((await f.admit('changed')).reason,'stale-policy');
    assert.equal((await f.admit('still-current','tenant-b')).status,'spent');
    assert.deepEqual(f.calls,calls,'current session checks and snapshot comparison add no warm DO calls');
    await f.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='tenant-a'").bind(original).run();
    assert.equal((await f.admit('changed')).reason,'stale-policy','restoring source does not reset a retired holder');
    assert.deepEqual((await f.coordinator.inspectForTrustedRuntime()).tenantStates,before.tenantStates,'no centrally held grant was refunded or replaced');
  }finally{await f.mf.dispose();}
});
