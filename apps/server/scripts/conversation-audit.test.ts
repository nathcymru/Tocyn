import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { withTwoTenantFixture, type FixtureResponse, type LocalTenantFixture } from './local-tenant-fixture';
import { splitSql } from './split-sql';
import { canonicalMutationJson } from '../src/services/ticket-mutation-replay.service';
import { createRepositories } from '../src/repositories';
import { createSystemTenantScope } from '../src/auth/scope';
import { initializeLocalBetaFixture } from './local-beta-fixture';

type Json = Record<string, unknown>;
type AuditEvent = {
  id: string;
  ticketId: string;
  articleId: string | null;
  sequence: number;
  kind: 'ticket.intake' | 'message.reply' | 'ticket.assignment_changed' | 'ticket.state_changed';
  source: 'api' | 'portal' | 'widget' | 'dashboard';
  visibility: 'public' | 'internal';
  actor: { kind: string; id?: string; provenance: string };
  facts: Json;
};
type CanonicalMutationSliEvent = {
  version: 1;
  type: 'canonical_mutation.sli.request';
  scope: 'request';
  complete: boolean;
  counts: { attempted: number; durablyCompleted: number; replayed: number; noOp: number; denied: number; uncertain: number };
};

function tokenFrom(value: unknown): string {
  const token = (value as { token?: unknown })?.token;
  if (typeof token !== 'string' || token.length === 0) throw new Error('Expected a local route-issued token');
  return token;
}

async function expectStatus(response: FixtureResponse, expected: number, reason: string): Promise<void> {
  if (response.status === expected) return;
  await response.body?.cancel();
  assert.fail(`${reason}: received ${response.status}`);
}

async function captureCanonicalMutationSli<T>(run: () => Promise<T>): Promise<{ result: T; events: CanonicalMutationSliEvent[] }> {
  const events: CanonicalMutationSliEvent[] = [];
  const log = console.log;
  console.log = (value?: unknown) => {
    if (typeof value !== 'string') return;
    try {
      const event = JSON.parse(value) as { type?: unknown };
      if (event.type === 'canonical_mutation.sli.request') events.push(event as CanonicalMutationSliEvent);
    } catch { /* Other diagnostics are outside this bounded assertion. */ }
  };
  try { return { result: await run(), events }; }
  finally { console.log = log; }
}

async function customerToken(fixture: LocalTenantFixture, principal: 'customerA' | 'customerB', suffix: string): Promise<string> {
  const customer = fixture.principals[principal];
  await expectStatus(await fixture.request('/api/v1/customer/auth/request', {
    method: 'POST', ip: `${fixture.rateLimitIdentity}-audit-auth-${suffix}`,
    body: { email: customer.email, type: 'magic_link', widgetKey: customer.widgetKey },
  }), 200, 'Local customer authentication request');
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const link = messages.filter(message => message.to === customer.email).at(-1)?.loginLink;
  assert.ok(link, 'Fixture local capture must contain the selected customer link');
  const challenge = new URL(link).searchParams.get('token');
  assert.ok(challenge, 'Fixture customer link must contain a challenge');
  const verified = await fixture.request('/api/v1/customer/auth/verify', {
    method: 'POST', ip: `${fixture.rateLimitIdentity}-audit-verify-${suffix}`,
    body: { token: challenge, widgetKey: customer.widgetKey },
  });
  await expectStatus(verified, 200, 'Local customer authentication verification');
  return tokenFrom(await verified.json());
}

async function staffToken(fixture: LocalTenantFixture, principal: 'operatorA' | 'operatorB' = 'operatorA'): Promise<string> {
  const challenge = await fixture.login(principal);
  await expectStatus(challenge, 200, 'Staff password login');
  const challengeToken = tokenFrom(await challenge.json());
  const verified = await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challengeToken, body: { code: fixture.currentMfaCode(principal) },
  });
  await expectStatus(verified, 200, 'Staff MFA verification');
  return tokenFrom(await verified.json());
}

async function apiKey(fixture: LocalTenantFixture, principal: 'operatorA' | 'operatorB' = 'operatorA'): Promise<string> {
  return (await fixture.createScopedApiKey(principal, ['tickets:write', 'tickets:read'])).apiKey;
}

async function eventsFor(fixture: LocalTenantFixture, tenantId: string, ticketId: string) {
  return (await fixture.db.prepare(`SELECT id, ticket_id, article_id, sequence, kind, source, visibility, actor_kind, actor_id, actor_provenance, facts
    FROM conversation_events WHERE tenant_id = ? AND ticket_id = ? ORDER BY sequence`).bind(tenantId, ticketId).all<{
      id: string; ticket_id: string; article_id: string | null; sequence: number; kind: AuditEvent['kind']; source: AuditEvent['source']; visibility: AuditEvent['visibility'];
      actor_kind: string; actor_id: string | null; actor_provenance: string; facts: string;
    }>()).results;
}

function ticketId(body: Json): string {
  const ticket = typeof body.ticket === 'object' && body.ticket ? body.ticket as Json : body;
  if (typeof ticket.id !== 'string') throw new Error('Expected ticket ID in mutation response');
  return ticket.id;
}

