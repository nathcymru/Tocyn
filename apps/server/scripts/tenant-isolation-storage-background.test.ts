import { observeD1 } from '../src/repositories/observed-d1';
import { TenantR2Adapter } from '../src/storage/adapters';
import { createResourceOperationEmitter } from '../src/observability/resource-operation';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Module } from 'node:module';
import { decodeJwt } from 'jose';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';
import { createSystemTenantScope } from '../src/auth/scope';
import { createTenantRequestDeps } from '../src/middleware/tenant.middleware';
import { TenantAutomationService } from '../src/services/tenant-automation.service';
import { TenantKnowledgeService } from '../src/services/tenant-knowledge.service';
import { StatelessAiService } from '../src/services/ai.service';
import { NotificationDO } from '../src/durable_objects/NotificationDO';
import type { Env } from '../src/bindings';
import type { VectorizeJob } from '../src/workflows/vectorize.workflow';

// These source-contract tests do not enable scheduled jobs, AI or realtime in the
// local Worker. D1/R2 use disposable Miniflare state; provider boundaries below
// are deterministic local doubles. The route test uses actually issued tokens.
async function widgetToken(fixture: LocalTenantFixture, name: 'customerA' | 'customerB') {
  const principal = fixture.principals[name];
  assert.equal((await fixture.request('/api/v1/customer/auth/request', {
    method: 'POST', body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey },
  })).status, 200);
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const link = messages.find(message => message.to === principal.email)?.loginLink;
  assert.ok(link, 'Approved customer must receive a locally captured link');
  const verified = await fixture.request('/api/v1/customer/auth/verify', {
    method: 'POST', body: { token: new URL(link).searchParams.get('token'), widgetKey: principal.widgetKey },
  });
  assert.equal(verified.status, 200);
  const { token } = await verified.json<{ token: string }>();
  assert.equal(await fixture.widgetTokenTenant(token), principal.tenantId);
  return token;
}

function unexpectedVectorBoundary() {
  let calls = 0;
  const reject = async (): Promise<never> => {
    calls++;
    throw new Error('Unexpected vector operation in attachment-only acceptance fixture');
  };
  return {
    index: { upsert: reject, getByIds: reject, deleteByIds: reject, query: reject },
    operationCount: () => calls,
  };
}

function scopedDeps(fixture: LocalTenantFixture, tenantId: string, extra: Record<string, unknown> = {}) {
  return createTenantRequestDeps(createSystemTenantScope({ tenantId, actor: 'synthetic-acceptance' }), {
    DB: fixture.db, ATTACHMENTS_BUCKET: fixture.r2.bucket,
    VECTOR_INDEX: unexpectedVectorBoundary().index, ...extra,
  });
}

async function seedAttachment(fixture: LocalTenantFixture, tenantId: string, attachmentId = 'shared-attachment', internal = false) {
  const articleId = `article-${attachmentId}`;
  await fixture.db.prepare('INSERT INTO articles (tenant_id, id, ticket_id, sender_id, sender_type, body, is_internal) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(tenantId, articleId, 'fixture-ticket', 'fixture-customer', 'customer', 'Synthetic attachment article', Number(internal)).run();
  await fixture.db.prepare('INSERT INTO attachments (tenant_id, id, article_id, file_name, file_size, content_type, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(tenantId, attachmentId, articleId, 'synthetic.txt', 16, 'text/plain', attachmentId).run();
  await scopedDeps(fixture, tenantId).attachmentStorage.putAttachment(attachmentId, `object:${tenantId}`);
}

test('local R2: colliding IDs download own bytes; foreign/internal IDs deny before storage', async () => {
  await withTwoTenantFixture(async fixture => {
    const a = fixture.principals.customerA.tenantId;
    const b = fixture.principals.customerB.tenantId;
    await seedAttachment(fixture, a);
    await seedAttachment(fixture, b);
    await seedAttachment(fixture, b, 'b-only-attachment');
    await seedAttachment(fixture, a, 'private-attachment', true);
    const tokens = { a: await widgetToken(fixture, 'customerA'), b: await widgetToken(fixture, 'customerB') };
    for (const [tenantId, token] of [[a, tokens.a], [b, tokens.b]]) {
      const response = await fixture.request('/api/v1/customer/attachments/shared-attachment/download', { token });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), `object:${tenantId}`);
    }
    const before = fixture.r2.operationCounts();
    for (const id of ['b-only-attachment', 'private-attachment']) {
      assert.equal((await fixture.request(`/api/v1/customer/attachments/${id}/download`, { token: tokens.a })).status, 404);
    }
    assert.deepEqual(fixture.r2.operationCounts(), before, 'Authorization denial must perform no R2 operation');
    const bOnly = await fixture.request('/api/v1/customer/attachments/b-only-attachment/download', { token: tokens.b });
    assert.equal(bOnly.status, 200);
    assert.equal(await bOnly.text(), `object:${b}`);
  });
});

