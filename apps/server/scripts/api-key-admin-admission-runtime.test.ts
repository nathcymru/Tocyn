import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { SignJWT } from 'jose';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { apiKeyAdminEnvelope } from '../src/budgets/api-key-admin-admission.service';

const root = resolve(import.meta.dirname, '..');
const now = Date.now();
const secret = 'synthetic-api-key-admin-secret-32';
const actor = '00000000-0000-4000-8000-000000000001';
const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents'] as const;

async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function token() {
  return new SignJWT({ sub: actor, role: 'agent', tenant_id: 'key-tenant', session_version: 1, mfa_verified: true })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('app').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

async function fixture(population = 0, limit = 10_000_000) {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'api-key-admin-admission-runtime-entry.ts')],
    bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'api-key-admin-proof', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true', JWT_SECRET: secret },
    d1Databases: { DB: 'api-key-admin-d1' }, r2Buckets: { ATTACHMENTS_BUCKET: 'api-key-admin-r2' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
    unsafeEphemeralDurableObjects: true }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
    }
    const limits = Object.fromEntries(dimensions.map(dimension => [dimension, limit]));
    const owner = { schemaVersion: 1, policyId: 'key-policy', revision: 1, deploymentId: 'key-deployment', mode: 'conservative',
      catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000, budgets: dimensions.map(dimension => ({ dimension, limit,
        allocationId: `key-${dimension}`, recoveryPercent: 20, provenance: 'owner-allocation',
        window: { kind: 'interval', id: 'key-window', startsAt: now - 1_000, endsAt: now + 3_600_000 } })) };
    const restriction = { schemaVersion: 1, tenantId: 'key-tenant', ownerPolicyId: owner.policyId, ownerPolicyRevision: 1,
      revision: 1, mode: 'conservative', limits, disabledFeatures: [] };
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES('key-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies(deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES('key-deployment','key-policy',1,1,'key-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
      db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES('key-deployment','key-tenant','key-policy',1,1,'key-tenant',?,'active')`).bind(JSON.stringify(restriction)),
      db.prepare("INSERT INTO users(tenant_id,id,email,full_name,role,session_version,mfa_enabled) VALUES('key-tenant',?,'operator@example.test','Operator','agent',1,1)").bind(actor),
      db.prepare("INSERT INTO tenant_role_capability_policies(tenant_id,role,capability,enabled) VALUES('key-tenant','agent','api-keys.manage',1)"),
      db.prepare(`INSERT INTO api_keys(tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
        VALUES('foreign-tenant','foreign-key','Foreign key','foreign-key-hash','foreign','tickets:read',1,'2026-01-01T00:00:00Z')`),
    ]);
    if (population > 0) await db.prepare(`WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i+1<?)
      INSERT INTO api_keys(tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
      SELECT 'key-tenant',printf('key-%06d',i),'Key '||i,'hash-'||i,printf('p%07d',i),'tickets:read',1,datetime(1767225600+i,'unixepoch') FROM seq`)
      .bind(population).run();
    if (population > 0) await db.prepare(`WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i+1<400)
      INSERT INTO api_keys(tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
      SELECT 'foreign-tenant',printf('foreign-%06d',i),'Foreign '||i,'foreign-hash-'||i,printf('f%07d',i),'tickets:read',1,datetime(1767225600+i,'unixepoch') FROM seq`).run();
    return { mf, db };
  } catch (error) { await mf.dispose(); throw error; }
}

async function request(mf: Miniflare, path: string, auth: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {}) {
  const headers = new Headers({ authorization: `Bearer ${auth}` });
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.idempotencyKey) headers.set('idempotency-key', init.idempotencyKey);
  return mf.dispatchFetch(`http://runtime.test${path}`, { method: init.method, headers: Object.fromEntries(headers.entries()),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
}
async function control(mf: Miniflare, body?: unknown) {
  return (await (await mf.dispatchFetch('http://runtime.test/__api-key-control', body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)).json()) as any;
}

test('complete 2,801-key metadata list uses its maintained dynamic reservation and rejects growth', async t => {
  const f = await fixture(2_801);
  try {
    const auth = await token();
    const listed = await request(f.mf, '/api/api-keys', auth); assert.equal(listed.status, 200, await listed.clone().text());
    const body = await listed.json() as Record<string, unknown>[];
    assert.equal(body.length, 2_801); assert.ok(body.every(row => !('key_hash' in row) && !('apiKey' in row)));
    assert.ok(body.every(row => row.id !== 'foreign-key'));
    await control(f.mf, { kind: 'growth' });
    const raced = await request(f.mf, '/api/api-keys', auth); assert.equal(raced.status, 503); await raced.body?.cancel();
    const retried = await request(f.mf, '/api/api-keys', auth); assert.equal(retried.status, 200);
    assert.equal((await retried.json() as unknown[]).length, 2_802);
    const measured = (await control(f.mf)).measurements as { path: string; rowsRead: number; rowsWritten: number }[];
    const attempt = measured.find(item => item.path === '/api/api-keys')!;
    const reserved = apiKeyAdminEnvelope('api-key.list', 2_801)!;
    assert.ok(attempt.rowsRead <= (reserved.d1RowsRead ?? 0)); assert.ok(attempt.rowsWritten <= (reserved.d1RowsWritten ?? 0));
    t.diagnostic(`native 2,801-key list: ${attempt.rowsRead} D1 rows read / ${attempt.rowsWritten} written; reserved ${reserved.d1RowsRead}/${reserved.d1RowsWritten}`);
  } finally { await f.mf.dispose(); }
});

test('creation returns plaintext once, retry is metadata-only, and revocation is tenant-scoped', async t => {
  const f = await fixture();
  try {
    const auth = await token(); const key = 'logical-create-1';
    const created = await request(f.mf, '/api/api-keys', auth, { method: 'POST', body: { name: 'CRM' }, idempotencyKey: key });
    assert.equal(created.status, 201, await created.clone().text());
    const value = await created.json() as { apiKey: string; id: string; name: string; prefix: string };
    assert.match(value.apiKey, /^lt_[A-Za-z0-9]{8}\.[A-Za-z0-9]{32}$/);
    const replay = await request(f.mf, '/api/api-keys', auth, { method: 'POST', body: { name: 'CRM' }, idempotencyKey: key });
    assert.equal(replay.status, 409); const replayBody = await replay.json() as any;
    assert.equal(replayBody.code, 'api_key_plaintext_unavailable'); assert.equal(replayBody.key.id, value.id);
    assert.equal(replayBody.key.prefix, value.prefix); assert.equal(replayBody.apiKey, undefined);
    const conflict = await request(f.mf, '/api/api-keys', auth, { method: 'POST', body: { name: 'Different' }, idempotencyKey: key });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json() as any).code, 'idempotency_conflict');
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM api_keys WHERE tenant_id='key-tenant'").first<{ count: number }>())!.count, 1);
    const receipt = await f.db.prepare('SELECT * FROM api_key_creation_receipts').first<Record<string, unknown>>();
    assert.ok(receipt); assert.ok(!Object.values(receipt!).some(item => typeof item === 'string' && item.includes('lt_')));
    const columns = await f.db.prepare('PRAGMA table_info(api_key_creation_receipts)').all<{ name: string }>();
    assert.ok(!columns.results.some((column: { name: string }) => /secret|key_hash|plaintext/i.test(column.name)));

    const foreignDelete = await request(f.mf, '/api/api-keys/foreign-key', auth, { method: 'DELETE' }); assert.equal(foreignDelete.status, 200);
    assert.ok(await f.db.prepare("SELECT 1 FROM api_keys WHERE tenant_id='foreign-tenant' AND id='foreign-key'").first());
    const deleted = await request(f.mf, `/api/api-keys/${value.id}`, auth, { method: 'DELETE' }); assert.equal(deleted.status, 200);
    assert.equal(await f.db.prepare("SELECT 1 FROM api_keys WHERE tenant_id='key-tenant' AND id=?").bind(value.id).first(), null);
    assert.ok(await f.db.prepare("SELECT 1 FROM api_key_creation_receipts WHERE tenant_id='key-tenant' AND api_key_id=?").bind(value.id).first(),
      'metadata receipt remains to prevent duplicate credentials after revocation');
    const measured = (await control(f.mf)).measurements as { path: string; rowsRead: number; rowsWritten: number }[];
    const createAttempt = measured.find(item => item.path === '/api/api-keys' && item.rowsWritten > 4)!;
    const deleteAttempt = measured.find(item => item.path.endsWith(value.id))!;
    assert.ok(createAttempt.rowsRead <= (apiKeyAdminEnvelope('api-key.create')!.d1RowsRead ?? 0));
    assert.ok(createAttempt.rowsWritten <= (apiKeyAdminEnvelope('api-key.create')!.d1RowsWritten ?? 0));
    assert.ok(2 * createAttempt.rowsRead <= (apiKeyAdminEnvelope('api-key.create')!.d1RowsRead ?? 0));
    assert.ok(2 * createAttempt.rowsWritten <= (apiKeyAdminEnvelope('api-key.create')!.d1RowsWritten ?? 0),
      'the holder\'s finite two-attempt ceiling fits the prepaid business envelope');
    assert.ok(deleteAttempt.rowsRead <= (apiKeyAdminEnvelope('api-key.delete')!.d1RowsRead ?? 0));
    assert.ok(deleteAttempt.rowsWritten <= (apiKeyAdminEnvelope('api-key.delete')!.d1RowsWritten ?? 0));
    t.diagnostic(`native create: ${createAttempt.rowsRead}/${createAttempt.rowsWritten}; delete: ${deleteAttempt.rowsRead}/${deleteAttempt.rowsWritten}`);

    const attempts = 12;
    const beforeOperations = (await control(f.mf)).cache.operations as number;
    const beforeLinked = (await f.db.prepare('SELECT count(*) AS count FROM budget_grant_operations').first<{ count: number }>())!.count;
    const raced = await Promise.all(Array.from({ length: attempts }, (_, index) =>
      request(f.mf, '/api/api-keys', auth, { method: 'POST', body: { name: index % 2 ? 'Race B' : 'Race A' }, idempotencyKey: 'concurrent-key' })));
    assert.equal(raced.filter(response => response.status === 201).length, 1);
    assert.equal(raced.filter(response => response.status === 409).length, attempts - 1);
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM api_keys WHERE tenant_id='key-tenant'").first<{ count: number }>())!.count, 1,
      'a same-key payload race leaves exactly one credential');
    const afterRace = await control(f.mf);
    assert.equal(afterRace.cache.operations - beforeOperations, attempts,
      'each concurrent HTTP execution spends a distinct resource operation');
    const afterLinked = (await f.db.prepare('SELECT count(*) AS count FROM budget_grant_operations').first<{ count: number }>())!.count;
    assert.equal(afterLinked - beforeLinked, attempts,
      'each charged execution links its exact operation inside the business batch');
  } finally { await f.mf.dispose(); }
});