function articleId(body: Json): string {
  const article = typeof body.article === 'object' && body.article ? body.article as Json : body;
  if (typeof article.id !== 'string') throw new Error('Expected article ID in mutation response');
  return article.id;
}

function history(response: unknown): { events: AuditEvent[]; nextCursor: string | null } {
  const value = response as { events?: unknown; nextCursor?: unknown };
  if (!Array.isArray(value.events) || (value.nextCursor !== null && typeof value.nextCursor !== 'string')) throw new Error('Expected bounded conversation history response');
  return value as { events: AuditEvent[]; nextCursor: string | null };
}

async function applyMigration(db: D1Database, name: string): Promise<void> {
  const directory = resolve(import.meta.dirname, '..', 'migrations');
  const statements = splitSql(readFileSync(join(directory, name), 'utf8'));
  await db.batch(statements.map(statement => db.prepare(statement)));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

test('API audit events are atomic, attributable, and v2 replay-stable', async () => {
  await withTwoTenantFixture(async fixture => {
    const credential = await fixture.createScopedApiKey('operatorA', ['tickets:write', 'tickets:read']);
    const payload = { subject: 'audited API intake', customer_email: fixture.principals.customerA.email, body: 'only stored with the ticket' };
    const first = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: credential.apiKey, idempotencyKey: 'audit-v2', body: payload, ip: `${fixture.rateLimitIdentity}-audit-first` });
    await expectStatus(first, 201, 'Audited API intake');
    const firstBody = await first.json<Json>();
    const ticket = ticketId(firstBody);
    const events = await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket);
    assert.equal(events.length, 1);
    assert.deepEqual(events.map(event => [event.sequence, event.kind, event.source, event.visibility, event.actor_kind, event.actor_id]), [[1, 'ticket.intake', 'api', 'public', 'api-key', credential.id]]);
    const facts = JSON.parse(events[0].facts) as Json;
    assert.deepEqual(facts, { initial: { status: 'open', priority: 'normal', assignedTo: null, groupId: null } });
    assert.equal(events[0].facts.includes(payload.body), false, 'Audit facts must not retain message bodies');
    const receipt = await fixture.db.prepare('SELECT response_version,response_snapshot FROM ticket_mutation_receipts WHERE tenant_id=? AND result_ticket_id=?')
      .bind(fixture.principals.customerA.tenantId, ticket).first<{ response_version: number; response_snapshot: string }>();
    assert.equal(receipt?.response_version, 2);
    assert.equal((JSON.parse(receipt?.response_snapshot || '{}') as Json).version, 2);
    const replay = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: credential.apiKey, idempotencyKey: 'audit-v2', body: payload, ip: `${fixture.rateLimitIdentity}-audit-replay` });
    await expectStatus(replay, 201, 'Audited API retry');
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(await replay.json<Json>(), firstBody, 'V2 replay must retain its original immutable audit reference');
    assert.equal((await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket)).length, 1, 'Replay adds no audit event');
    const apiHistory = await fixture.request(`/api/v1/tickets/${ticket}/history`, { apiKey: credential.apiKey });
    await expectStatus(apiHistory, 200, 'API public-message history');
    const apiAudit = history(await apiHistory.json());
    assert.equal(apiAudit.events.length, 1);
    assert.equal(apiAudit.events[0].actor.id, undefined, 'API public projection must not add internal audit identity');
    const staffHistory = await fixture.request(`/api/tickets/${ticket}/history`, { token: await staffToken(fixture) });
    await expectStatus(staffHistory, 200, 'MFA staff history');
    const audit = history(await staffHistory.json());
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0].actor.id, credential.id);
    assert.equal(audit.events[0].sequence, 1);
    const changed = await fixture.request(`/api/v1/tickets/${ticket}`, { method: 'PATCH', apiKey: credential.apiKey,
      body: { status: 'resolved' }, ip: `${fixture.rateLimitIdentity}-audit-after-receipt` });
    await expectStatus(changed, 200, 'Later audited ticket change');
    const immutableReplay = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: credential.apiKey, idempotencyKey: 'audit-v2', body: payload, ip: `${fixture.rateLimitIdentity}-audit-immutable-replay` });
    await expectStatus(immutableReplay, 201, 'V2 replay after later changes');
    assert.deepEqual(await immutableReplay.json<Json>(), firstBody, 'The v2 response is stored at commit time, not rebuilt from later audit state');
  });
});