test('retention source contract: failed A cleanup freezes writes; retry deletes A only and is idempotent', async () => {
  await withTwoTenantFixture(async fixture => {
    const a = fixture.principals.customerA.tenantId;
    const b = fixture.principals.customerB.tenantId;
    await seedAttachment(fixture, a);
    await seedAttachment(fixture, b);
    const vector = unexpectedVectorBoundary();
    const depsA = scopedDeps(fixture, a, { VECTOR_INDEX: vector.index });
    const depsB = scopedDeps(fixture, b, { VECTOR_INDEX: vector.index });
    await fixture.db.prepare("UPDATE tickets SET status = 'closed', updated_at = '2000-01-01T00:00:00.000Z' WHERE tenant_id = ? AND id = ?")
      .bind(a, 'fixture-ticket').run();
    await depsA.repositories.automations.create({ name: 'Synthetic retention', event_type: 'scheduled.retention', action_type: 'retention', is_active: true,
      action_config: JSON.stringify({ days_to_keep: 1, delete_attachments: true }) });
    const bBefore = await depsB.repositories.tickets.get('fixture-ticket');
    const realDelete = depsA.attachmentStorage.deleteAttachment.bind(depsA.attachmentStorage);
    let failOnce = true;
    depsA.attachmentStorage.deleteAttachment = async key => {
      if (failOnce) { failOnce = false; throw new Error('Synthetic storage failure'); }
      return realDelete(key);
    };
    const service = new TenantAutomationService(depsA);
    assert.deepEqual(await service.runRetention(), { deleted_tickets: 0, deleted_attachments: 0 });
    assert.equal(vector.operationCount(), 0, 'Injected R2 failure must not hide an unexpected vector call');
    assert.ok(await depsA.repositories.tickets.get('fixture-ticket'));
    assert.ok(await depsA.repositories.attachments.get('shared-attachment'));
    let wrote = false;
    await assert.rejects(depsA.repositories.tickets.withExternalWrite('fixture-ticket', async () => { wrote = true; }));
    assert.equal(wrote, false, 'Failed cleanup must retain its durable exclusion claim');
    assert.equal(await (await depsB.attachmentStorage.getAttachment('shared-attachment')).text(), `object:${b}`);
    assert.deepEqual(await service.runRetention(), { deleted_tickets: 1, deleted_attachments: 1 });
    assert.equal(await depsA.repositories.tickets.get('fixture-ticket'), null);
    assert.equal(await depsA.repositories.attachments.get('shared-attachment'), null);
    assert.equal(await depsA.attachmentStorage.getAttachment('shared-attachment'), null);
    assert.deepEqual(await depsB.repositories.tickets.get('fixture-ticket'), bBefore);
    assert.ok(await depsB.repositories.attachments.get('shared-attachment'));
    assert.equal(await (await depsB.attachmentStorage.getAttachment('shared-attachment')).text(), `object:${b}`);
    const beforeRetry = fixture.r2.operationCounts();
    assert.deepEqual(await service.runRetention(), { deleted_tickets: 0, deleted_attachments: 0 });
    assert.deepEqual(fixture.r2.operationCounts(), beforeRetry, 'Completed retention retry must perform no storage work');
    assert.equal(vector.operationCount(), 0, 'Attachment-only retention and recovery must perform no vector operation');
  });
});

