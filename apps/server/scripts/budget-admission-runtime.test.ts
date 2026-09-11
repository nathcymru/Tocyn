import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { createVerifiedTenantScope } from '../src/auth/scope';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import type { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

const serverRoot = resolve(import.meta.dirname, '..');
const now = Date.now();
// Opaque 256-bit machine credentials, never passwords or reusable fixture secrets.
const apiKey = `lt_budget_runtime.${randomBytes(32).toString('hex')}`;

async function credentialDigest(value: string): Promise<string> {
  // Match ApiAuthResolver's Web Crypto protocol for high-entropy API tokens.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('hex');
}

async function applyMigrations(db: D1Database): Promise<void> {
  const directory = join(serverRoot, 'migrations');
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(directory, file), 'utf8')).map(statement => db.prepare(statement)));
  }
}

function policy(overrides: Partial<Record<'workerRequests' | 'd1RowsRead' | 'd1RowsWritten' | 'doRequests' | 'doRowsWritten' | 'doRowsRead' | 'logEvents', number>> = {}) {
  const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'doRequests', 'doRowsWritten', 'doRowsRead', 'logEvents'] as const;
  const limits = { workerRequests: 3, d1RowsRead: 8_000, d1RowsWritten: 100, doRequests: 10, doRowsWritten: 10, doRowsRead: 10, logEvents: 200, ...overrides };
  return {
    schemaVersion: 1, policyId: 'runtime-owner-policy', revision: 1, deploymentId: 'runtime-deployment',
    mode: 'conservative', catalogueVersion: 'runtime-catalogue', maxGrantLifetimeMs: 60_000,
    budgets: dimensions.map(dimension => ({ dimension, allocationId: `runtime-${dimension}`,
      window: { kind: 'interval', id: 'runtime-window', startsAt: now - 1_000, endsAt: now + 60_000 },
      limit: limits[dimension], recoveryPercent: 20, provenance: 'owner-allocation' as const })),
  };
}