test('canonical mutation SLI records real dashboard creation, changed audit PATCH, and durable no-op separately', async () => {
  await withTwoTenantFixture(async fixture => {
    const credential = await fixture.createScopedApiKey('operatorA', ['tickets:write', 'tickets:read']);
    await initializeLocalBetaFixture(fixture, {
      runId: 'canonical-audit-sli-evidence',
      tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      invitations: [
        ...Object.values(fixture.principals).map(principal => ({
          tenantId: principal.tenantId, id: principal.localId,
          kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
        })),
        { tenantId: fixture.principals.customerA.tenantId, id: credential.id, kind: 'api-key' as const },
      ],
    });
    const staff = await staffToken(fixture);
    fixture.enableIsolatedObservability();
    const privateBody = 'synthetic-dashboard-canonical-sli-body';
    const captured = await captureCanonicalMutationSli(async () => {
      const created = await fixture.request('/api/tickets', { method: 'POST', token: staff, body: {
        subject: 'dashboard canonical SLI', customer_email: fixture.principals.customerA.email, body: privateBody,
      }, ip: `${fixture.rateLimitIdentity}-dashboard-canonical-sli` });
      await expectStatus(created, 201, 'Dashboard creation durable batch');
      const ticket = ticketId(await created.json<Json>());
      const changed = await fixture.request(`/api/tickets/${ticket}`, { method: 'PATCH', token: staff,
        body: { status: 'resolved' }, ip: `${fixture.rateLimitIdentity}-canonical-sli-dashboard-patch` });
      await expectStatus(changed, 200, 'Changed dashboard audited PATCH');
      const noOp = await fixture.request(`/api/v1/tickets/${ticket}`, { method: 'PATCH', apiKey: credential.apiKey,
        body: { status: 'resolved' }, ip: `${fixture.rateLimitIdentity}-canonical-sli-noop` });
      await expectStatus(noOp, 200, 'Unchanged audited PATCH');
      return ticket;
    });
    assert.equal(typeof captured.result, 'string');
    assert.deepEqual(captured.events, [
      { version: 1, type: 'canonical_mutation.sli.request', scope: 'request', complete: true,
        counts: { attempted: 1, durablyCompleted: 1, replayed: 0, noOp: 0, denied: 0, uncertain: 0 } },
      { version: 1, type: 'canonical_mutation.sli.request', scope: 'request', complete: true,
        counts: { attempted: 1, durablyCompleted: 1, replayed: 0, noOp: 0, denied: 0, uncertain: 0 } },
      { version: 1, type: 'canonical_mutation.sli.request', scope: 'request', complete: true,
        counts: { attempted: 1, durablyCompleted: 0, replayed: 0, noOp: 1, denied: 0, uncertain: 0 } },
    ]);
    assert.equal(JSON.stringify(captured.events).includes(privateBody), false, 'Canonical summaries omit dashboard content');
    assert.equal(JSON.stringify(captured.events).includes(fixture.principals.customerA.tenantId), false, 'Canonical summaries omit tenant IDs');
  });
});

test('real D1 migration preserves completed v1 bytes and rejects incomplete or mismatched receipt versions', async () => {
  let miniflare: Miniflare | undefined;
  try {
    miniflare = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'conversation-audit-v1-upgrade', modules: true,
      script: 'export default { fetch() { return new Response("migration fixture") } }',
      d1Databases: { DB: '3e7ca922-0d74-4e8b-b5f3-0b43d6e30d7f' },
    }] }));
    const db = await miniflare.getD1Database('DB');
    const migrationNames = readdirSync(resolve(import.meta.dirname, '..', 'migrations')).filter(name => name.endsWith('.sql') && name <= '0025_ticket_mutation_receipts.sql').sort();
    for (const migration of migrationNames) await applyMigration(db, migration);
    const v1Snapshot = JSON.stringify({ version: 1, ticket: { id: 'legacy-ticket' }, article: null, attachments: [] });
    await db.prepare(`INSERT INTO ticket_mutation_receipts
      (tenant_id,principal_kind,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,result_ticket_id,response_status,response_snapshot)
      VALUES ('legacy-tenant','api-key','legacy-principal','api.ticket.create',?, ?,1,1,'legacy-ticket',201,?)`)
      .bind('a'.repeat(64), 'b'.repeat(64), v1Snapshot).run();
    await applyMigration(db, '0026_conversation_events.sql');
    const migrated = await db.prepare(`SELECT response_version,response_snapshot FROM ticket_mutation_receipts
      WHERE tenant_id='legacy-tenant' AND principal_id='legacy-principal'`).first<{ response_version: number; response_snapshot: string }>();
    assert.equal(migrated?.response_version, 1);
    assert.equal(migrated?.response_snapshot, v1Snapshot, 'An actual pre-audit receipt keeps byte-for-byte replay material after the upgrade');
    const invalidSnapshot = async (value: unknown, version = 1) => db.prepare(`UPDATE ticket_mutation_receipts
      SET response_version=?, response_snapshot=? WHERE tenant_id='legacy-tenant' AND principal_id='legacy-principal'`)
      .bind(version, JSON.stringify(value)).run();
    await assert.rejects(invalidSnapshot({ ticket: { id: 'legacy-ticket' }, article: null, attachments: [] }), 'Missing snapshot version must fail closed');
    await assert.rejects(invalidSnapshot({ version: null, ticket: { id: 'legacy-ticket' }, article: null, attachments: [] }), 'Null snapshot version must fail closed');
    await assert.rejects(invalidSnapshot({ version: '1', ticket: { id: 'legacy-ticket' }, article: null, attachments: [] }), 'String snapshot version must fail closed');
    await assert.rejects(invalidSnapshot({ version: 2, ticket: { id: 'legacy-ticket' }, article: null, attachments: [], audit: [] }, 2), 'V2 requires its exact immutable audit reference');
    await assert.rejects(invalidSnapshot({ version: 2, ticket: { id: 'legacy-ticket' }, article: null, attachments: [], audit: [{ eventId: '' }] }, 2), 'V2 audit IDs must be nonempty');
    const stillV1 = await db.prepare(`SELECT response_version,response_snapshot FROM ticket_mutation_receipts
      WHERE tenant_id='legacy-tenant' AND principal_id='legacy-principal'`).first<{ response_version: number; response_snapshot: string }>();
    assert.equal(stillV1?.response_version, 1);
    assert.equal(stillV1?.response_snapshot, v1Snapshot, 'Rejected malformed updates cannot alter the retained v1 receipt');
  } finally {
    await miniflare?.dispose();
  }
});