test('realtime source contract: real D1 revalidation isolates colliding staff sessions after revocation and reconstruction', async () => {
  await withTwoTenantFixture(async fixture => {
    const sockets = [];
    for (const name of ['operatorA', 'operatorB'] as const) {
      const challenge = await (await fixture.login(name)).json<{ token: string }>();
      const verified = await fixture.request('/api/auth/mfa/verify', {
        method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(name) },
      });
      assert.equal(verified.status, 200);
      const { token } = await verified.json<{ token: string }>();
      const claims = decodeJwt(token);
      assert.equal(await fixture.tokenTenant(token), fixture.principals[name].tenantId);
      let attachment = { connectionId: name, userId: claims.sub, name: 'Synthetic operator', location: null as string | null,
        tenantId: claims.tenant_id, role: claims.role, version: claims.session_version, expiresAt: claims.exp };
      const sent: string[] = [];
      const closed: number[] = [];
      const socket = { readyState: WebSocket.OPEN, deserializeAttachment: () => attachment, serializeAttachment: (value: typeof attachment) => { attachment = value; },
        send: (value: string) => { sent.push(value); }, close: (code: number) => { closed.push(code); } };
      const tenantId = fixture.principals[name].tenantId;
      const state = { id: { equals: (id: unknown) => id === `tenant:${tenantId}` }, getWebSockets: () => [socket],
        storage: { setAlarm: async () => {}, deleteAlarm: async () => {} } } as unknown as DurableObjectState;
      const env = { DB: fixture.db, NOTIFICATION_DO: { idFromName: (id: string) => id } } as unknown as Env;
      sockets.push({ socket, sent, closed, state, env, object: new NotificationDO(state, env) });
    }
    const [a, b] = sockets;
    await a.object.broadcast({ marker: 'a-before' });
    await b.object.broadcast({ marker: 'b-before' });
    assert.deepEqual(a.sent, [JSON.stringify({ marker: 'a-before' })]);
    assert.deepEqual(b.sent, [JSON.stringify({ marker: 'b-before' })]);
    await fixture.revokePrincipalSessions('operatorA');
    // Reconstruct the object with persisted socket attachments to exercise the
    // same source path used after hibernation; this is not a runtime socket test.
    const restoredA = new NotificationDO(a.state, a.env);
    const restoredB = new NotificationDO(b.state, b.env);
    await restoredA.alarm();
    await restoredA.webSocketMessage(a.socket as unknown as WebSocket, JSON.stringify({ type: 'presence.update', payload: { location: 'stale' } }));
    await restoredA.broadcast({ marker: 'a-after' });
    await restoredB.broadcast({ marker: 'b-after' });
    assert.equal(a.sent.length, 1);
    assert.ok(a.closed.includes(1008));
    assert.deepEqual(b.closed, []);
    assert.deepEqual(b.sent, [JSON.stringify({ marker: 'b-before' }), JSON.stringify({ marker: 'b-after' })]);
    assert.equal(a.socket.deserializeAttachment().location, null, 'Revoked inbound presence must not update persisted state');
  });
});

