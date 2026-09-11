import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { dashboardAttachmentEnvelope } from '../src/budgets/storage-admission.service';

const root = resolve(import.meta.dirname, '..');
const now = Date.now();
const jwtSecret = 'synthetic-storage-admission-secret-at-least-32-chars';
const dimensions = ['workerRequests', 'd1RowsRead', 'r2StorageBytes', 'r2ClassAOperations', 'r2ClassBOperations',
  'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents'] as const;

async function applyMigrations(db: D1Database): Promise<void> {
  for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
  }
}

function ownerPolicy() {
  const limits: Record<string, number> = Object.fromEntries(dimensions.map(dimension => [dimension, 1_000_000]));
  return { schemaVersion: 1, policyId: 'storage-policy', revision: 1, deploymentId: 'storage-deployment', mode: 'conservative',
    catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000,
    budgets: dimensions.map(dimension => ({ dimension, limit: limits[dimension], allocationId: `storage-${dimension}`,
      recoveryPercent: 20, provenance: 'owner-allocation' as const,
      window: dimension === 'r2StorageBytes' ? { kind: 'stock' as const, id: 'storage-stock' }
        : { kind: 'interval' as const, id: 'storage-window', startsAt: now - 1_000, endsAt: now + 60_000 } })), limits };
}

async function staffToken(tenantId: string): Promise<string> {
  return new SignJWT({ sub: 'shared-staff', role: 'agent', tenant_id: tenantId, session_version: 1, mfa_verified: true })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('app').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}

async function fixture() {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'storage-admission-proof', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true', JWT_SECRET: jwtSecret },
    d1Databases: { DB: 'storage-admission-d1' }, r2Buckets: { ATTACHMENTS_BUCKET: 'storage-admission-r2' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
    unsafeEphemeralDurableObjects: true,
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    const { limits: ownerLimits, ...owner } = ownerPolicy();
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('storage-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies
        (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('storage-deployment','storage-policy',1,1,'storage-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
    ]);
    for (const tenantId of ['storage-a', 'storage-b', 'storage-low']) {
      const limits = { ...ownerLimits, ...(tenantId === 'storage-low' ? { r2ClassAOperations: 1 } : {}) };
      const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: owner.policyId, ownerPolicyRevision: 1, revision: 1,
        mode: 'conservative', limits, disabledFeatures: [] };
      await db.batch([
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'shared-staff',?,'agent',1,1)")
          .bind(tenantId, `staff-${tenantId}@example.test`),
        db.prepare(`INSERT INTO budget_tenant_allocations
          (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES ('storage-deployment',?,'storage-policy',1,1,?,?,'active')`).bind(tenantId, `storage-${tenantId}`, JSON.stringify(restriction)),
      ]);
    }
    return { mf, db };
  } catch (error) { await mf.dispose(); throw error; }
}

async function upload(mf: Miniflare, token: string, key: string, body = 'synthetic attachment', filename = 'synthetic.txt', contentType = 'text/plain') {
  const form = new FormData();
  form.append('file', new Blob([body], { type: contentType }), filename);
  // Constructing a Request supplies the multipart boundary; dispatching a raw
  // FormData body does not on Miniflare's lower-level fetch helper.
  const request = new Request('http://runtime.test/api/attachments/upload', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'idempotency-key': key }, body: form,
  });
  return mf.dispatchFetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers), body: await request.arrayBuffer() });
}

test('dashboard storage admission is tenant-scoped, warm, and charges before native R2 upload/download work', async () => {
  const f = await fixture();
  try {
    const tokenA = await staffToken('storage-a');
    const tokenB = await staffToken('storage-b');
    const first = await upload(f.mf, tokenA, 'same-upload', 'aaaaaaaaaaaaaaaaaaaa');
    assert.equal(first.status, 200); const firstBody = await first.json() as { key: string };
    const cold = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { calls: { refresh: number; reserve: number } };
    const replay = await upload(f.mf, tokenA, 'same-upload', 'aaaaaaaaaaaaaaaaaaaa');
    assert.equal(replay.status, 200); assert.equal((await replay.json() as { key: string }).key, firstBody.key,
      'a lost upload response can recover through its bounded idempotency marker');
    const warm = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { calls: { refresh: number; reserve: number } };
    assert.deepEqual(warm.calls, cold.calls, 'the recovery spend uses its preallocated isolate grant without another budget DO RPC');
    const conflict = await upload(f.mf, tokenA, 'same-upload', 'bbbbbbbbbbbbbbbbbbbb');
    assert.equal(conflict.status, 409, 'same-size replacement bytes conflict rather than replaying the old object'); await conflict.body?.cancel();
    const tenantB = await upload(f.mf, tokenB, 'same-upload');
    assert.equal(tenantB.status, 200); const tenantBBody = await tenantB.json() as { key: string };
    assert.notEqual(tenantBBody.key, firstBody.key, 'the same client key never crosses tenant-scoped storage');

    await f.db.batch([
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('storage-a','storage-ticket','Synthetic','customer@example.test','dashboard')"),
      f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal,intake_source) VALUES ('storage-a','storage-article','storage-ticket','shared-staff','agent','synthetic',0,'dashboard')"),
      f.db.prepare("INSERT INTO attachments (tenant_id,id,article_id,file_name,file_size,content_type,r2_key) VALUES ('storage-a','storage-attachment','storage-article','synthetic.txt',20,'text/plain',?)").bind(firstBody.key),
    ]);
    const download = await f.mf.dispatchFetch('http://runtime.test/api/attachments/storage-attachment/download', { headers: { authorization: `Bearer ${tokenA}` } });
    assert.equal(download.status, 200); assert.equal(await download.text(), 'aaaaaaaaaaaaaaaaaaaa');
    const foreign = await f.mf.dispatchFetch('http://runtime.test/api/attachments/storage-attachment/download', { headers: { authorization: `Bearer ${tokenB}` } });
    assert.equal(foreign.status, 404, 'the tenant-qualified metadata lookup denies before the foreign R2 key is read'); await foreign.body?.cancel();
  } finally { await f.mf.dispose(); }
});