test('an authorized retained v1 receipt replays through the public API without retroactive audit data', async () => {
  await withTwoTenantFixture(async fixture => {
    const credential = await fixture.createScopedApiKey('operatorA', ['tickets:write']);
    const payload = { subject: 'retained v1 replay', customer_email: fixture.principals.customerA.email, body: 'the v1 response body' };
    const current = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: credential.apiKey, idempotencyKey: 'v2-source-for-v1', body: payload, ip: `${fixture.rateLimitIdentity}-v1-source` });
    await expectStatus(current, 201, 'Current v2 source mutation');
    const ticket = ticketId(await current.json<Json>());
    const sourceReceipt = await fixture.db.prepare(`SELECT response_snapshot,result_article_id FROM ticket_mutation_receipts
      WHERE tenant_id=? AND principal_id=? AND result_ticket_id=?`).bind(fixture.principals.customerA.tenantId, credential.id, ticket)
      .first<{ response_snapshot: string; result_article_id: string | null }>();
    assert.ok(sourceReceipt?.response_snapshot && sourceReceipt.result_article_id);
    const retainedSnapshot = JSON.parse(sourceReceipt.response_snapshot) as Json;
    retainedSnapshot.version = 1;
    delete retainedSnapshot.audit;
    const legacyKey = 'retained-v1-replay';
    const normalized = { operation: 'api.ticket.create' as const, data: {
      subject: payload.subject, customer_email: payload.customer_email, body: payload.body,
      status: 'open', priority: 'normal', assigned_to: null, group_id: null,
    } };
    await fixture.db.prepare(`INSERT INTO ticket_mutation_receipts
      (tenant_id,principal_kind,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,result_ticket_id,result_article_id,response_status,response_snapshot)
      VALUES (?,?,?,?,?,?,1,1,?,?,201,?)`).bind(
      fixture.principals.customerA.tenantId, 'api-key', credential.id, 'api.ticket.create', sha256(legacyKey),
      sha256(`ticket-mutation-v1\n${canonicalMutationJson(normalized)}`), ticket, sourceReceipt.result_article_id, JSON.stringify(retainedSnapshot),
    ).run();
    const beforeEvents = await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket);
    const replay = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: credential.apiKey, idempotencyKey: legacyKey, body: payload, ip: `${fixture.rateLimitIdentity}-v1-replay` });
    await expectStatus(replay, 201, 'Authorized retained v1 replay');
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    const body = await replay.json<{ canonical?: { conversation?: Json; messages?: Json[] } }>();
    assert.deepEqual(body.canonical?.conversation?.audit, { status: 'not-recorded' }, 'V1 retains its original truthful no-audit public shape');
    assert.equal(body.canonical?.messages?.some(message => (message.audit as Json | undefined)?.status !== 'not-recorded'), false, 'V1 messages cannot acquire later event references');
    assert.deepEqual(await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket), beforeEvents, 'Replay of a retained v1 receipt emits no retroactive event');
  });
});