test('workflow source contract: withdrawn/deleted/foreign retries never restore A vectors or alter B', async () => {
  // Node cannot load Cloudflare's runtime base class. Stub only that class during
  // import; the workflow, scope composition, repositories and services are real.
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id: string) {
    if (id === 'cloudflare:workers') return { WorkflowEntrypoint: class {} };
    return originalRequire.call(this, id);
  };
  let Workflow: typeof import('../src/workflows/vectorize.workflow').VectorizeWorkflow;
  try { ({ VectorizeWorkflow: Workflow } = await import('../src/workflows/vectorize.workflow')); }
  finally { Module.prototype.require = originalRequire; }
  await withTwoTenantFixture(async fixture => {
    const a = fixture.principals.customerA.tenantId;
    const b = fixture.principals.customerB.tenantId;
    type Vector = { id: string; namespace: string; metadata: Record<string, unknown>; values: number[] };
    const vectors = new Map<string, Vector>();
    let aiCalls = 0;
    let vectorWrites = 0;
    const index = {
      upsert: async (items: Vector[]) => { vectorWrites++; for (const item of items) vectors.set(item.id, structuredClone(item)); },
      deleteByIds: async (ids: string[]) => { vectorWrites++; for (const id of ids) vectors.delete(id); },
    };
    const ai = { run: async () => { aiCalls++; return { data: [[0.25, 0.75]] }; } };
    const env = { DB: fixture.db, ATTACHMENTS_BUCKET: fixture.r2.bucket, VECTOR_INDEX: index, AI: ai };
    const depsA = scopedDeps(fixture, a, env);
    const depsB = scopedDeps(fixture, b, env);
    const serviceA = new TenantKnowledgeService(depsA, new StatelessAiService(ai));
    const workflow = Object.create(Workflow.prototype) as InstanceType<typeof Workflow>;
    Object.assign(workflow, { env });
    const step = { do: async (_name: string, callback: () => Promise<void>) => callback() };
    const run = (tenantId: string, documentId = 'shared-document') => workflow.run(
      { payload: { tenantId, action: 'update', documentId } as VectorizeJob } as Parameters<typeof workflow.run>[0],
      step as unknown as Parameters<typeof workflow.run>[1],
    );
    for (const deps of [depsA, depsB]) {
      await deps.repositories.knowledge.createDocument({ id: 'shared-document', title: 'Synthetic document', file_path: 'shared-document.md' });
      await deps.attachmentStorage.putAttachment('shared-document.md', `body:${deps.scope.tenantId}`);
      await deps.repositories.knowledge.updateDocument('shared-document', { status: 'published', chunk_count: 1 });
      await deps.vectorStorage.upsert('doc_shared-document_0', [0.25, 0.75], { source_id: 'shared-document', type: 'document', status: 'published' });
    }
    assert.equal(aiCalls, 0, 'Legacy jobs cannot reach the unbounded embedding path');
    assert.equal(vectors.size, 2);
    assert.equal(new Set([...vectors.values()].map(vector => vector.namespace)).size, 2);
    const bVectors = () => [...vectors.values()].filter(vector => vector.metadata.tenant_id === b);
    const bBefore = structuredClone(bVectors());
    const bDocBefore = await depsB.repositories.knowledge.getDocument('shared-document');
    await serviceA.unpublishDocument('shared-document');
    const before = { aiCalls, vectorWrites, r2: fixture.r2.operationCounts() };
    await assert.rejects(run(a), /Legacy vector jobs require a durable manifest migration/);
    await assert.rejects(run(a), /Legacy vector jobs require a durable manifest migration/);
    assert.deepEqual({ aiCalls, vectorWrites, r2: fixture.r2.operationCounts() }, before, 'Withdrawn retries must perform no external work');
    assert.equal((await depsA.repositories.knowledge.getDocument('shared-document'))?.status, 'pending');
    await serviceA.deleteDocument('shared-document');
    await depsB.repositories.knowledge.createDocument({ id: 'b-only-document', title: 'B only', file_path: 'b-only.md' });
    const afterDelete = { aiCalls, vectorWrites, r2: fixture.r2.operationCounts() };
    await assert.rejects(run(a), /Legacy vector jobs require a durable manifest migration/);
    await assert.rejects(run(a, 'b-only-document'), /Legacy vector jobs require a durable manifest migration/);
    await assert.rejects(run(''), /Scoped workflow identity required/);
    assert.deepEqual({ aiCalls, vectorWrites, r2: fixture.r2.operationCounts() }, afterDelete);
    assert.deepEqual(bVectors(), bBefore);
    assert.deepEqual(await depsB.repositories.knowledge.getDocument('shared-document'), bDocBefore);
    assert.equal(vectors.size, 2, 'legacy vectors are never synchronously deleted without an admitted durable manifest cleanup');
  });
});