async function seed(db: D1Database, extraTenants = 31, owner = policy()): Promise<void> {
  const tenantId = 'runtime-tenant';
  const keyHash = await credentialDigest(apiKey);
  const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: owner.policyId, ownerPolicyRevision: 1,
    revision: 1, mode: 'conservative', limits: Object.fromEntries(owner.budgets.map(item => [item.dimension, item.limit])), disabledFeatures: [] };
  await db.batch([
    db.prepare(`INSERT INTO api_keys (tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
      VALUES (?,?,?,?,?,'tickets:write',1,unixepoch())`).bind(tenantId, 'runtime-key', 'runtime key', keyHash, 'lt_budget'),
    db.prepare(`INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at)
      VALUES ('runtime-deployment',1,'active',?)`).bind(now),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('runtime-deployment','runtime-owner-policy',1,1,'runtime-owner-coordinator',64,?,?)`).bind(Math.min(owner.maxGrantLifetimeMs,60_000), JSON.stringify(owner)),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('runtime-deployment',?,'runtime-owner-policy',1,1,'runtime-namespace',?,'active')`).bind(tenantId, JSON.stringify(restriction)),
  ]);
  // Exercise an enabled multi-tenant authority below the serialized RPC cap;
  // the separate authority test covers the 128-allocation sentinel and plan.
  const extraAllocationStatements = Array.from({ length: extraTenants }, (_, index) => {
    const extraTenant = `runtime-extra-${String(index).padStart(3, '0')}`;
    const extraRestriction = { ...restriction, tenantId: extraTenant };
    return db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('runtime-deployment',?,'runtime-owner-policy',1,1,?,?,'active')`)
      .bind(extraTenant, `runtime-namespace-${index}`, JSON.stringify(extraRestriction));
  });
  if (extraAllocationStatements.length > 0) await db.batch(extraAllocationStatements);
}

test('real local API-key create reserves configured aggregate capacity before its mutation commit', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' },
      unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    await seed(db);
    const snapshot = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(snapshot.kind, 'active');
    if (snapshot.kind !== 'active') throw new Error('expected active synthetic authority');
    assert.equal(snapshot.authority.tenantAllocations.length, 32);
    const coordinatorNamespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = coordinatorNamespace.get(coordinatorNamespace.idFromName(snapshot.authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    await coordinator.refreshFromTrustedAuthority(snapshot.authority);
    const request = () => mf!.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ subject: 'Budgeted runtime ticket', customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    const accepted = await request();
    assert.equal(accepted.status, 201);
    const acceptedBody = await accepted.json() as { id: string };
    const rejected = await request();
    assert.equal(rejected.status, 429);
    assert.deepEqual(await rejected.json(), { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' });
    const reply = await mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${acceptedBody.id}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ body: 'must not commit' }),
    });
    assert.equal(reply.status, 429, 'the reply route uses the same configured admission boundary');
    await reply.body?.cancel();
    const tickets = await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>();
    const articles = await db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant'").first<{ count: number }>();
    assert.equal(tickets?.count, 1, 'budget rejection occurs before the second ticket mutation batch');
    assert.equal(articles?.count, 1, 'budget rejection occurs before the reply mutation batch');
  } finally {
    await mf?.dispose();
  }
});

async function warmHarness(owner = policy({ workerRequests: 1_000, d1RowsRead: 1_000_000, d1RowsWritten: 10_000,
  doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 }), extraTenants = 0) {
  const bundled = await build({ entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'budget-warm-proof', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
    d1Databases: { DB: 'budget-warm-d1' }, durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' },
    unsafeEphemeralDurableObjects: true,
  }] }));
  const db = await mf.getD1Database('DB');
  await applyMigrations(db); await seed(db, extraTenants, owner);
  const control = async (value?: object) => (await (await mf.dispatchFetch('http://runtime.test/__budget-control',
    value ? { method: 'POST', body: JSON.stringify(value) } : undefined)).json()) as any;
  await control({ now: now + 1 });
  const create = (key: string, subject = key, token = apiKey) => mf.dispatchFetch('http://runtime.test/api/v1/tickets', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': token, 'idempotency-key': key },
    body: JSON.stringify({ subject, customer_email: 'runtime@example.test', body: 'synthetic' }),
  });
  const namespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
  const coordinator = namespace.get(namespace.idFromName('runtime-owner-coordinator')) as unknown as BudgetCoordinatorDO;
  const grants = async () => (await coordinator.inspectForTrustedRuntime()).tenantStates.flatMap(state => state.grants);
  const count = async () => (await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count;
  return { mf, db, control, create, coordinator, grants, count };
}

test('concurrent cold admission shares one allocation and warm canonical replay never repeats a mutation', async () => {
  const h = await warmHarness();
  try {
    const concurrent = await Promise.all(Array.from({ length: 5 }, (_, index) => h.create(`concurrent-${index}`)));
    assert.deepEqual(concurrent.map(response => response.status), [201, 201, 201, 201, 201]);
    await Promise.all(concurrent.map(response => response.body?.cancel()));
    assert.deepEqual((await h.control()).calls, { refresh: 1, reserve: 1, revoke: 0 });
    assert.equal((await h.grants()).length, 1);
    const before = await h.control();
    const same = await Promise.all([h.create('same-operation'), h.create('same-operation')]);
    assert.equal(same.filter(response => response.status === 201).length >= 1, true);
    assert.equal(same.every(response => [201, 503].includes(response.status)), true);
    await Promise.all(same.map(response => response.body?.cancel()));
    const replay = await h.create('same-operation');
    assert.equal(replay.status, 201); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true'); await replay.body?.cancel();
    const conflict = await h.create('same-operation', 'different normalized work');
    assert.equal(conflict.status, 409); await conflict.body?.cancel();
    assert.equal(await h.count(), 6, 'one durable canonical mutation for the concurrent same-key operation');
    const after = await h.control();
    assert.deepEqual(after.calls, before.calls, 'warm and canonical replay/conflict make no DO calls');
    assert.equal(after.cache.operations, 6);
  } finally { await h.mf.dispose(); }
});

test('one lost committed cold response retries into the same live holder and keeps warm execution local', async () => {
  const h = await warmHarness();
  try {
    await h.control({ loseReserveAck: true });
    const first = await h.create('lost-allocation-ack'); assert.equal(first.status, 201); await first.body?.cancel();
    assert.deepEqual((await h.control()).calls, { refresh: 2, reserve: 2, revoke: 0 });
    assert.equal((await h.grants()).length, 1);
    assert.equal((await h.grants())[0].holderSeedAttempts, 2);
    const second = await h.create('warm-after-recovered-ack'); assert.equal(second.status, 201); await second.body?.cancel();
    assert.deepEqual((await h.control()).calls, { refresh: 2, reserve: 2, revoke: 0 });
    assert.equal(await h.count(), 2);
  } finally { await h.mf.dispose(); }
});

test('two lost committed responses exhaust the finite cold retry and retain the unacknowledged charge', async () => {
  const h = await warmHarness();
  try {
    await h.control({ loseReserveAcks: 2 });
    const failed = await h.create('twice-lost-allocation'); assert.equal(failed.status, 503); await failed.body?.cancel();
    assert.deepEqual((await h.control()).calls, { refresh: 2, reserve: 2, revoke: 0 });
    assert.equal(await h.count(), 0, 'uncertain allocation delivery never authorizes canonical work');
    const lost = (await h.grants())[0];
    assert.equal(lost.holderSeedAttempts, 2); assert.equal(lost.accounted.workerRequests, 16);
    const fresh = await h.create('twice-lost-allocation'); assert.equal(fresh.status, 201); await fresh.body?.cancel();
    const grants = await h.grants();
    assert.equal(grants.length, 2); assert.notEqual(grants[0].holderId, grants[1].holderId);
    assert.equal(grants[0].accounted.workerRequests, 16, 'replacement holder receives a separately charged block');
    assert.deepEqual((await h.control()).calls, { refresh: 3, reserve: 3, revoke: 0 });
  } finally { await h.mf.dispose(); }
});

test('warm admission observes current credential and restriction revocation before mutation with zero DO calls', async () => {
  const h = await warmHarness();
  try {
    const first = await h.create('before-revoke'); assert.equal(first.status, 201); await first.body?.cancel();
    const before = await h.control();
    await h.db.prepare("UPDATE api_keys SET is_active=0 WHERE tenant_id='runtime-tenant' AND id='runtime-key'").run();
    const revoked = await h.create('revoked-key'); assert.equal(revoked.status, 401); await revoked.body?.cancel();
    await h.db.prepare("UPDATE api_keys SET is_active=1 WHERE tenant_id='runtime-tenant' AND id='runtime-key'").run();
    const row = await h.db.prepare("SELECT restriction_json FROM budget_tenant_allocations WHERE tenant_id='runtime-tenant'").first<{ restriction_json: string }>();
    const restriction = JSON.parse(row!.restriction_json); restriction.revision = 2;
    await h.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='runtime-tenant'").bind(JSON.stringify(restriction)).run();
    const changed = await h.create('changed-restriction'); assert.equal(changed.status, 503); await changed.body?.cancel();
    // A later stale snapshot cannot revive a retired cache entry.
    restriction.revision = 1;
    await h.db.prepare("UPDATE budget_tenant_allocations SET restriction_json=? WHERE tenant_id='runtime-tenant'").bind(JSON.stringify(restriction)).run();
    const stale = await h.create('restored-old-restriction'); assert.equal(stale.status, 503); await stale.body?.cancel();
    assert.equal(await h.count(), 1);
    assert.deepEqual((await h.control()).calls, before.calls);
  } finally { await h.mf.dispose(); }
});

for (const loss of ['discard', 'expiry'] as const) test(`${loss} retains the original central charge; one bounded smaller block can use only remaining capacity`, async () => {
  const owner = policy({ workerRequests: 27, d1RowsRead: 200_000, d1RowsWritten: 2_000,
    doRequests: 100, doRowsRead: 100, doRowsWritten: 100, logEvents: 10_000 });
  if (loss === 'expiry') owner.maxGrantLifetimeMs = 10_000;
  const h = await warmHarness(owner);
  try {
    const first = await h.create(`before-${loss}`); assert.equal(first.status, 201); await first.body?.cancel();
    const initial = (await h.grants())[0];
    assert.equal(initial.accounted.workerRequests, 16);
    await h.control(loss === 'discard' ? { discard: true } : { now: now + 10_002 });
    const second = await h.create(`after-${loss}`); assert.equal(second.status, 201); await second.body?.cancel();
    const grants = await h.grants();
    assert.equal(grants.length, 2);
    assert.notEqual(grants[0].holderId, grants[1].holderId);
    assert.equal(grants[0].accounted.workerRequests, 16, 'lost/expired unused balance is not returned');
    assert.equal(grants[1].accounted.workerRequests, 2, 'only the explicit one-operation fallback fits remaining owner capacity');
    if (loss === 'expiry') assert.equal(grants[0].status, 'uncertain');
    assert.deepEqual((await h.control()).calls, { refresh: 3, reserve: 3, revoke: 0 }, 'one initial block plus one rejected large block and one bounded fallback');
    assert.equal(await h.count(), 2);
  } finally { await h.mf.dispose(); }
});

test('four eight-operation blocks cap refill work while the owner recovery partition remains available', async () => {
  const h = await warmHarness();
  try {
    for (let index = 0; index < 32; index++) {
      const response = await h.create(`bounded-operation-${index}`); assert.equal(response.status, 201); await response.body?.cancel();
    }
    const before = await h.control();
    assert.deepEqual(before.cache, { scopes: 1, holders: 4, operations: 32, refills: 4 });
    const rejected = await h.create('refill-cap'); assert.equal(rejected.status, 429); await rejected.body?.cancel();
    assert.deepEqual((await h.control()).calls, before.calls, 'refill cap rejects before any further control-plane call');
    assert.equal((await h.grants()).every(grant => grant.purpose === 'new-work'), true);
    const recovery = await h.coordinator.reserveFromTrustedAuthority({ tenantId: 'runtime-tenant', holderId: 'synthetic-recovery-holder',
      idempotencyKey: 'synthetic-recovery', purpose: 'recovery', envelope: { workerRequests: 200 }, expectedPolicyId: 'runtime-owner-policy',
      expectedPolicyRevision: 1, expectedRestrictionRevision: 1, now: now + 2 });
    assert.equal(recovery.status, 'granted', 'active new-work blocks never borrow the 20% recovery reserve');
    assert.equal(await h.count(), 32);
  } finally { await h.mf.dispose(); }
});

test('the shared isolate registry rejects its 65th authorized scope before another DO call', async () => {
  const h = await warmHarness(policy({ workerRequests: 10_000, d1RowsRead: 5_000_000, d1RowsWritten: 100_000,
    doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 1_000_000 }));
  try {
    const first = await h.create('scope-fixture'); assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: string };
    const source = await h.db.prepare("SELECT * FROM tickets WHERE tenant_id='runtime-tenant' AND id=?").bind(firstBody.id).first<Record<string, unknown>>();
    assert.ok(source);
    const targets = Array.from({ length: 64 }, () => crypto.randomUUID());
    const columns = Object.keys(source);
    // Synthetic authorized targets only; all normal reply authentication and
    // canonical mutation code still runs for the requests below.
    await h.db.batch(targets.map((target, index) => {
      const ticket = { ...source, id: target, ticket_no: index + 2 };
      return h.db.prepare(`INSERT INTO tickets (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
        .bind(...columns.map(column => ticket[column]));
    }));
    const reply = (target: string) => h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${target}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ body: 'synthetic bounded scope' }),
    });
    for (const target of targets.slice(0, 63)) {
      const response = await reply(target); assert.equal(response.status, 201); await response.body?.cancel();
    }
    const before = await h.control();
    assert.equal(before.cache.scopes, 64);
    const rejected = await reply(targets[63]); assert.equal(rejected.status, 429); await rejected.body?.cancel();
    assert.deepEqual((await h.control()).calls, before.calls);
    assert.equal((await h.db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant' AND ticket_id=?").bind(targets[63]).first<{ count: number }>())?.count, 0);
  } finally { await h.mf.dispose(); }
});