test('audit transition chains are transaction-captured and customer history omits internal staff events', async () => {
  await withTwoTenantFixture(async fixture => {
    const credential = await fixture.createScopedApiKey('operatorA', ['tickets:write', 'tickets:read']);
    const created = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: credential.apiKey, body: {
      subject: 'history target', customer_email: fixture.principals.customerA.email, body: 'public intake',
    }, ip: `${fixture.rateLimitIdentity}-history-create` });
    await expectStatus(created, 201, 'History target intake');
    const ticket = ticketId(await created.json<Json>());
    const patches = await Promise.all([
      fixture.request(`/api/v1/tickets/${ticket}`, { method: 'PATCH', apiKey: credential.apiKey, body: { status: 'pending', priority: 'high' }, ip: `${fixture.rateLimitIdentity}-patch-a` }),
      fixture.request(`/api/v1/tickets/${ticket}`, { method: 'PATCH', apiKey: credential.apiKey, body: { status: 'resolved', priority: 'urgent' }, ip: `${fixture.rateLimitIdentity}-patch-b` }),
    ]);
    for (const response of patches) await expectStatus(response, 200, 'Concurrent audited PATCH');
    const assignee = '11111111-1111-4111-8111-111111111111';
    const group = '22222222-2222-4222-8222-222222222222';
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO users (tenant_id,id,email,full_name,password_hash,role,mfa_enabled) VALUES (?,?,?,?,?,?,0)')
        .bind(fixture.principals.customerA.tenantId, assignee, 'audit-assignee@example.invalid', 'Audit assignee', 'fixture-only', 'agent'),
      fixture.db.prepare('INSERT INTO groups (tenant_id,id,name,description) VALUES (?,?,?,?)')
        .bind(fixture.principals.customerA.tenantId, group, 'audit assignment group', 'fixture-only group'),
    ]);
    const assigned = await fixture.request(`/api/v1/tickets/${ticket}`, { method: 'PATCH', apiKey: credential.apiKey,
      body: { assigned_to: assignee, group_id: group }, ip: `${fixture.rateLimitIdentity}-assignment` });
    await expectStatus(assigned, 200, 'Audited assignment change');
    const afterAssignment = await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket);
    const assignment = afterAssignment.find(event => event.kind === 'ticket.assignment_changed');
    assert.ok(assignment, 'Assignment and group changes emit a distinct audit category');
    assert.deepEqual(JSON.parse(assignment.facts), { before: { assignedTo: null, groupId: null }, after: { assignedTo: assignee, groupId: group } });
    const noOp = await fixture.request(`/api/v1/tickets/${ticket}`, { method: 'PATCH', apiKey: credential.apiKey,
      body: { assigned_to: assignee, group_id: group }, ip: `${fixture.rateLimitIdentity}-assignment-noop` });
    await expectStatus(noOp, 200, 'Current unchanged assignment request');
    assert.equal((await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket)).length, afterAssignment.length, 'Unchanged fields cannot create an audit event');
    const staff = await staffToken(fixture);
    const publicReply = await fixture.request(`/api/tickets/${ticket}/articles`, { method: 'POST', token: staff, body: { body: 'public operator reply', is_internal: false }, ip: `${fixture.rateLimitIdentity}-public-reply` });
    await expectStatus(publicReply, 201, 'Dashboard public reply');
    const publicReplyArticle = articleId(await publicReply.json<Json>());
    const internal = await fixture.request(`/api/tickets/${ticket}/articles`, { method: 'POST', token: staff, body: { body: 'internal operator note', is_internal: true }, ip: `${fixture.rateLimitIdentity}-internal-reply` });
    await expectStatus(internal, 201, 'Dashboard internal reply');
    const events = await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket);
    assert.deepEqual(events.map(event => event.sequence), events.map((_event,index) => index + 1), 'Sequences must be monotonic per ticket');
    const transitions = events.filter(event => event.kind === 'ticket.state_changed');
    assert.equal(transitions.length, 2, 'Each changed PATCH emits one state event');
    const firstTransition = JSON.parse(transitions[0].facts) as { before: Json; after: Json };
    const secondTransition = JSON.parse(transitions[1].facts) as { before: Json; after: Json };
    assert.deepEqual(secondTransition.before, firstTransition.after, 'Concurrent patches form the persisted prior/new chain');
    const internalEvent = events.find(event => event.kind === 'message.reply' && event.visibility === 'internal');
    assert.ok(internalEvent);
    assert.equal(internalEvent.actor_kind, 'staff');
    assert.equal(internalEvent.actor_id, fixture.principals.operatorA.localId, 'Mutation actor is staff, independent of message author');
    const publicEvent = events.find(event => event.kind === 'message.reply' && event.article_id === publicReplyArticle);
    assert.ok(publicEvent, 'A public reply has an independently scoped event');
    const apiHistory = await fixture.request(`/api/v1/tickets/${ticket}/history`, { apiKey: credential.apiKey });
    await expectStatus(apiHistory, 200, 'API public-message history hides internal audit records');
    const apiPage = history(await apiHistory.json());
    assert.deepEqual(apiPage.events.map(event => event.id), [events[0].id, publicEvent.id], 'API history must not expose state or internal-message audit IDs');
    assert.equal(apiPage.events[0].actor.id, undefined);
    assert.equal(apiPage.events[0].sequence, undefined);
    assert.deepEqual(apiPage.events[0].facts, {});
    const customer = await customerToken(fixture, 'customerA', 'history');
    const customerHistory = await fixture.request(`/api/v1/customer/tickets/${ticket}/history?limit=1`, { token: customer });
    await expectStatus(customerHistory, 200, 'Customer public history page');
    const page = history(await customerHistory.json());
    assert.equal(page.events.length, 1);
    assert.equal(page.events[0].kind, 'ticket.intake');
    assert.equal(page.events[0].actor.id, undefined, 'Customer projection omits actor IDs');
    assert.equal(page.events[0].sequence, undefined, 'Customer projection omits sequence gaps');
    assert.deepEqual(page.events[0].facts, {}, 'Customer projection omits private facts');
    assert.equal(page.nextCursor, events[0].id, 'Cursor is the last visible event, not an internal sequence or count');
    const secondPage = await fixture.request(`/api/v1/customer/tickets/${ticket}/history?limit=1&cursor=${page.nextCursor}`, { token: customer });
    await expectStatus(secondPage, 200, 'Customer public second page');
    assert.deepEqual(history(await secondPage.json()).events.map(event => event.id), [publicEvent.id]);
    await fixture.db.prepare('UPDATE articles SET is_internal=1 WHERE tenant_id=? AND id=?')
      .bind(fixture.principals.customerA.tenantId, publicReplyArticle).run();
    const hiddenApi = await fixture.request(`/api/v1/tickets/${ticket}/history`, { apiKey: credential.apiKey });
    await expectStatus(hiddenApi, 200, 'API history after current visibility change');
    assert.deepEqual(history(await hiddenApi.json()).events.map(event => event.id), [events[0].id], 'A newly hidden article must not remain discoverable through API history');
    const hiddenDetail = await fixture.request(`/api/v1/tickets/${ticket}`, { apiKey: credential.apiKey });
    await expectStatus(hiddenDetail, 200, 'API detail after current visibility change');
    const hiddenDetailBody = await hiddenDetail.json<{ articles?: Array<{ id?: string }>; canonical?: unknown }>();
    assert.equal(hiddenDetailBody.articles?.some(article => article.id === publicReplyArticle), false, 'Current API detail does not expose the newly hidden article');
    assert.equal(JSON.stringify(hiddenDetailBody.canonical).includes(publicEvent.id), false, 'Canonical detail cannot retain a hidden article audit reference');
    const hiddenCustomer = await fixture.request(`/api/v1/customer/tickets/${ticket}/history?cursor=${publicEvent.id}`, { token: customer });
    assert.equal(hiddenCustomer.status, 400, 'An invisible cursor cannot disclose article-event existence');
    await fixture.db.prepare('DELETE FROM articles WHERE tenant_id=? AND id=?').bind(fixture.principals.customerA.tenantId, publicReplyArticle).run();
    const redacted = await fixture.db.prepare('SELECT article_id FROM conversation_events WHERE tenant_id=? AND id=?')
      .bind(fixture.principals.customerA.tenantId, publicEvent.id).first<{ article_id: string | null }>();
    assert.equal(redacted?.article_id, null, 'Article deletion redacts the audit content reference');
  });
});

