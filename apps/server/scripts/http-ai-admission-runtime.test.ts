import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { SignJWT } from 'jose';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { splitSql } from './split-sql';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';

const root = resolve(import.meta.dirname, '..');
const secret = 'synthetic-http-ai-jwt-secret-at-least-32-chars';
const dimensions = ['workerRequests', 'd1RowsRead', 'r2ClassBOperations', 'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents', 'aiMicroNeurons', 'vectorQueriedDimensions'] as const;

async function token(role: 'customer' | 'agent', sessionVersion = 1) {
  return new SignJWT({ sub: role === 'customer' ? 'customer-a' : 'agent-a', tenant_id: 'tenant-a', role,
    email: `${role}@example.test`, session_version: sessionVersion, mfa_verified: role === 'agent' })
    .setProtectedHeader({ alg: 'HS256' }).setAudience(role === 'customer' ? 'widget' : 'app').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

async function fixture(limit = 1_000_000_000_000, admissionPolicy = 'ticket-mutations-v1') {
  const now = Date.now();
  const bundle = await build({ entryPoints: [resolve(import.meta.dirname, 'http-ai-admission-runtime-entry.ts')], bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'http-ai-proof', modules: true, compatibilityDate: '2024-04-03',
    compatibilityFlags: ['nodejs_compat'], script: bundle.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: admissionPolicy, DISABLE_RATE_LIMIT: 'true', JWT_SECRET: secret },
    d1Databases: { DB: 'http-ai-proof-d1' }, r2Buckets: { ATTACHMENTS_BUCKET: 'http-ai-proof-r2' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
    unsafeEphemeralDurableObjects: true,
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
    }
    const limits = Object.fromEntries(dimensions.map(dimension => [dimension, limit]));
    const owner = { schemaVersion: 1, policyId: 'http-ai-policy', revision: 1, deploymentId: 'http-ai-deployment', mode: 'conservative',
      catalogueVersion: 'synthetic-2026-09-11', maxGrantLifetimeMs: 60_000,
      budgets: dimensions.map(dimension => ({ dimension, limit, allocationId: `ai-${dimension}`, recoveryPercent: 20,
        provenance: 'owner-allocation', window: { kind: 'interval', id: 'ai-window', startsAt: now - 1, endsAt: now + 60_000 } })), };
    const restriction = { schemaVersion: 1, tenantId: 'tenant-a', ownerPolicyId: owner.policyId, ownerPolicyRevision: 1, revision: 1,
      mode: 'conservative', limits, disabledFeatures: [] };
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('http-ai-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('http-ai-deployment','http-ai-policy',1,1,'http-ai-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
      db.prepare("INSERT INTO budget_tenant_allocations VALUES ('http-ai-deployment','tenant-a','http-ai-policy',1,1,'http-ai-tenant',?,'active')").bind(JSON.stringify(restriction)),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('tenant-a','customer-a','customer@example.test','customer',1,0)"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('tenant-a','agent-a','agent@example.test','agent',1,1)"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_id,customer_email,source) VALUES ('tenant-a','ticket-a','Synthetic','customer-a','customer@example.test','widget')"),
      db.prepare("INSERT INTO knowledge_docs (tenant_id,id,title,file_path,status,tier,chunk_count) VALUES ('tenant-a','public-doc','Public','public.md','published','answer',1)"),
    ]);
    const bucket = await mf.getR2Bucket('ATTACHMENTS_BUCKET');
    await bucket.put('tenant-a/public.md', 'Public answer');
    return { mf, db };
  } catch (error) { await mf.dispose(); throw error; }
}