test('post-admission credential, capability, policy, and whole-grant closure changes fail closed', async () => {
  for (const kind of ['session', 'mfa', 'capability', 'budget', 'closure'] as const) {
    const f = await fixture();
    try {
      await control(f.mf, { kind });
      const response = await request(f.mf, '/api/api-keys', await token()); assert.equal(response.status, 503, kind); await response.body?.cancel();
      if (kind === 'closure') {
        assert.equal((await f.db.prepare('SELECT count(*) AS count FROM budget_grant_operations').first<{ count: number }>())!.count, 1);
        assert.equal((await f.db.prepare('SELECT count(*) AS count FROM budget_grant_closures').first<{ count: number }>())!.count, 1);
      }
    } finally { await f.mf.dispose(); }
  }
  const mutation = await fixture();
  try {
    await control(mutation.mf, { kind: 'closure' });
    const response = await request(mutation.mf, '/api/api-keys', await token(), { method: 'POST', body: { name: 'Closed' }, idempotencyKey: 'closed-create' });
    assert.equal(response.status, 503); await response.body?.cancel();
    assert.equal(await mutation.db.prepare("SELECT 1 FROM api_keys WHERE tenant_id='key-tenant'").first(), null);
    assert.equal(await mutation.db.prepare("SELECT 1 FROM api_key_creation_receipts WHERE tenant_id='key-tenant'").first(), null);
  } finally { await mutation.mf.dispose(); }

  for (const kind of ['session', 'mfa', 'capability', 'budget', 'closure'] as const) {
    const known = await fixture();
    try {
      const auth = await token();
      const created = await request(known.mf, '/api/api-keys', auth, {
        method: 'POST', body: { name: 'Known receipt' }, idempotencyKey: `known-${kind}` });
      assert.equal(created.status, 201, kind); const value = await created.json() as { id: string };
      await control(known.mf, { kind });
      const replay = await request(known.mf, '/api/api-keys', auth, {
        method: 'POST', body: { name: 'Known receipt' }, idempotencyKey: `known-${kind}` });
      assert.equal(replay.status, 503, `known receipt ${kind}`);
      await replay.body?.cancel();
      assert.equal((await known.db.prepare("SELECT count(*) AS count FROM api_keys WHERE tenant_id='key-tenant' AND id=?")
        .bind(value.id).first<{ count: number }>())!.count, 1);
      assert.equal((await known.db.prepare("SELECT count(*) AS count FROM api_key_creation_receipts WHERE tenant_id='key-tenant' AND api_key_id=?")
        .bind(value.id).first<{ count: number }>())!.count, 1);
    } finally { await known.mf.dispose(); }
  }
});