test('event insertion failures roll back the whole D1 mutation and a clean retry produces one event', async () => {
  await withTwoTenantFixture(async fixture => {
    const key = await apiKey(fixture);
    const tenant = fixture.principals.customerA.tenantId;
    const count = async (table: 'tickets' | 'articles' | 'conversation_events' | 'ticket_mutation_receipts') =>
      (await fixture.db.prepare(`SELECT count(*) AS count FROM ${table} WHERE tenant_id=?`).bind(tenant).first<{ count: number }>())?.count ?? 0;
    const before = await Promise.all(['tickets','articles','conversation_events','ticket_mutation_receipts'].map(table => count(table as Parameters<typeof count>[0])));
    await fixture.db.prepare(`CREATE TRIGGER fail_audit_event BEFORE INSERT ON conversation_events
      BEGIN SELECT RAISE(ABORT, 'synthetic audit insertion failure'); END`).run();
    const failed = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key, idempotencyKey: 'audit-failure', body: {
      subject: 'must rollback audit', customer_email: fixture.principals.customerA.email, body: 'not persisted',
    }, ip: `${fixture.rateLimitIdentity}-audit-failure` });
    assert.equal(failed.status, 503, 'No receipt/event winner after a failed atomic audit insert');
    assert.deepEqual(await Promise.all(['tickets','articles','conversation_events','ticket_mutation_receipts'].map(table => count(table as Parameters<typeof count>[0]))), before);
    await fixture.db.prepare('DROP TRIGGER fail_audit_event').run();
    const recovered = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key, idempotencyKey: 'audit-failure', body: {
      subject: 'must rollback audit', customer_email: fixture.principals.customerA.email, body: 'not persisted',
    }, ip: `${fixture.rateLimitIdentity}-audit-retry` });
    await expectStatus(recovered, 201, 'Clean retry after event failure');
    const ticket = ticketId(await recovered.json<Json>());
    assert.equal((await eventsFor(fixture, tenant, ticket)).length, 1);
    const beforeReceiptFailure = await Promise.all(['tickets','articles','conversation_events','ticket_mutation_receipts'].map(table => count(table as Parameters<typeof count>[0])));
    await fixture.db.prepare(`CREATE TRIGGER fail_audit_receipt BEFORE INSERT ON ticket_mutation_receipts
      BEGIN SELECT RAISE(ABORT, 'synthetic receipt insertion failure'); END`).run();
    const laterFailure = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key, idempotencyKey: 'audit-receipt-failure', body: {
      subject: 'receipt after audit must rollback', customer_email: fixture.principals.customerA.email, body: 'no surviving event',
    }, ip: `${fixture.rateLimitIdentity}-audit-receipt-failure` });
    assert.equal(laterFailure.status, 503, 'A later receipt failure cannot report the already-inserted audit event as committed');
    assert.deepEqual(await Promise.all(['tickets','articles','conversation_events','ticket_mutation_receipts'].map(table => count(table as Parameters<typeof count>[0]))), beforeReceiptFailure,
      'The later receipt failure rolls back candidate ticket/article/event writes');
    await fixture.db.prepare('DROP TRIGGER fail_audit_receipt').run();
  });
});