test('two live tenant credentials retain separate warm grants and wrong-tenant targets have no side effects', async () => {
  const h = await warmHarness(undefined, 1);
  try {
    const otherKey = `lt_budget_other.${randomBytes(32).toString('hex')}`;
    await h.db.prepare(`INSERT INTO api_keys (tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
      VALUES ('runtime-extra-000','runtime-other-key','synthetic other',?,'lt_budget','tickets:write',1,unixepoch())`)
      .bind(await credentialDigest(otherKey)).run();
    const first = await h.create('colliding-key'); assert.equal(first.status, 201); const ticket = await first.json() as { id: string };
    const second = await h.create('colliding-key', 'other tenant canonical work', otherKey); assert.equal(second.status, 201); await second.body?.cancel();
    assert.equal((await h.control()).cache.scopes, 2);
    const before = await h.control();
    const denied = await h.mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${ticket.id}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': otherKey }, body: JSON.stringify({ body: 'must not commit' }),
    });
    assert.equal(denied.status, 404); await denied.body?.cancel();
    assert.deepEqual((await h.control()).calls, before.calls);
    assert.equal((await h.db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-extra-000'").first<{ count: number }>())?.count, 1);
    assert.equal((await h.grants()).length, 2);
  } finally { await h.mf.dispose(); }
});