test('local R2 measurements preserve colliding tenant objects and emit only bounded envelopes', async t => {
  await withTwoTenantFixture(async fixture => {
    const messages: string[] = [];
    t.mock.method(console, 'log', (message: unknown) => { messages.push(String(message)); });
    const emitter = createResourceOperationEmitter({ENVIRONMENT:'development',LOCAL_BETA_ENABLED:'true',OBSERVABILITY_MODE:'isolated-evidence'});
    const a = fixture.principals.customerA.tenantId;
    const b = fixture.principals.customerB.tenantId;
    const adapterA = new TenantR2Adapter(createSystemTenantScope({tenantId:a,actor:'synthetic-measurement'}), fixture.r2.bucket, emitter);
    const adapterB = new TenantR2Adapter(createSystemTenantScope({tenantId:b,actor:'synthetic-measurement'}), fixture.r2.bucket, emitter);
    await adapterA.put('measured-shared-object', 'synthetic-private-body-a');
    await adapterB.put('measured-shared-object', 'synthetic-private-body-b');
    assert.equal(await (await adapterA.get('measured-shared-object')).text(), 'synthetic-private-body-a');
    await adapterA.delete('measured-shared-object');
    assert.equal(await adapterA.get('measured-shared-object'), null);
    assert.equal(await (await adapterB.get('measured-shared-object')).text(), 'synthetic-private-body-b');
    const events=messages.map(message=>JSON.parse(message));
    assert.equal(events.length,6);
    assert.deepEqual(events.map(event=>event.operation),['write','write','read','delete','read','read']);
    for(const event of events){
      assert.deepEqual(Object.keys(event).sort(),['version','type','resource','operation','outcome','latencyMs'].sort());
      assert.equal(event.resource,'r2');assert.equal(event.outcome,'success');assert.ok(Number.isFinite(event.latencyMs)&&event.latencyMs>=0);
    }
    assert.ok(!messages.join('').includes('synthetic-private'));
    assert.ok(!messages.join('').includes('measured-shared-object'));
    assert.ok(!messages.join('').includes(a));assert.ok(!messages.join('').includes(b));
  });
});


test('observed native D1 batches retain atomicity and omit data from diagnostics', async () => {
  await withTwoTenantFixture(async fixture => {
    const events: unknown[] = [];
    const observed = observeD1(fixture.db, event => { events.push(event); });
    await fixture.db.prepare('CREATE TABLE diagnostic_atomicity (id TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
    await observed.batch([
      observed.prepare('INSERT INTO diagnostic_atomicity VALUES (?, ?)').bind('first', 'private synthetic value'),
      observed.prepare('INSERT INTO diagnostic_atomicity VALUES (?, ?)').bind('second', 'another private value'),
    ]);
    assert.equal(events.length, 1);
    await assert.rejects(observed.batch([
      observed.prepare('INSERT INTO diagnostic_atomicity VALUES (?, ?)').bind('rolled-back', 'private rollback'),
      observed.prepare('INSERT INTO diagnostic_atomicity VALUES (?, ?)').bind('first', 'duplicate'),
    ]));
    assert.equal(await observed.prepare('SELECT id FROM diagnostic_atomicity WHERE id = ?').bind('rolled-back').first(), null);
    assert.deepEqual(await observed.prepare('SELECT id FROM diagnostic_atomicity ORDER BY id').raw(), [['first'],['second']]);
    assert.deepEqual(events.map(event => (event as {outcome:string}).outcome), ['success','failure','success','success']);
    const encoded = JSON.stringify(events);
    for(const forbidden of ['private','INSERT','SELECT','diagnostic_atomicity','rolled-back','duplicate']) assert.equal(encoded.includes(forbidden), false);
  });
});

test('trusted tenant composition enables only bounded local D1 diagnostics', async context => {
  await withTwoTenantFixture(async fixture => {
    const emitted: string[] = [];
    context.mock.method(console, 'log', (message: string) => { emitted.push(message); });
    const deps = scopedDeps(fixture, fixture.principals.customerA.tenantId, {
      LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence', ENVIRONMENT: 'preview',
    });
    assert.equal(await deps.repositories.articles.get('synthetic-missing-article'), null);
    assert.equal(emitted.length, 1);
    assert.equal(JSON.parse(emitted[0]).resource, 'd1');
    assert.equal(emitted[0].includes('synthetic-missing-article'), false);
    const production = scopedDeps(fixture, fixture.principals.customerA.tenantId, {
      LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence', ENVIRONMENT: 'production',
    });
    assert.equal(await production.repositories.articles.get('synthetic-missing-article'), null);
    assert.equal(emitted.length, 1);
  });
});