async function control(mf: Miniflare, body?: unknown) {
  const response = await mf.dispatchFetch('http://runtime.test/__http-ai-control', body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return response.json() as Promise<{ aiCalls: number; vectorQueries: number; r2Gets: number; embeddingInputs: string[]; generationInputBytes: number[]; cache: { operations: number } }>;
}

test('real local D1/DO widget admission charges a grant before bounded AI, Vectorize and current-public R2 work', async () => {
  const f = await fixture();
  try {
    const response = await f.mf.dispatchFetch('http://runtime.test/api/v1/widget/chat', { method: 'POST', headers: {
      authorization: `Bearer ${await token('customer')}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ message: 'x'.repeat(8_000), history: Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: '<'.repeat(8_000) })) }) });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { response: 'Synthetic answer' });
    const observed = await control(f.mf);
    assert.deepEqual({ aiCalls: observed.aiCalls, vectorQueries: observed.vectorQueries, r2Gets: observed.r2Gets }, { aiCalls: 2, vectorQueries: 1, r2Gets: 1 });
    assert.equal(new TextEncoder().encode(observed.embeddingInputs[0]).byteLength, 512, 'embedding input remains inside BGE Large’s documented 512-token ceiling');
    assert.ok(observed.generationInputBytes[0] < 7_968, 'bounded widget content leaves room inside Llama’s documented context window');
    assert.equal(observed.cache.operations, 1);
    const namespace = await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const state = await (namespace.get(namespace.idFromName('http-ai-coordinator')) as unknown as BudgetCoordinatorDO).inspectForTrustedRuntime();
    assert.equal(state.tenantStates[0].grants.length, 1, 'the completed provider work retains its prepaid durable grant');
  } finally { await f.mf.dispose(); }
});

test('exhausted or currently revoked widget credentials perform no AI, Vectorize or R2 work', async () => {
  const exhausted = await fixture(1);
  try {
    const result = await exhausted.mf.dispatchFetch('http://runtime.test/api/v1/widget/chat', { method: 'POST', headers: { authorization: `Bearer ${await token('customer')}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Need help' }) });
    assert.equal(result.status, 200); assert.equal((await result.json() as { response: string }).response.includes('trouble connecting'), true);
    const exhaustedObserved = await control(exhausted.mf);
    assert.deepEqual({ aiCalls: exhaustedObserved.aiCalls, vectorQueries: exhaustedObserved.vectorQueries, r2Gets: exhaustedObserved.r2Gets,
      embeddingInputs: exhaustedObserved.embeddingInputs, operations: exhaustedObserved.cache.operations }, { aiCalls: 0, vectorQueries: 0, r2Gets: 0, embeddingInputs: [], operations: 0 });
  } finally { await exhausted.mf.dispose(); }
  const disabled = await fixture(1_000_000_000_000, 'off');
  try {
    const result = await disabled.mf.dispatchFetch('http://runtime.test/api/v1/widget/chat', { method: 'POST', headers: { authorization: `Bearer ${await token('customer')}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Need help' }) });
    assert.equal(result.status, 200); assert.equal((await result.json() as { response: string }).response.includes('trouble connecting'), true);
    const observed = await control(disabled.mf);
    assert.deepEqual({ aiCalls: observed.aiCalls, vectorQueries: observed.vectorQueries, r2Gets: observed.r2Gets, operations: observed.cache.operations }, { aiCalls: 0, vectorQueries: 0, r2Gets: 0, operations: 0 });
  } finally { await disabled.mf.dispose(); }
  const revoked = await fixture();
  try {
    await revoked.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='customer-a'").run();
    const result = await revoked.mf.dispatchFetch('http://runtime.test/api/v1/widget/chat', { method: 'POST', headers: { authorization: `Bearer ${await token('customer')}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Need help' }) });
    assert.equal(result.status, 401);
    const observed = await control(revoked.mf); assert.deepEqual({ aiCalls: observed.aiCalls, vectorQueries: observed.vectorQueries, r2Gets: observed.r2Gets }, { aiCalls: 0, vectorQueries: 0, r2Gets: 0 });
  } finally { await revoked.mf.dispose(); }
});

test('staff suggestion uses the indexed newest-five window and retains a charge on a one-shot provider failure', async () => {
  const f = await fixture();
  try {
    const rows = Array.from({ length: 40 }, (_, index) => f.db.prepare(`INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal,created_at)
      VALUES ('tenant-a',?,'ticket-a','customer',?,0,?)`).bind(`article-${index}`, `message-${index}`, `2026-09-11T00:00:${String(index).padStart(2, '0')}.000Z`));
    await f.db.batch(rows);
    const plan = await f.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM articles WHERE tenant_id=? AND ticket_id=?
      ORDER BY created_at DESC, id DESC LIMIT ?`).bind('tenant-a', 'ticket-a', 5).all<{ detail: string }>();
    assert.ok(plan.results.some(row => /SEARCH articles USING INDEX idx_articles_tenant_ticket_recent/.test(row.detail)));
    let response = await f.mf.dispatchFetch('http://runtime.test/api/knowledge/tickets/ticket-a/ai-suggest', { headers: { authorization: `Bearer ${await token('agent')}` } });
    assert.equal(response.status, 200, await response.clone().text());
    let observed = await control(f.mf);
    assert.equal(observed.embeddingInputs.at(-1), 'message-39');
    assert.ok(observed.generationInputBytes.at(-1)! < 7_968, 'bounded staff history/context leaves room inside Llama’s documented context window');
    await control(f.mf, { reset: true, failAi: true });
    response = await f.mf.dispatchFetch('http://runtime.test/api/knowledge/tickets/ticket-a/ai-suggest', { headers: { authorization: `Bearer ${await token('agent')}` } });
    assert.equal(response.status, 200); assert.equal((await response.json() as { suggestion: string }).suggestion.includes('trouble generating'), true);
    observed = await control(f.mf);
    assert.equal(observed.aiCalls, 1, 'one admitted provider failure is never retried');
    assert.equal(observed.cache.operations, 2, 'the failed second execution remains a separately charged warm operation');
  } finally { await f.mf.dispose(); }
});

test('staff AI checks current ticket group before provider work, including a warm ticket-group change', async () => {
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('tenant-a','restricted','Restricted')"),
      f.db.prepare("UPDATE tickets SET group_id='restricted' WHERE tenant_id='tenant-a' AND id='ticket-a'"),
      f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal) VALUES ('tenant-a','group-body','ticket-a','customer',?,0)").bind('>'.repeat(8_000)),
    ]);
    const headers = { authorization: `Bearer ${await token('agent')}` };
    const call = () => f.mf.dispatchFetch('http://runtime.test/api/knowledge/tickets/ticket-a/ai-suggest', { headers });
    let response = await call();
    assert.equal(response.status, 200);
    let observed = await control(f.mf);
    assert.equal(observed.aiCalls, 0); assert.equal(observed.vectorQueries, 0); assert.equal(observed.r2Gets, 0);
    await f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('tenant-a','agent-a','restricted')").run();
    response = await call();
    assert.equal(response.status, 200);
    observed = await control(f.mf);
    assert.equal(observed.aiCalls, 2);
    assert.ok(observed.generationInputBytes.at(-1)! < 7_968, 'escaped staff input fits the reserved model window');
    await f.db.batch([
      f.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('tenant-a','moved','Moved')"),
      f.db.prepare("UPDATE tickets SET group_id='moved' WHERE tenant_id='tenant-a' AND id='ticket-a'"),
    ]);
    response = await call();
    assert.equal(response.status, 200);
    const denied = await control(f.mf);
    assert.equal(denied.aiCalls, observed.aiCalls);
    assert.equal(denied.vectorQueries, observed.vectorQueries);
    assert.equal(denied.r2Gets, observed.r2Gets);
  } finally { await f.mf.dispose(); }
});
