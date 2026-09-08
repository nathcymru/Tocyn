import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type FixtureResponse, type LocalTenantFixture } from './local-tenant-fixture';
import { createSystemTenantScope } from '../src/auth/scope';
import { TicketMutationReplayRepository } from '../src/repositories/ticket-mutation-replay.repository';

type Json = Record<string, unknown>;
type Receipt = {
  tenant_id: string;
  principal_kind: 'api-key' | 'customer';
  principal_id: string;
  operation: string;
  payload_hash: string;
  lifecycle: 'completed' | 'gone';
  result_ticket_id: string | null;
  result_article_id: string | null;
  response_snapshot: string | null;
  created_at: number;
  expires_at: number;
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

async function error(response: FixtureResponse, expected: number, code: string, reason: string): Promise<void> {
  await expectStatus(response, expected, reason);
  assert.equal((await response.json<Json>()).code, code, reason);
}

async function rows(fixture: LocalTenantFixture, tenantId?: string): Promise<{ tickets: number; articles: number; attachments: number; receipts: number }> {
  const tenant = tenantId ?? fixture.principals.customerA.tenantId;
  const count = async (table: string) => (await fixture.db.prepare(`SELECT count(*) AS count FROM ${table} WHERE tenant_id = ?`)
    .bind(tenant).first<{ count: number }>())?.count ?? 0;
  return { tickets: await count('tickets'), articles: await count('articles'), attachments: await count('attachments'), receipts: await count('ticket_mutation_receipts') };
}

async function receipts(fixture: LocalTenantFixture, tenantId = fixture.principals.customerA.tenantId): Promise<Receipt[]> {
  return (await fixture.db.prepare(`SELECT tenant_id, principal_kind, principal_id, operation, payload_hash, lifecycle,
    result_ticket_id, result_article_id, response_snapshot, created_at, expires_at
    FROM ticket_mutation_receipts WHERE tenant_id = ? ORDER BY created_at, operation`).bind(tenantId).all<Receipt>()).results;
}

async function apiKey(fixture: LocalTenantFixture, principal: 'operatorA' | 'operatorB' = 'operatorA'): Promise<string> {
  return (await fixture.createScopedApiKey(principal, ['tickets:write'])).apiKey;
}

async function portalToken(fixture: LocalTenantFixture, principal: 'customerA' | 'customerB', suffix: string): Promise<string> {
  const customer = fixture.principals[principal];
  await expectStatus(await fixture.request('/api/v1/customer/auth/request', {
    method: 'POST', ip: `${fixture.rateLimitIdentity}-portal-auth-${suffix}`,
    body: { email: customer.email, type: 'magic_link', widgetKey: customer.widgetKey },
  }), 200, 'Local customer authentication request');
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const message = messages.filter(candidate => candidate.to === customer.email).at(-1);
  assert.ok(message?.loginLink, 'Local capture must contain only a fixture customer link');
  const link = new URL(message.loginLink!);
  const challenge = link.searchParams.get('token');
  assert.ok(challenge, 'Local customer link must contain an opaque challenge');
  const verified = await fixture.request('/api/v1/customer/auth/verify', {
    method: 'POST', ip: `${fixture.rateLimitIdentity}-portal-verify-${suffix}`,
    body: { token: challenge, widgetKey: customer.widgetKey },
  });
  await expectStatus(verified, 200, 'Local customer authentication verification');
  return tokenFrom(await verified.json());
}

function apiCreate(fixture: LocalTenantFixture, key: string, retryKey: string | undefined, body: Json, suffix: string): Promise<FixtureResponse> {
  return fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key, idempotencyKey: retryKey, body, ip: `${fixture.rateLimitIdentity}-${suffix}` });
}

function apiReply(fixture: LocalTenantFixture, key: string, ticketId: string, retryKey: string | undefined, body: Json, suffix: string): Promise<FixtureResponse> {
  return fixture.request(`/api/v1/tickets/${ticketId}/articles`, { method: 'POST', apiKey: key, idempotencyKey: retryKey, body, ip: `${fixture.rateLimitIdentity}-${suffix}` });
}

function portalCreate(fixture: LocalTenantFixture, token: string, retryKey: string | undefined, body: Json, suffix: string): Promise<FixtureResponse> {
  return fixture.request('/api/v1/customer/tickets', { method: 'POST', token, idempotencyKey: retryKey, body, ip: `${fixture.rateLimitIdentity}-${suffix}`, origin: 'http://localhost:5174' });
}

function portalReply(fixture: LocalTenantFixture, token: string, ticketId: string, retryKey: string | undefined, body: Json, suffix: string): Promise<FixtureResponse> {
  return fixture.request(`/api/v1/customer/tickets/${ticketId}/messages`, { method: 'POST', token, idempotencyKey: retryKey, body, ip: `${fixture.rateLimitIdentity}-${suffix}`, origin: 'http://localhost:5174' });
}

function ticketId(body: Json): string {
  const ticket = typeof body.ticket === 'object' && body.ticket ? body.ticket as Json : body;
  const id = ticket.id;
  if (typeof id !== 'string') throw new Error('Expected ticket id in mutation response');
  return id;
}