test('intake provenance records the submitting principal instead of the message author across local route families', async () => {
  await withTwoTenantFixture(async fixture => {
    const staff = await staffToken(fixture);
    const dashboard = await fixture.request('/api/tickets', { method: 'POST', token: staff, body: {
      subject: 'dashboard-entered customer request', customer_email: fixture.principals.customerA.email, body: 'customer-authored initial message',
    }, ip: `${fixture.rateLimitIdentity}-dashboard-intake` });
    await expectStatus(dashboard, 201, 'MFA dashboard intake');
    const dashboardTicket = ticketId(await dashboard.json<Json>());
    const dashboardEvents = await eventsFor(fixture, fixture.principals.customerA.tenantId, dashboardTicket);
    assert.deepEqual(dashboardEvents.map(event => [event.kind,event.source,event.actor_kind,event.actor_id]),
      [['ticket.intake','dashboard','staff',fixture.principals.operatorA.localId]]);
    const dashboardArticle = await fixture.db.prepare('SELECT sender_type FROM articles WHERE tenant_id=? AND ticket_id=?')
      .bind(fixture.principals.customerA.tenantId,dashboardTicket).first<{ sender_type: string }>();
    assert.equal(dashboardArticle?.sender_type, 'customer', 'Dashboard-created intake represents the customer message without falsifying the staff mutation actor');

    const customer = await customerToken(fixture, 'customerA', 'all-sources');
    const portal = await fixture.request('/api/v1/customer/tickets', { method: 'POST', token: customer, idempotencyKey: 'portal-audit-source', body: {
      subject: 'portal intake', message: 'customer portal message',
    }, origin: 'http://localhost:5174', ip: `${fixture.rateLimitIdentity}-portal-intake` });
    await expectStatus(portal, 201, 'Customer portal intake');
    const portalTicket = ticketId(await portal.json<Json>());
    const portalEvents = await eventsFor(fixture, fixture.principals.customerA.tenantId, portalTicket);
    assert.deepEqual(portalEvents.map(event => [event.kind,event.source,event.actor_kind,event.actor_id,event.visibility]),
      [['ticket.intake','portal','customer',fixture.principals.customerA.localId,'public']]);

    const widget = await fixture.request('/api/v1/widget/tickets', { method: 'POST', token: customer, body: {
      subject: 'widget intake', email: fixture.principals.customerA.email, message: 'widget customer message',
    }, ip: `${fixture.rateLimitIdentity}-widget-intake` });
    await expectStatus(widget, 201, 'Authenticated widget intake');
    const widgetTicket = ticketId(await widget.json<Json>());
    const widgetEvents = await eventsFor(fixture, fixture.principals.customerA.tenantId, widgetTicket);
    assert.deepEqual(widgetEvents.map(event => [event.kind,event.source,event.actor_kind,event.actor_id,event.visibility]),
      [['ticket.intake','widget','customer',fixture.principals.customerA.localId,'public']]);

    const key = await apiKey(fixture);
    const bodyless = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key, body: {
      subject: 'bodyless API intake', customer_email: fixture.principals.customerA.email,
    }, ip: `${fixture.rateLimitIdentity}-bodyless-intake` });
    await expectStatus(bodyless, 201, 'Bodyless API intake');
    const bodylessTicket = ticketId(await bodyless.json<Json>());
    const bodylessEvents = await eventsFor(fixture, fixture.principals.customerA.tenantId, bodylessTicket);
    assert.equal(bodylessEvents.length, 1);
    assert.equal(bodylessEvents[0].article_id, null, 'A bodyless intake remains an auditable ticket event without a fabricated message reference');
  });
});

test('history rechecks current tenant credentials, MFA, ownership, and permissions before querying events', async () => {
  await withTwoTenantFixture(async fixture => {
    const writer = await fixture.createScopedApiKey('operatorA', ['tickets:write', 'tickets:read']);
    const ticketResponse = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: writer.apiKey, body: {
      subject: 'current history authority', customer_email: fixture.principals.customerA.email, body: 'public history seed',
    }, ip: `${fixture.rateLimitIdentity}-history-authority-create` });
    await expectStatus(ticketResponse, 201, 'History authority target');
    const ticket = ticketId(await ticketResponse.json<Json>());
    const before = await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket);
    const foreign = await fixture.createScopedApiKey('operatorB', ['tickets:read']);
    assert.equal((await fixture.request(`/api/v1/tickets/${ticket}/history`, { apiKey: foreign.apiKey })).status, 404, 'Tenant B cannot distinguish tenant A history');
    const writeOnly = await fixture.createScopedApiKey('operatorA', ['tickets:write']);
    assert.equal((await fixture.request(`/api/v1/tickets/${ticket}/history`, { apiKey: writeOnly.apiKey })).status, 403, 'Read permission is required before history lookup');
    const nonMfa = await fixture.login('operatorA');
    await expectStatus(nonMfa, 200, 'Staff password challenge');
    assert.equal((await fixture.request(`/api/tickets/${ticket}/history`, { token: tokenFrom(await nonMfa.json()) })).status, 401, 'Staff MFA-challenge credentials cannot read history before a verified MFA session exists');
    const customer = await customerToken(fixture, 'customerA', 'current-history-authority');
    await fixture.db.prepare('UPDATE tickets SET customer_email=? WHERE tenant_id=? AND id=?')
      .bind('former-owner@example.invalid', fixture.principals.customerA.tenantId, ticket).run();
    assert.equal((await fixture.request(`/api/v1/customer/tickets/${ticket}/history`, { token: customer })).status, 404, 'Current customer ownership is checked before history lookup');
    await fixture.revokePrincipalSessions('customerA');
    assert.equal((await fixture.request(`/api/v1/customer/tickets/${ticket}/history`, { token: customer })).status, 401, 'Revoked customer sessions cannot read an old event page');
    assert.deepEqual(await eventsFor(fixture, fixture.principals.customerA.tenantId, ticket), before, 'Denied history calls leave no audit side effect');
  });
});