test('idempotent upload key remains one object after cache loss, filename changes, concurrent writes and a lost R2 acknowledgement', async () => {
  const f = await fixture();
  try {
    const token = await staffToken('storage-a');
    const first = await upload(f.mf, token, 'stable-upload', 'same bytes');
    assert.equal(first.status, 200); const { key } = await first.json() as { key: string };
    assert.match(key, /^agent-attachments\/shared-staff\/[a-f0-9]{64}$/, 'idempotent storage key excludes mutable filename and extension');
    await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ discard: true }) });
    const renamed = await upload(f.mf, token, 'stable-upload', 'same bytes', 'renamed.pdf', 'application/pdf');
    assert.equal(renamed.status, 409, 'cache loss cannot turn a filename/extension change into another R2 object'); await renamed.body?.cancel();

    const concurrent = await Promise.all([
      upload(f.mf, token, 'race-upload', 'race bytes'),
      upload(f.mf, token, 'race-upload', 'race bytes'),
    ]);
    assert.deepEqual(concurrent.map(response => response.status), [200, 200], 'conditional writes recover one concurrent object');
    const raceKeys = await Promise.all(concurrent.map(async response => (await response.json() as { key: string }).key));
    assert.equal(raceKeys[0], raceKeys[1]);

    const beforeLost = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number; r2Puts: number };
    await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ loseR2PutAcknowledgement: true }) });
    const lostAcknowledgement = await upload(f.mf, token, 'lost-ack-upload', 'lost acknowledgement bytes');
    assert.equal(lostAcknowledgement.status, 200, 'one bounded marker read recovers a committed write whose acknowledgement was lost'); await lostAcknowledgement.body?.cancel();
    const retry = await upload(f.mf, token, 'lost-ack-upload', 'lost acknowledgement bytes');
    assert.equal(retry.status, 200); await retry.body?.cancel();
    const afterRetry = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number; r2Puts: number };
    assert.equal(afterRetry.r2Gets - beforeLost.r2Gets, 3, 'lost provider acknowledgement plus HTTP retry performs three metadata reads');
    const envelope = dashboardAttachmentEnvelope('dashboard.attachment.upload', 26)!;
    assert.ok((envelope.r2ClassBOperations ?? 0) >= afterRetry.r2Gets - beforeLost.r2Gets);
    assert.ok((envelope.r2ClassAOperations ?? 0) >= afterRetry.r2Puts - beforeLost.r2Puts);
    const exhaustedRetry = await upload(f.mf, token, 'lost-ack-upload', 'lost acknowledgement bytes');
    assert.equal(exhaustedRetry.status, 503); await exhaustedRetry.body?.cancel();
    const afterExhaustion = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { r2Gets: number; r2Puts: number };
    assert.equal(afterExhaustion.r2Gets, afterRetry.r2Gets, 'third attempt cannot perform uncharged storage reads');
    const bucket = await f.mf.getR2Bucket('ATTACHMENTS_BUCKET');
    const objects = await bucket.list();
    assert.equal(objects.objects.length, 3, 'stable, concurrent and lost-ack uploads each leave exactly one tenant-scoped object');
  } finally { await f.mf.dispose(); }
});

test('storage pressure rejects before an R2 object can be created', async () => {
  const f = await fixture();
  try {
    const token = await staffToken('storage-low');
    const revokedToken = await staffToken('storage-b');
    await f.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='storage-b' AND id='shared-staff'").run();
    const [response, revoked] = await Promise.all([
      upload(f.mf, token, 'capacity-rejected'),
      upload(f.mf, revokedToken, 'revoked-session'),
    ]);
    assert.equal(response.status, 429); assert.deepEqual(await response.json(), { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' });
    assert.equal(revoked.status, 401, 'a concurrently revoked session is denied before budget or storage work'); await revoked.body?.cancel();
    const bucket = await f.mf.getR2Bucket('ATTACHMENTS_BUCKET');
    // No key is returned on refusal. The bucket contains no data because this
    // fixture performs no other R2 write; admission precedes every storage call.
    assert.equal(await bucket.list().then(result => result.objects.length), 0);
  } finally { await f.mf.dispose(); }
});