function articleId(body: Json): string {
  const article = typeof body.article === 'object' && body.article ? body.article as Json : body;
  const id = article.id;
  if (typeof id !== 'string') throw new Error('Expected article id in mutation response');
  return id;
}

test('retry-safe mutations: absent key remains compatible while malformed, non-JSON, malformed JSON, and oversized input leave no receipt or mutation', async t => {
  await withTwoTenantFixture(async fixture => {
    const key = await apiKey(fixture);
    const before = await rows(fixture);
    const unkeyed = await apiCreate(fixture, key, undefined, {
      subject: 'unkeyed bodyless compatibility', customer_email: fixture.principals.customerA.email,
    }, 'unkeyed');
    await expectStatus(unkeyed, 201, 'Bodyless API creation preserves its existing success status');
    assert.equal(unkeyed.headers.get('Idempotency-Replayed'), null, 'Unkeyed compatibility must not advertise a replay result');
    const bodyless = await unkeyed.json<Json>();
    assert.ok(ticketId(bodyless));
    assert.equal((await rows(fixture)).tickets, before.tickets + 1);
    assert.equal((await rows(fixture)).articles, before.articles, 'Bodyless API creation must not manufacture an article');
    assert.equal((await rows(fixture)).receipts, before.receipts, 'Unkeyed calls must create no receipt');

    const rejectedBefore = await rows(fixture);
    await error(await apiCreate(fixture, key, 'contains space', {
      subject: 'must not persist', customer_email: fixture.principals.customerA.email,
    }, 'header'), 400, 'invalid_idempotency_key', 'Whitespace key');
    await error(await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: key, idempotencyKey: 'wrong-content-type', contentType: 'text/plain', rawBody: 'plain', ip: `${fixture.rateLimitIdentity}-content-type`,
    }), 415, 'unsupported_media_type', 'Non-JSON mutation body');
    await error(await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: key, idempotencyKey: 'bad-json', rawBody: '{', ip: `${fixture.rateLimitIdentity}-bad-json`,
    }), 400, 'invalid_json', 'Malformed JSON');
    await expectStatus(await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: key, idempotencyKey: 'too-large', rawBody: JSON.stringify({ subject: 'x'.repeat(64 * 1024), customer_email: fixture.principals.customerA.email }), ip: `${fixture.rateLimitIdentity}-too-large`,
    }), 413, 'Streamed over-limit JSON');
    assert.deepEqual(await rows(fixture), rejectedBefore, 'Rejected requests must not create mutations or receipts');
    t.diagnostic(JSON.stringify({ validationRejections: 4, persistedRowsAfterRejections: 0, fixture: 'real-miniflare-d1-r2' }));
  });
});

test('retry-safe API create: same key and semantic payload replay an immutable original response after later ticket edits', async t => {
  await withTwoTenantFixture(async fixture => {
    const key = await apiKey(fixture);
    const payload = { subject: 'immutable stored receipt', customer_email: fixture.principals.customerA.email, body: 'original message', custom_fields: { b: true, a: 1 } };
    fixture.resetNotificationAttempts();
    const first = await apiCreate(fixture, key, 'api-create-replay', payload, 'first');
    await expectStatus(first, 201, 'First keyed API create');
    assert.equal(first.headers.get('Idempotency-Replayed'), 'false');
    const firstBody = await first.json<Json>();
    const createdTicket = ticketId(firstBody);
    assert.equal(fixture.notificationAttempts(), 0, 'API creates have no current broadcast side effect');
    const afterFirst = await rows(fixture);
    assert.equal(afterFirst.receipts, 1);
    const stored = await receipts(fixture);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].lifecycle, 'completed');
    assert.ok(stored[0].response_snapshot && Buffer.byteLength(stored[0].response_snapshot) <= 256 * 1024, 'Receipt snapshot must be present and bounded');
    const hashes = await fixture.db.prepare('SELECT key_hash, payload_hash, response_snapshot FROM ticket_mutation_receipts WHERE tenant_id = ?')
      .bind(fixture.principals.customerA.tenantId).first<{ key_hash: string; payload_hash: string; response_snapshot: string }>();
    assert.ok(hashes && /^[a-f0-9]{64}$/.test(hashes.key_hash) && /^[a-f0-9]{64}$/.test(hashes.payload_hash));
    assert.equal(hashes?.key_hash.includes('api-create-replay'), false, 'Receipts persist a key digest, never the raw retry key');
    assert.equal(hashes?.response_snapshot.includes('api-create-replay'), false, 'Snapshots omit retry credentials');
    await fixture.db.prepare('UPDATE tickets SET subject = ?, status = ? WHERE tenant_id = ? AND id = ?')
      .bind('edited after success', 'closed', fixture.principals.customerA.tenantId, createdTicket).run();
    const replay = await apiCreate(fixture, key, 'api-create-replay', {
      body: 'original message', custom_fields: { a: 1, b: true }, customer_email: fixture.principals.customerA.email, subject: 'immutable stored receipt',
    }, 'replay');
    await expectStatus(replay, 201, 'Authorized same-key API replay');
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(await replay.json<Json>(), firstBody, 'Replay must use the immutable receipt renderer, never mutable current ticket rows');
    assert.deepEqual(await rows(fixture), afterFirst, 'Replay must create no ticket, article, attachment, or receipt');
    t.diagnostic(JSON.stringify({ receiptBytes: Buffer.byteLength(stored[0].response_snapshot!), ticketRows: afterFirst.tickets, articleRows: afterFirst.articles, notificationAttempts: fixture.notificationAttempts() }));
  });
});