test('ticket lifecycle erases scoped audit rows, redacts deleted actors, and preserves tenant B with bounded local evidence', async t => {
  await withTwoTenantFixture(async fixture => {
    const a = await fixture.createScopedApiKey('operatorA', ['tickets:write']);
    const b = await fixture.createScopedApiKey('operatorB', ['tickets:write']);
    const create = async (apiKey: string, tenant: 'A' | 'B') => {
      const principal = tenant === 'A' ? fixture.principals.customerA : fixture.principals.customerB;
      const result = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey, body: {
        subject: `lifecycle ${tenant}`, customer_email: principal.email, body: `lifecycle body ${tenant}`,
      }, ip: `${fixture.rateLimitIdentity}-lifecycle-${tenant}` });
      await expectStatus(result, 201, `Tenant ${tenant} lifecycle seed`);
      return ticketId(await result.json<Json>());
    };
    const ticketA = await create(a.apiKey, 'A');
    const ticketB = await create(b.apiKey, 'B');
    const bodyless = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: a.apiKey, body: {
      subject: 'audited retention bodyless intake', customer_email: fixture.principals.customerA.email,
    }, ip: `${fixture.rateLimitIdentity}-retention-bodyless` });
    await expectStatus(bodyless, 201, 'Audited bodyless retention target');
    const retentionTicket = ticketId(await bodyless.json<Json>());
    const retentionEvent = (await eventsFor(fixture, fixture.principals.customerA.tenantId, retentionTicket))[0];
    assert.equal(retentionEvent.article_id, null, 'Retention proof starts with an audited bodyless ticket');
    const eventA = (await eventsFor(fixture, fixture.principals.customerA.tenantId, ticketA))[0];
    assert.ok(Buffer.byteLength(eventA.facts) <= 4096, 'Facts obey the storage byte bound');
    await fixture.db.prepare('DELETE FROM api_keys WHERE tenant_id=? AND id=?').bind(fixture.principals.customerA.tenantId, a.id).run();
    const redacted = await fixture.db.prepare('SELECT actor_id,actor_kind,actor_provenance FROM conversation_events WHERE tenant_id=? AND id=?')
      .bind(fixture.principals.customerA.tenantId, eventA.id).first<{ actor_id: string | null; actor_kind: string; actor_provenance: string }>();
    assert.deepEqual(redacted, { actor_id: null, actor_kind: 'api-key', actor_provenance: 'api-key' }, 'Deleting a credential redacts its identifier without retaining the raw credential');
    await fixture.db.prepare('DELETE FROM articles WHERE tenant_id=? AND ticket_id=?').bind(fixture.principals.customerA.tenantId, ticketA).run();
    await fixture.db.prepare('DELETE FROM tickets WHERE tenant_id=? AND id=?').bind(fixture.principals.customerA.tenantId, ticketA).run();
    await fixture.db.prepare("UPDATE tickets SET updated_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=? AND id=?")
      .bind(fixture.principals.customerA.tenantId, retentionTicket).run();
    const retention = createRepositories(createSystemTenantScope({ tenantId: fixture.principals.customerA.tenantId, actor: 'conversation-audit-retention' }), fixture.db);
    const claim = await retention.tickets.claimRetention(retentionTicket, '2099-01-01T00:00:00.000Z');
    assert.ok(claim, 'Actual retention claim accepts the aged audited ticket');
    assert.equal(await retention.tickets.completeRetention(retentionTicket, claim.token), true, 'Actual retention completion deletes the claimed audited ticket');
    const aEvents = await fixture.db.prepare('SELECT count(*) AS count FROM conversation_events WHERE tenant_id=? AND ticket_id=?')
      .bind(fixture.principals.customerA.tenantId, ticketA).first<{ count: number }>();
    const bEvents = await fixture.db.prepare('SELECT count(*) AS count FROM conversation_events WHERE tenant_id=? AND ticket_id=?')
      .bind(fixture.principals.customerB.tenantId, ticketB).first<{ count: number }>();
    const retentionEvents = await fixture.db.prepare('SELECT count(*) AS count FROM conversation_events WHERE tenant_id=? AND ticket_id=?')
      .bind(fixture.principals.customerA.tenantId, retentionTicket).first<{ count: number }>();
    assert.equal(aEvents?.count, 0, 'Ticket deletion cascades only its tenant-scoped conversation events');
    assert.equal(retentionEvents?.count, 0, 'Actual retention completion cascades the audited bodyless event');
    assert.equal(bEvents?.count, 1, 'Tenant B audit history survives tenant A deletion');
    const usage = await fixture.resourceUsage();
    t.diagnostic(JSON.stringify({ factsBytes: Buffer.byteLength(eventA.facts), tenantADeletedEvents: aEvents?.count ?? 0, retentionDeletedEvents: retentionEvents?.count ?? 0,
      tenantBPreservedEvents: bEvents?.count ?? 0, d1Rows: usage.d1Rows, r2Objects: usage.r2Objects, routeRequests: usage.routeRequests }));
  });
});