test('missing retry key and exhausted capacity never create a credential', async () => {
  const f = await fixture();
  try {
    const missing = await request(f.mf, '/api/api-keys', await token(), { method: 'POST', body: { name: 'Missing key' } });
    assert.equal(missing.status, 400); assert.equal((await missing.json() as any).code, 'invalid_idempotency_key');
    assert.equal(await f.db.prepare("SELECT 1 FROM api_keys WHERE tenant_id='key-tenant'").first(), null);
  } finally { await f.mf.dispose(); }
  const exhausted = await fixture(0, 1);
  try {
    const idempotencyKey = 'already-known-but-exhausted';
    const idempotencyHash = await digest(['api-key-create-idempotency-v1', idempotencyKey]);
    const payloadHash = await digest(['api-key-create-payload-v1', 'Known']);
    await exhausted.db.batch([
      exhausted.db.prepare(`INSERT INTO api_keys(tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
        VALUES('key-tenant','known-key','Known','known-hash','known','tickets:read',1,'2026-01-01T00:00:00Z')`),
      exhausted.db.prepare(`INSERT INTO api_key_creation_receipts
        (tenant_id,actor_id,idempotency_hash,payload_hash,api_key_id,name,prefix,created_at)
        VALUES('key-tenant',?,?,?,?,?,?,?)`).bind(actor,idempotencyHash,payloadHash,'known-key','Known','known','2026-01-01T00:00:00Z'),
    ]);
    const response = await request(exhausted.mf, '/api/api-keys', await token(), {
      method: 'POST', body: { name: 'Known' }, idempotencyKey });
    assert.equal(response.status, 429); await response.body?.cancel();
    assert.equal((await control(exhausted.mf)).measurements[0].rowsWritten, 0);
    assert.equal((await exhausted.db.prepare("SELECT count(*) AS count FROM api_keys WHERE tenant_id='key-tenant'").first<{count:number}>())!.count,1);
  } finally { await exhausted.mf.dispose(); }
});