test('retry-safe API mutations: concurrent matching retries elect one durable winner; meaningful reuse conflicts without cross-tenant leakage', async t => {
  await withTwoTenantFixture(async fixture => {
    const aKey = await apiKey(fixture, 'operatorA');
    const bKey = await apiKey(fixture, 'operatorB');
    const beforeA = await rows(fixture, fixture.principals.customerA.tenantId);
    const payload = { subject: 'one concurrent create', customer_email: fixture.principals.customerA.email, body: 'one concurrent article' };
    const concurrent = await Promise.all(Array.from({ length: 6 }, (_, index) => apiCreate(fixture, aKey, 'concurrent-create', payload, `concurrent-${index}`)));
    const bodies = await Promise.all(concurrent.map(async response => {
      await expectStatus(response, 201, 'Same-key concurrent creation');
      return response.json<Json>();
    }));
    assert.equal(new Set(bodies.map(ticketId)).size, 1, 'All concurrent successes must identify the one committed ticket');
    assert.equal(concurrent.filter(response => response.headers.get('Idempotency-Replayed') === 'false').length, 1, 'Exactly one request owns the initial completion');
    const afterA = await rows(fixture, fixture.principals.customerA.tenantId);
    assert.deepEqual(afterA, { tickets: beforeA.tickets + 1, articles: beforeA.articles + 1, attachments: beforeA.attachments, receipts: beforeA.receipts + 1 }, 'D1 must commit exactly one ticket/article/receipt set');

    await error(await apiCreate(fixture, aKey, 'concurrent-create', {
      ...payload, body: 'different persisted content',
    }, 'conflict-body'), 409, 'idempotency_conflict', 'Same namespace with a materially different body');
    assert.deepEqual(await rows(fixture, fixture.principals.customerA.tenantId), afterA, 'Conflict must have no durable side effect');

    const ticket = ticketId(bodies[0]);
    const firstReply = await apiReply(fixture, aKey, ticket, 'reply-target-conflict', { body: 'one reply' }, 'reply-first');
    await expectStatus(firstReply, 201, 'First reply');
    const replyBody = await firstReply.json<Json>();
    const afterReply = await rows(fixture, fixture.principals.customerA.tenantId);
    await error(await apiReply(fixture, aKey, 'fixture-ticket', 'reply-target-conflict', { body: 'one reply' }, 'reply-other-target'), 409, 'idempotency_conflict', 'Same reply key on another target');
    assert.deepEqual(await rows(fixture, fixture.principals.customerA.tenantId), afterReply, 'Target conflict must not add an article');

    const isolated = await apiCreate(fixture, bKey, 'concurrent-create', {
      subject: 'same opaque key B', customer_email: fixture.principals.customerB.email, body: 'separate tenant namespace',
    }, 'tenant-b');
    await expectStatus(isolated, 201, 'Same opaque key must be independent in tenant B');
    const aReceipts = await receipts(fixture, fixture.principals.customerA.tenantId);
    const bReceipts = await receipts(fixture, fixture.principals.customerB.tenantId);
    assert.equal(aReceipts.filter(row => row.operation === 'api.ticket.create').length, 1);
    assert.equal(bReceipts.filter(row => row.operation === 'api.ticket.create').length, 1);
    const secondAKey = await apiKey(fixture, 'operatorA');
    const separatelyScoped = await apiCreate(fixture, secondAKey, 'concurrent-create', {
      subject: 'same opaque key second credential', customer_email: fixture.principals.customerA.email, body: 'independent key id namespace',
    }, 'second-api-credential');
    await expectStatus(separatelyScoped, 201, 'A different API credential gets an independent namespace');
    assert.notEqual(ticketId(await separatelyScoped.json<Json>()), ticket, 'New credential must not replay another credential’s receipt');
    assert.equal(articleId(replyBody).length > 0, true);
    t.diagnostic(JSON.stringify({ concurrentRequests: 6, committedTicketRows: 1, committedArticleRows: 2, receiptRowsA: aReceipts.length, receiptRowsB: bReceipts.length }));
  });
});