test('real local API creates and same-ticket replies reuse prepaid blocks without warm DO calls', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-multiple-grants-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-multiple-grants-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    await seed(db, 0, policy({ workerRequests: 40, d1RowsRead: 120_000, d1RowsWritten: 2_000,
      doRequests: 40, doRowsWritten: 40, doRowsRead: 40, logEvents: 10_000 }));
    const request = (subject: string, key: string) => mf!.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'idempotency-key': key },
      body: JSON.stringify({ subject, customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    const first = await request('First independently budgeted ticket', 'multiple-create-1');
    const firstControl = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as any;
    const second = await request('Second independently budgeted ticket', 'multiple-create-2');
    assert.deepEqual((await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as any).calls, firstControl.calls, 'warm create performs zero DO calls');
    assert.equal(first.status, 201); assert.equal(second.status, 201);
    const firstTicket = await first.json() as { id: string };
    const secondTicket = await second.json() as { id: string };
    const reply = (ticketId: string, body: string, key: string) => mf!.dispatchFetch(`http://runtime.test/api/v1/tickets/${ticketId}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'idempotency-key': key }, body: JSON.stringify({ body }),
    });
    const firstReply = await reply(firstTicket.id, 'first independently budgeted reply', 'multiple-reply-1');
    const replyControl = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as any;
    const secondReply = await reply(firstTicket.id, 'second independently budgeted reply', 'multiple-reply-2');
    assert.equal(firstReply.status, 201); assert.equal(secondReply.status, 201);
    assert.deepEqual((await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as any).calls, replyControl.calls, 'warm exact-target reply performs zero DO calls');
    await Promise.all([firstReply.body?.cancel(), secondReply.body?.cancel()]);

    const replay = await reply(firstTicket.id, 'first independently budgeted reply', 'multiple-reply-1');
    assert.equal(replay.status, 201, 'the canonical replay must not create a fifth budget grant');
    await replay.body?.cancel();

    const snapshot = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(snapshot.kind, 'active');
    if (snapshot.kind !== 'active') throw new Error('expected active synthetic authority');
    const coordinators = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = coordinators.get(coordinators.idFromName(snapshot.authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    const grants = (await coordinator.inspectForTrustedRuntime()).tenantStates.find(state => state.tenantId === 'runtime-tenant')?.grants ?? [];
    assert.equal(grants.length, 2, 'creates share one block and same-ticket replies share another');
    assert.equal(new Set(grants.map(grant => grant.reservationId)).size, 2);
    const holders = await mf.getDurableObjectNamespace('BUDGET_GRANT_HOLDER_DO') as unknown as DurableObjectNamespace<BudgetGrantHolderDO>;
    for (const grant of grants) {
      const holder = holders.get(holders.idFromName(JSON.stringify([
        'budget-grant-holder-v2', 'runtime-tenant', grant.holderId, grant.reservationId,
      ]))) as any;
      const stored = await holder.inspectForTrustedRuntime();
      assert.equal(stored, null, 'an isolate grant is never also seeded into a durable holder');
    }
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 2);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 4);
  } finally { await mf?.dispose(); }
});


test('full 128-allocation authority that exceeds the bounded DO payload fails closed before mutation', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-oversize-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-oversize-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB'); await applyMigrations(db); await seed(db, 127);
    const resolution = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(resolution.kind, 'unavailable', 'oversized configured authority never reaches a coordinator RPC');
    const response = await mf.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ subject: 'must not commit', customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    assert.equal(response.status, 503);
    await response.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 0);
  } finally { await mf?.dispose(); }
});