test('concurrent portal replies with an attachment commit one article/attachment receipt and one broadcast; a lost response recovers from that receipt', async t => {
  await withTwoTenantFixture(async fixture => {
    const key = await apiKey(fixture);
    const token = await portalToken(fixture, 'customerA', 'concurrent-replies');
    const targetResponse = await apiCreate(fixture, key, 'reply-concurrent-target', {
      subject: 'reply target', customer_email: fixture.principals.customerA.email, body: 'initial',
    }, 'reply-target');
    await expectStatus(targetResponse, 201, 'Reply target creation');
    const target = ticketId(await targetResponse.json<Json>());
    const logicalKey = `customer-attachments/${fixture.principals.customerA.localId}/concurrent.txt`;
    await fixture.r2.bucket.put(`${fixture.principals.customerA.tenantId}/${logicalKey}`, 'concurrent attachment', { httpMetadata: { contentType: 'text/plain' } });
    fixture.resetNotificationAttempts();
    const before = await rows(fixture);
    const attempts = await Promise.all(Array.from({ length: 5 }, (_, index) => portalReply(fixture, token, target, 'concurrent-reply', {
      message: 'same reply', attachments: [{ storageKey: logicalKey, filename: 'concurrent.txt' }],
    }, `concurrent-reply-${index}`)));
    const bodies = await Promise.all(attempts.map(async response => {
      await expectStatus(response, 201, 'Same-key concurrent portal reply');
      return response.json<Json>();
    }));
    assert.equal(new Set(bodies.map(articleId)).size, 1, 'All concurrent replies return the winner’s article');
    assert.equal(attempts.filter(response => response.headers.get('Idempotency-Replayed') === 'false').length, 1, 'Exactly one portal reply is a committed winner');
    assert.deepEqual(await rows(fixture), {
      tickets: before.tickets,
      articles: before.articles + 1,
      attachments: before.attachments + 1,
      receipts: before.receipts + 1,
    }, 'D1 commits one reply, one attachment set, one touch, and one receipt');
    assert.equal(fixture.notificationAttempts(), 1, 'Only the committed winner invokes notification');

    const lostKey = 'response-lost-recovery';
    const beforeLost = await rows(fixture);
    const lostResponse = await apiCreate(fixture, key, lostKey, {
      subject: 'client lost response', customer_email: fixture.principals.customerA.email, body: 'durably completed before delivery',
    }, 'lost-response-first');
    await expectStatus(lostResponse, 201, 'Commit before simulated client response loss');
    await lostResponse.body?.cancel();
    const recovered = await apiCreate(fixture, key, lostKey, {
      subject: 'client lost response', customer_email: fixture.principals.customerA.email, body: 'durably completed before delivery',
    }, 'lost-response-retry');
    await expectStatus(recovered, 201, 'Retry after client-side response loss');
    assert.equal(recovered.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(await rows(fixture), {
      tickets: beforeLost.tickets + 1,
      articles: beforeLost.articles + 1,
      attachments: beforeLost.attachments,
      receipts: beforeLost.receipts + 1,
    }, 'A lost HTTP response must recover one already committed result without a second mutation');
    t.diagnostic(JSON.stringify({ concurrentReplyAttempts: 5, committedArticleRows: 1, committedAttachmentRows: 1, notificationAttempts: fixture.notificationAttempts(), responseLostRecoveryMutations: 1 }));
  });
});

test('portal replay reauthorizes active customer ownership and session state before returning a stored receipt', async t => {
  await withTwoTenantFixture(async fixture => {
    const tokenA = await portalToken(fixture, 'customerA', 'a');
    const tokenB = await portalToken(fixture, 'customerB', 'b');
    fixture.resetNotificationAttempts();
    const created = await portalCreate(fixture, tokenA, 'portal-create', { subject: 'portal receipt', message: 'original portal message' }, 'portal-create');
    await expectStatus(created, 201, 'First portal creation');
    const createdBody = await created.json<Json>();
    const ticket = ticketId(createdBody);
    assert.equal(fixture.notificationAttempts(), 0, 'Portal create has no current broadcast path');
    const firstReply = await portalReply(fixture, tokenA, ticket, 'portal-reply', { message: 'customer reply' }, 'portal-reply');
    await expectStatus(firstReply, 201, 'First portal reply');
    const firstReplyBody = await firstReply.json<Json>();
    assert.equal(fixture.notificationAttempts(), 1, 'Only the committed portal reply broadcasts once');
    const stable = await rows(fixture);
    const replay = await portalReply(fixture, tokenA, ticket, 'portal-reply', { message: 'customer reply' }, 'portal-replay');
    await expectStatus(replay, 201, 'Current owner may replay');
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(await replay.json<Json>(), firstReplyBody);
    assert.equal(fixture.notificationAttempts(), 1, 'Replay must make no broadcast attempt');
    assert.deepEqual(await rows(fixture), stable, 'Portal replay must not write');

    const refreshedToken = await portalToken(fixture, 'customerA', 'a-refreshed');
    const refreshedReplay = await portalReply(fixture, refreshedToken, ticket, 'portal-reply', { message: 'customer reply' }, 'portal-refreshed-replay');
    await expectStatus(refreshedReplay, 201, 'A refreshed valid customer session shares the customer retry namespace');
    assert.equal(refreshedReplay.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(await refreshedReplay.json<Json>(), firstReplyBody);
    assert.equal(fixture.notificationAttempts(), 1, 'A refreshed-session replay must not broadcast');

    await expectStatus(await portalReply(fixture, tokenB, ticket, 'portal-reply', { message: 'customer reply' }, 'foreign-owner'), 404, 'Foreign customer before receipt lookup');
    assert.deepEqual(await rows(fixture), stable, 'Foreign receipt possession must never write or disclose');
    await fixture.revokePrincipalSessions('customerA');
    await expectStatus(await portalReply(fixture, tokenA, ticket, 'portal-reply', { message: 'customer reply' }, 'revoked'), 401, 'Revoked portal token before receipt lookup');
    assert.deepEqual(await rows(fixture), stable, 'Revoked replay must not alter receipt or ticket');
    t.diagnostic(JSON.stringify({ portalReplyRows: 1, notificationAttempts: fixture.notificationAttempts(), foreignReplayWrites: 0, revokedReplayWrites: 0 }));
  });
});

test('API replay rechecks current key permission and revocation before any cached result can be returned', async () => {
  await withTwoTenantFixture(async fixture => {
    const credential = await fixture.createScopedApiKey('operatorA', ['tickets:write']);
    const key = credential.apiKey;
    const first = await apiCreate(fixture, key, 'api-auth-recheck', {
      subject: 'API authorization replay', customer_email: fixture.principals.customerA.email, body: 'cached only after auth',
    }, 'api-auth-first');
    await expectStatus(first, 201, 'Keyed API success before authorization change');
    const stable = await rows(fixture);
    await fixture.db.prepare('UPDATE api_keys SET permissions = ? WHERE tenant_id = ? AND id = ?')
      .bind('tickets:read', fixture.principals.customerA.tenantId, credential.id).run();
    await expectStatus(await apiCreate(fixture, key, 'api-auth-recheck', {
      subject: 'API authorization replay', customer_email: fixture.principals.customerA.email, body: 'cached only after auth',
    }, 'api-permission-revoked'), 403, 'Lost write permission before receipt lookup');
    assert.deepEqual(await rows(fixture), stable, 'Permission denial must not alter cached data or mutation rows');
    await fixture.db.prepare('UPDATE api_keys SET is_active = 0 WHERE tenant_id = ? AND id = ?')
      .bind(fixture.principals.customerA.tenantId, credential.id).run();
    await expectStatus(await apiCreate(fixture, key, 'api-auth-recheck', {
      subject: 'API authorization replay', customer_email: fixture.principals.customerA.email, body: 'cached only after auth',
    }, 'api-key-revoked'), 401, 'Revoked API key before receipt lookup');
    assert.deepEqual(await rows(fixture), stable, 'Revoked API key must not create, replay, or disclose a mutation');
  });
});

test('portal replay denies a same-tenant result after current ownership or visibility changes', async () => {
  await withTwoTenantFixture(async fixture => {
    const token = await portalToken(fixture, 'customerA', 'current-visibility');
    const created = await portalCreate(fixture, token, 'portal-owner-change', { subject: 'current ownership', message: 'first message' }, 'owner-change-first');
    await expectStatus(created, 201, 'Portal create before ownership change');
    const ticket = ticketId(await created.json<Json>());
    await fixture.db.prepare('UPDATE tickets SET customer_email = ? WHERE tenant_id = ? AND id = ?')
      .bind(fixture.principals.operatorA.email, fixture.principals.customerA.tenantId, ticket).run();
    await expectStatus(await portalCreate(fixture, token, 'portal-owner-change', { subject: 'current ownership', message: 'first message' }, 'owner-change-replay'), 404, 'Current same-tenant ownership loss before cached create response');

    const key = await apiKey(fixture);
    const target = await apiCreate(fixture, key, 'visibility-target', {
      subject: 'visibility target', customer_email: fixture.principals.customerA.email, body: 'initial',
    }, 'visibility-target');
    await expectStatus(target, 201, 'Visibility target creation');
    const replyTarget = ticketId(await target.json<Json>());
    const reply = await portalReply(fixture, token, replyTarget, 'portal-visibility-change', { message: 'customer-visible first' }, 'visibility-first');
    await expectStatus(reply, 201, 'Portal reply before visibility change');
    const replyId = articleId(await reply.json<Json>());
    await fixture.db.prepare('UPDATE articles SET is_internal = 1 WHERE tenant_id = ? AND id = ?')
      .bind(fixture.principals.customerA.tenantId, replyId).run();
    await expectStatus(await portalReply(fixture, token, replyTarget, 'portal-visibility-change', { message: 'customer-visible first' }, 'visibility-replay'), 404, 'Current internal visibility blocks cached reply response');
  });
});

test('retry-safe mutations: real D1 receipt, second-write, and attachment insert failures roll back before a clean retry', async t => {
  await withTwoTenantFixture(async fixture => {
    const key = await apiKey(fixture);
    const beforeReceiptFailure = await rows(fixture);
    await fixture.db.prepare(`CREATE TRIGGER fail_test_receipt BEFORE INSERT ON ticket_mutation_receipts
      BEGIN SELECT RAISE(ABORT, 'synthetic receipt insertion failure'); END`).run();
    const failedReceipt = await apiCreate(fixture, key, 'receipt-rollback', {
      subject: 'receipt insert failure', customer_email: fixture.principals.customerA.email, body: 'must rollback',
    }, 'receipt-failure');
    assert.notEqual(failedReceipt.status, 201, 'Receipt insertion failure cannot report a committed success');
    assert.deepEqual(await rows(fixture), beforeReceiptFailure, 'Receipt failure must roll back ticket and article together');
    await fixture.db.prepare('DROP TRIGGER fail_test_receipt').run();
    await expectStatus(await apiCreate(fixture, key, 'receipt-rollback', {
      subject: 'receipt insert failure', customer_email: fixture.principals.customerA.email, body: 'must rollback',
    }, 'receipt-clean-retry'), 201, 'Retry after receipt failure');

    const beforeArticleFailure = await rows(fixture);
    await fixture.db.prepare(`CREATE TRIGGER fail_test_article BEFORE INSERT ON articles
      BEGIN SELECT RAISE(ABORT, 'synthetic second write failure'); END`).run();
    const failedArticle = await apiCreate(fixture, key, 'article-rollback', {
      subject: 'article insert failure', customer_email: fixture.principals.customerA.email, body: 'second write must rollback',
    }, 'article-failure');
    assert.notEqual(failedArticle.status, 201, 'Second-write failure cannot report a committed success');
    assert.deepEqual(await rows(fixture), beforeArticleFailure, 'Article failure must roll back its ticket and receipt');
    await fixture.db.prepare('DROP TRIGGER fail_test_article').run();

    const token = await portalToken(fixture, 'customerA', 'attachment-failure');
    const seed = await apiCreate(fixture, key, 'attachment-ticket', {
      subject: 'attachment failure target', customer_email: fixture.principals.customerA.email, body: 'target',
    }, 'attachment-target');
    await expectStatus(seed, 201, 'Attachment target creation');
    const target = ticketId(await seed.json<Json>());
    const logicalKey = `customer-attachments/${fixture.principals.customerA.localId}/replay-attachment.txt`;
    await fixture.r2.bucket.put(`${fixture.principals.customerA.tenantId}/${logicalKey}`, 'fixture attachment', { httpMetadata: { contentType: 'text/plain' } });
    const beforeAttachmentFailure = await rows(fixture);
    const r2Before = fixture.r2.operationCounts();
    await fixture.db.prepare(`CREATE TRIGGER fail_test_attachment BEFORE INSERT ON attachments
      BEGIN SELECT RAISE(ABORT, 'synthetic attachment metadata failure'); END`).run();
    const failedAttachment = await portalReply(fixture, token, target, 'attachment-rollback', {
      message: 'attachment reply', attachments: [{ storageKey: logicalKey, filename: 'replay-attachment.txt' }],
    }, 'attachment-failure');
    assert.notEqual(failedAttachment.status, 201, 'Attachment metadata failure cannot report a committed reply');
    assert.deepEqual(await rows(fixture), beforeAttachmentFailure, 'Article, attachment metadata, touch, and receipt must roll back together');
    assert.equal(fixture.r2.operationCounts().delete, r2Before.delete, 'Pre-existing upload must never be deleted on metadata rollback');
    await fixture.db.prepare('DROP TRIGGER fail_test_attachment').run();
    const recovered = await portalReply(fixture, token, target, 'attachment-rollback', {
      message: 'attachment reply', attachments: [{ storageKey: logicalKey, filename: 'replay-attachment.txt' }],
    }, 'attachment-clean-retry');
    await expectStatus(recovered, 201, 'Attachment retry after D1 failure');
    const afterAttachmentRetry = await rows(fixture);
    assert.deepEqual(afterAttachmentRetry, {
      tickets: beforeAttachmentFailure.tickets,
      articles: beforeAttachmentFailure.articles + 1,
      attachments: beforeAttachmentFailure.attachments + 1,
      receipts: beforeAttachmentFailure.receipts + 1,
    });
    t.diagnostic(JSON.stringify({ failedReceiptRows: 0, failedArticleRows: 0, failedAttachmentMetadataRows: 0, r2ValidationReads: fixture.r2.operationCounts().get, committedAttachmentRows: 1 }));
  });
});

test('receipts respect expiry races, bounded tenant cleanup, tombstones, and external notification failure recovery', async t => {
  await withTwoTenantFixture(async fixture => {
    const aKey = await apiKey(fixture);
    const original = await apiCreate(fixture, aKey, 'expiry-race', {
      subject: 'expired key first result', customer_email: fixture.principals.customerA.email, body: 'first',
    }, 'expiry-first');
    await expectStatus(original, 201, 'Initial expiry candidate');
    const initialTicket = ticketId(await original.json<Json>());
    const originalReceipt = (await receipts(fixture)).find(receipt => receipt.operation === 'api.ticket.create');
    assert.ok(originalReceipt);
    await fixture.db.prepare(`UPDATE ticket_mutation_receipts SET created_at = unixepoch() - 86402, expires_at = unixepoch() - 1
      WHERE tenant_id = ? AND operation = ?`).bind(fixture.principals.customerA.tenantId, 'api.ticket.create').run();
    const beforeRace = await rows(fixture);
    const contenders = await Promise.all([
      apiCreate(fixture, aKey, 'expiry-race', { subject: 'expired key second result', customer_email: fixture.principals.customerA.email, body: 'second' }, 'expiry-winner-a'),
      apiCreate(fixture, aKey, 'expiry-race', { subject: 'expired key conflicting result', customer_email: fixture.principals.customerA.email, body: 'conflict' }, 'expiry-winner-b'),
    ]);
    const statuses = contenders.map(response => response.status).sort();
    assert.deepEqual(statuses, [201, 409], 'At the DB-clock expiry boundary exactly one payload becomes the next receipt');
    const afterRace = await rows(fixture);
    assert.deepEqual(afterRace, { tickets: beforeRace.tickets + 1, articles: beforeRace.articles + 1, attachments: beforeRace.attachments, receipts: beforeRace.receipts }, 'Expiry reuse replaces one expired receipt while committing one new mutation');

    const tombstoneResponse = await apiCreate(fixture, aKey, 'delete-tombstone', {
      subject: 'delete receipt target', customer_email: fixture.principals.customerA.email, body: 'delete me',
    }, 'delete-first');
    await expectStatus(tombstoneResponse, 201, 'Tombstone target creation');
    const deleteBody = await tombstoneResponse.json<Json>();
    const deleteTicket = ticketId(deleteBody);
    const receiptBeforeDeletion = (await receipts(fixture)).find(receipt => receipt.operation === 'api.ticket.create' && receipt.result_ticket_id === deleteTicket);
    assert.ok(receiptBeforeDeletion?.result_article_id, 'Create receipt must reference its live article before deletion');
    const deleted = await fixture.db.prepare('DELETE FROM articles WHERE tenant_id = ? AND id = ?')
      .bind(fixture.principals.customerA.tenantId, receiptBeforeDeletion.result_article_id).run();
    assert.ok(deleted.meta.changes >= 1, 'Article deletion and receipt redaction must affect D1');
    assert.equal((await fixture.db.prepare('SELECT count(*) AS count FROM articles WHERE tenant_id = ? AND id = ?')
      .bind(fixture.principals.customerA.tenantId, receiptBeforeDeletion.result_article_id).first<{ count: number }>())?.count, 0,
    'The test must delete the receipt’s actual result article');
    const tombstone = (await receipts(fixture)).find(receipt => receipt.payload_hash === receiptBeforeDeletion?.payload_hash);
    assert.ok(tombstone && tombstone.response_snapshot === null && tombstone.result_ticket_id === null && tombstone.result_article_id === null, 'Deletion must redact retained replay data into a tombstone');
    await error(await apiCreate(fixture, aKey, 'delete-tombstone', {
      subject: 'delete receipt target', customer_email: fixture.principals.customerA.email, body: 'delete me',
    }, 'delete-replay'), 410, 'idempotency_result_gone', 'Tombstoned matching replay');
    await error(await apiCreate(fixture, aKey, 'delete-tombstone', {
      subject: 'changed after deletion', customer_email: fixture.principals.customerA.email, body: 'different',
    }, 'delete-conflict'), 409, 'idempotency_conflict', 'Tombstoned conflicting reuse');
    assert.equal((await fixture.db.prepare('SELECT count(*) AS count FROM tickets WHERE tenant_id = ? AND id = ?').bind(fixture.principals.customerA.tenantId, deleteTicket).first<{ count: number }>())?.count, 1, 'No replay may create a replacement ticket after its result is redacted');

    const token = await portalToken(fixture, 'customerA', 'notification-failure');
    fixture.failNotificationAttempts(3);
    const failedNotice = await portalReply(fixture, token, initialTicket, 'notice-failure', { message: 'commit despite provider failure' }, 'notice-first');
    await expectStatus(failedNotice, 201, 'Notification failure stays best-effort after durable commit');
    const noticeBody = await failedNotice.json<Json>();
    const attemptsAfterWinner = fixture.notificationAttempts();
    assert.equal(attemptsAfterWinner, 3, 'Winner may use the current bounded notification retry policy');
    const noticeReplay = await portalReply(fixture, token, initialTicket, 'notice-failure', { message: 'commit despite provider failure' }, 'notice-replay');
    await expectStatus(noticeReplay, 201, 'Replay after lost/failed notification');
    assert.deepEqual(await noticeReplay.json<Json>(), noticeBody);
    assert.equal(fixture.notificationAttempts(), attemptsAfterWinner, 'Replay must not retry an external notification');

    const noticeReceipt = (await receipts(fixture)).find(receipt => receipt.operation === 'portal.ticket.reply' && receipt.result_article_id);
    assert.ok(noticeReceipt?.result_article_id, 'Committed active-ticket reply must retain a result article until deletion');
    await fixture.db.prepare('DELETE FROM articles WHERE tenant_id = ? AND id = ?')
      .bind(fixture.principals.customerA.tenantId, noticeReceipt.result_article_id).run();
    await error(await portalReply(fixture, token, initialTicket, 'notice-failure', { message: 'commit despite provider failure' }, 'notice-tombstone'), 410, 'idempotency_result_gone', 'Deleted reply result on an otherwise active target');

    const attachmentKey = `customer-attachments/${fixture.principals.customerA.localId}/tombstone.txt`;
    await fixture.r2.bucket.put(`${fixture.principals.customerA.tenantId}/${attachmentKey}`, 'tombstone attachment', { httpMetadata: { contentType: 'text/plain' } });
    const attachmentReply = await portalReply(fixture, token, initialTicket, 'attachment-tombstone', {
      message: 'attachment tombstone', attachments: [{ storageKey: attachmentKey, filename: 'tombstone.txt' }],
    }, 'attachment-tombstone-first');
    await expectStatus(attachmentReply, 201, 'Attachment replay tombstone target');
    const attachmentReceipt = (await receipts(fixture)).find(receipt => receipt.operation === 'portal.ticket.reply' && receipt.result_article_id && receipt.lifecycle === 'completed');
    assert.ok(attachmentReceipt?.result_article_id);
    await fixture.db.prepare('DELETE FROM attachments WHERE tenant_id = ? AND article_id = ?')
      .bind(fixture.principals.customerA.tenantId, attachmentReceipt.result_article_id).run();
    await error(await portalReply(fixture, token, initialTicket, 'attachment-tombstone', {
      message: 'attachment tombstone', attachments: [{ storageKey: attachmentKey, filename: 'tombstone.txt' }],
    }, 'attachment-tombstone-replay'), 410, 'idempotency_result_gone', 'Deleted attachment result on an otherwise active target');

    const stale = async (tenantId: string, suffix: number) => fixture.db.prepare(`INSERT INTO ticket_mutation_receipts
      (tenant_id, principal_kind, principal_id, operation, key_hash, payload_hash, fingerprint_version, response_version, created_at, expires_at, lifecycle, response_status)
      VALUES (?, 'api-key', ?, 'api.ticket.create', ?, ?, 1, 1, unixepoch() - 86402, unixepoch() - 1, 'gone', 201)`)
      .bind(tenantId, `cleanup-${suffix}`, String(suffix).padStart(64, 'a'), String(suffix).padStart(64, 'b')).run();
    for (let index = 0; index < 101; index++) await stale(fixture.principals.customerA.tenantId, index + 1000);
    await stale(fixture.principals.customerB.tenantId, 2000);
    const cleanup = new TicketMutationReplayRepository(fixture.db, createSystemTenantScope({ tenantId: fixture.principals.customerA.tenantId, actor: 'local-replay-cleanup-test' }));
    assert.equal(await cleanup.purgeExpired(100), 100, 'Local cleanup must remove at most 100 expired rows for its tenant');
    const aExpired = await fixture.db.prepare('SELECT count(*) AS count FROM ticket_mutation_receipts WHERE tenant_id = ? AND expires_at <= unixepoch()').bind(fixture.principals.customerA.tenantId).first<{ count: number }>();
    const bExpired = await fixture.db.prepare('SELECT count(*) AS count FROM ticket_mutation_receipts WHERE tenant_id = ? AND expires_at <= unixepoch()').bind(fixture.principals.customerB.tenantId).first<{ count: number }>();
    assert.equal(aExpired?.count, 1, 'Bounded tenant cleanup leaves excess work for a later local run');
    assert.equal(bExpired?.count, 1, 'Tenant A cleanup must not touch tenant B receipts');
    t.diagnostic(JSON.stringify({ expiryRaceCommittedMutations: 1, tombstoneResurrections: 0, cleanupRows: 100, tenantBCleanupRows: 0, notificationAttempts: attemptsAfterWinner }));
  });
});

test('CORS exposes the retry contract only to the configured portal origin', async () => {
  await withTwoTenantFixture(async fixture => {
    const preflight = await fixture.request('/api/v1/customer/tickets', {
      method: 'OPTIONS', origin: 'http://localhost:5174',
      headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,idempotency-key' },
    });
    await expectStatus(preflight, 204, 'Configured portal retry-header preflight');
    assert.match(preflight.headers.get('Access-Control-Allow-Headers') ?? '', /Idempotency-Key/i);
    assert.match(preflight.headers.get('Access-Control-Expose-Headers') ?? '', /Idempotency-Replayed/i);
    const apiPreflight = await fixture.request('/api/v1/tickets', {
      method: 'OPTIONS', origin: 'http://localhost:5174',
      headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-api-key,idempotency-key' },
    });
    await expectStatus(apiPreflight, 204, 'Configured API retry-header preflight');
    assert.match(apiPreflight.headers.get('Access-Control-Allow-Headers') ?? '', /X-API-Key/i);
    const foreign = await fixture.request('/api/v1/customer/tickets', {
      method: 'OPTIONS', origin: 'https://untrusted.example.invalid',
      headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'idempotency-key' },
    });
    assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null, 'Untrusted origins cannot obtain credentialed retry-header CORS access');
  });
});
