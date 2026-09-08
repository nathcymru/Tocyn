import assert from 'node:assert/strict';
import test from 'node:test';
import { projectCanonicalConversation } from '../src/services/canonical-conversation.service';
import type { Article, Ticket } from '../src/types';
import { type FixturePrincipal, type FixtureResponse, type LocalTenantFixture, withTwoTenantFixture } from './local-tenant-fixture';

type JsonRecord = Record<string, unknown>;

const conversationKeys = [
  'audit', 'delivery', 'id', 'identifiers', 'localCorrelation', 'recipient', 'requester', 'source', 'subject', 'ticketNumber', 'timestamps', 'workflow',
];
const messageKeys = [
  'attachments', 'audit', 'author', 'content', 'conversationId', 'delivery', 'direction', 'id', 'identifiers', 'localCorrelation', 'recipient', 'source', 'state', 'timestamps', 'visibility',
];

function record(value: unknown, label: string): JsonRecord {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as JsonRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') assert.fail(`${label} must be a string`);
  return value;
}

async function expectStatus(response: FixtureResponse, expected: number, reason: string): Promise<void> {
  if (response.status === expected) return;
  await response.body?.cancel();
  assert.fail(`${reason}: received ${response.status}`);
}

async function customerWidgetToken(fixture: LocalTenantFixture, principal: FixturePrincipal): Promise<string> {
  const ip = `${fixture.rateLimitIdentity}-canonical-${principal.name}`;
  await expectStatus(await fixture.request('/api/v1/customer/auth/request', {
    method: 'POST', ip,
    body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey },
  }), 200, 'Customer auth request must accept the selected widget key');
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const link = messages.find(message => message.to === principal.email)?.loginLink;
  assert.ok(link, 'Local capture must contain the customer magic link');
  const parsed = new URL(link);
  const token = parsed.searchParams.get('token');
  assert.ok(token, 'Customer magic link must contain an opaque token');
  const verified = await fixture.request('/api/v1/customer/auth/verify', {
    method: 'POST', ip, body: { token, widgetKey: principal.widgetKey },
  });
  await expectStatus(verified, 200, 'Customer magic link must verify for its selected tenant');
  const payload = record(await verified.json(), 'customer verification response');
  return string(payload.token, 'customer widget token');
}

function canonical(value: unknown, label: string): JsonRecord {
  const projection = record(value, `${label}.canonical`);
  const conversation = record(projection.conversation, `${label}.canonical.conversation`);
  assert.ok(Array.isArray(projection.messages), `${label}.canonical.messages must be an array`);
  assert.ok('id' in conversation, `${label}.canonical conversation must retain its local identity`);
  assert.ok('source' in conversation, `${label}.canonical conversation must identify its intake path`);
  assert.ok('requester' in conversation, `${label}.canonical conversation must include requester provenance`);
  assert.ok('recipient' in conversation, `${label}.canonical conversation must include the logical support recipient`);
  assert.deepEqual(ownKeys(conversation), conversationKeys, `${label}.canonical conversation must use the documented typed field set`);
  return projection;
}

function canonicalFrom(value: unknown, label: string): JsonRecord {
  return canonical(record(value, label).canonical, label);
}

function ownKeys(value: JsonRecord): string[] {
  return Object.keys(value).sort();
}

function known(value: unknown, expected: unknown, label: string): void {
  const fact = record(value, label);
  assert.deepEqual(fact, { status: 'known', value: expected }, `${label} must be a recorded fact`);
}

function factStatus(value: unknown, expected: string, label: string): void {
  assert.equal(record(value, label).status, expected, `${label} must preserve its truthful fact status`);
}

function timestamps(value: JsonRecord, label: string): JsonRecord {
  return record(value.timestamps, `${label}.timestamps`);
}

async function tableCounts(fixture: LocalTenantFixture): Promise<{ tickets: number; articles: number; attachments: number }> {
  const count = async (table: 'tickets' | 'articles' | 'attachments') => {
    const row = await fixture.db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>();
    return row?.count ?? 0;
  };
  return { tickets: await count('tickets'), articles: await count('articles'), attachments: await count('attachments') };
}

test('API and portal project the same tenant-safe canonical conversation contract', async () => {
  await withTwoTenantFixture(async fixture => {
    const widgetB = await customerWidgetToken(fixture, fixture.principals.customerB);
    const apiA = await fixture.createScopedApiKey('operatorA', ['tickets:read', 'tickets:write']);
    const apiB = await fixture.createScopedApiKey('operatorB', ['tickets:read', 'tickets:write']);

    const apiCreatedResponse = await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: apiA.apiKey,
      body: {
        subject: 'Canonical API intake', customer_email: fixture.principals.customerA.email, body: 'API initial message',
        tenant_id: fixture.principals.customerB.tenantId,
        external_id: 'untrusted-external-id', correlation_id: 'untrusted-correlation-id', direction: 'outbound',
      },
    });
    await expectStatus(apiCreatedResponse, 201, 'Scoped API create must succeed');
    const apiCreated = record(await apiCreatedResponse.json(), 'API create response');
    const apiTicketId = string(apiCreated.id, 'API ticket id');
    const apiCanonical = canonicalFrom(apiCreated, 'API create response');
    const apiConversation = record(apiCanonical.conversation, 'API canonical conversation');
    assert.equal(apiConversation.source, 'api');
    const apiRequester = record(apiConversation.requester, 'API canonical requester');
    assert.equal(apiRequester.kind, 'declared-requester');
    assert.equal(apiRequester.provenance, 'declared-requester');
    known(apiRequester.email, fixture.principals.customerA.email, 'API requester email');
    factStatus(apiRequester.id, 'not-recorded', 'API requester ID');
    assert.equal((apiCanonical.messages as unknown[]).length, 1, 'API body create must expose its initial message');
    const apiMessage = record((apiCanonical.messages as unknown[])[0], 'API canonical message');
    assert.deepEqual(ownKeys(apiMessage), messageKeys, 'API initial message must use the documented typed field set');
    known(apiMessage.direction, 'inbound', 'API initial-message direction');
    assert.deepEqual(apiMessage.state, { persistence: 'persisted' }, 'API initial message must report its persisted state');
    factStatus(record(apiMessage.identifiers, 'API message identifiers').external, 'not-recorded', 'API external identifier');
    assert.equal(JSON.stringify(apiCanonical).includes('untrusted-external-id'), false, 'Untrusted external identifiers must not become canonical facts');
    assert.equal(JSON.stringify(apiCanonical).includes('untrusted-correlation-id'), false, 'Untrusted correlation identifiers must not become canonical facts');
    const apiStored = await fixture.db.prepare('SELECT tenant_id FROM tickets WHERE id = ?').bind(apiTicketId).first<{ tenant_id: string }>();
    assert.equal(apiStored?.tenant_id, fixture.principals.customerA.tenantId, 'Request tenant selector must not override API-key scope');

    const apiStoredFacts = await fixture.db.prepare('SELECT created_at, updated_at, intake_received_at, intake_processed_at FROM tickets WHERE id = ?')
      .bind(apiTicketId).first<{ created_at: string; updated_at: string; intake_received_at: string; intake_processed_at: string }>();
    assert.ok(apiStoredFacts, 'API ticket must persist its observed intake facts');
    known(timestamps(apiConversation, 'API conversation').persistedAt, apiStoredFacts.created_at, 'API conversation persistence timestamp');
    known(timestamps(apiConversation, 'API conversation').updatedAt, apiStoredFacts.updated_at, 'API conversation update timestamp');
    known(timestamps(apiConversation, 'API conversation').intakeReceivedAt, apiStoredFacts.intake_received_at, 'API conversation receipt timestamp');
    known(timestamps(apiConversation, 'API conversation').intakeProcessedAt, apiStoredFacts.intake_processed_at, 'API conversation processing timestamp');
    const apiStoredMessageFacts = await fixture.db.prepare('SELECT created_at, received_at, processed_at FROM articles WHERE id = ?')
      .bind(string(apiMessage.id, 'API message id')).first<{ created_at: string; received_at: string; processed_at: string }>();
    assert.ok(apiStoredMessageFacts, 'API initial message must persist its observed intake facts');
    known(timestamps(apiMessage, 'API message').persistedAt, apiStoredMessageFacts.created_at, 'API message persistence timestamp');
    known(timestamps(apiMessage, 'API message').receivedAt, apiStoredMessageFacts.received_at, 'API message receipt timestamp');
    known(timestamps(apiMessage, 'API message').processedAt, apiStoredMessageFacts.processed_at, 'API message processing timestamp');

    const apiReadResponse = await fixture.request(`/api/v1/tickets/${apiTicketId}`, { apiKey: apiA.apiKey });
    await expectStatus(apiReadResponse, 200, 'API owner must read its canonical conversation');
    const apiReadCanonical = canonicalFrom(await apiReadResponse.json(), 'API detail response');
    assert.deepEqual(apiReadCanonical, apiCanonical, 'API detail must preserve every recorded canonical fact from create');

    const portalCreatedResponse = await fixture.request('/api/v1/customer/tickets', {
      method: 'POST', token: widgetB,
      body: { subject: 'Canonical portal intake', message: 'Portal initial message', tenant_id: fixture.principals.customerA.tenantId },
    });
    await expectStatus(portalCreatedResponse, 201, 'Authenticated portal create must succeed');
    const portalCreated = record(await portalCreatedResponse.json(), 'portal create response');
    const portalTicket = record(portalCreated.ticket, 'portal ticket');
    const portalTicketId = string(portalTicket.id, 'portal ticket id');
    const portalCanonical = canonicalFrom(portalCreated, 'portal create response');
    const portalConversation = record(portalCanonical.conversation, 'portal canonical conversation');
    assert.equal(portalConversation.source, 'portal');
    const portalRequester = record(portalConversation.requester, 'portal canonical requester');
    assert.equal(portalRequester.kind, 'authenticated-customer');
    assert.equal(portalRequester.provenance, 'authenticated-customer');
    known(portalRequester.id, fixture.principals.customerB.localId, 'portal requester ID');
    assert.equal((portalCanonical.messages as unknown[]).length, 1, 'Portal create must expose its initial message');
    assert.deepEqual(ownKeys(portalCanonical), ownKeys(apiCanonical), 'API and portal must use the same canonical envelope fields');
    assert.deepEqual(
      ownKeys(record((portalCanonical.messages as unknown[])[0], 'portal canonical message')),
      ownKeys(apiMessage),
      'API and portal initial messages must use the same canonical field names',
    );
    const portalStored = await fixture.db.prepare('SELECT tenant_id, customer_id FROM tickets WHERE id = ?').bind(portalTicketId).first<{ tenant_id: string; customer_id: string }>();
    assert.equal(portalStored?.tenant_id, fixture.principals.customerB.tenantId, 'Portal tenant selector must not override its route-issued identity');
    assert.equal(portalStored?.customer_id, fixture.principals.customerB.localId, 'Portal requester must be the authenticated customer');

    const portalCreatedReadResponse = await fixture.request(`/api/v1/customer/tickets/${portalTicketId}`, { token: widgetB });
    await expectStatus(portalCreatedReadResponse, 200, 'Portal owner must read its newly created canonical conversation');
    assert.deepEqual(canonicalFrom(await portalCreatedReadResponse.json(), 'portal initial detail response'), portalCanonical,
      'Portal detail must preserve every recorded canonical fact before later messages or attachments');
    const portalStoredFacts = await fixture.db.prepare('SELECT created_at, updated_at, intake_received_at, intake_processed_at FROM tickets WHERE id = ?')
      .bind(portalTicketId).first<{ created_at: string; updated_at: string; intake_received_at: string; intake_processed_at: string }>();
    assert.ok(portalStoredFacts, 'Portal ticket must persist its observed intake facts');
    known(timestamps(portalConversation, 'portal conversation').persistedAt, portalStoredFacts.created_at, 'portal conversation persistence timestamp');
    known(timestamps(portalConversation, 'portal conversation').updatedAt, portalStoredFacts.updated_at, 'portal conversation update timestamp');
    known(timestamps(portalConversation, 'portal conversation').intakeReceivedAt, portalStoredFacts.intake_received_at, 'portal conversation receipt timestamp');
    known(timestamps(portalConversation, 'portal conversation').intakeProcessedAt, portalStoredFacts.intake_processed_at, 'portal conversation processing timestamp');

    const attachmentKey = `customer-attachments/${fixture.principals.customerB.localId}/canonical-attachment.txt`;
    const beforeAttachment = await fixture.resourceUsage();
    await fixture.r2.bucket.put(attachmentKey, 'synthetic attachment');
    const portalArticle = record(portalCreated.article, 'portal initial article');
    await fixture.db.prepare('INSERT INTO attachments (tenant_id, id, article_id, file_name, file_size, content_type, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(fixture.principals.customerB.tenantId, 'canonical-attachment', string(portalArticle.id, 'portal article id'), 'canonical-attachment.txt', 20, 'text/plain', attachmentKey).run();
    const afterAttachment = await fixture.resourceUsage();
    assert.equal(afterAttachment.r2Objects, beforeAttachment.r2Objects + 1, 'Fixture resource counter must record the one persisted attachment object');

    await fixture.db.prepare('INSERT INTO articles (tenant_id, id, ticket_id, sender_type, body, is_internal) VALUES (?, ?, ?, ?, ?, 1)')
      .bind(fixture.principals.customerB.tenantId, 'canonical-internal', portalTicketId, 'agent', 'internal canonical fixture note').run();
    const portalReadResponse = await fixture.request(`/api/v1/customer/tickets/${portalTicketId}`, { token: widgetB });
    await expectStatus(portalReadResponse, 200, 'Portal owner must read its canonical conversation');
    const portalReadCanonical = canonicalFrom(await portalReadResponse.json(), 'portal detail response');
    assert.deepEqual(ownKeys(portalReadCanonical), ownKeys(portalCanonical), 'Portal create and detail must expose the same canonical envelope');
    assert.equal(JSON.stringify(portalReadCanonical).includes('internal canonical fixture note'), false, 'Portal canonical detail must exclude internal messages');
    assert.equal(JSON.stringify(portalReadCanonical).includes(attachmentKey), false, 'Canonical attachment mapping must not expose raw R2 paths');
    assert.ok(JSON.stringify(portalReadCanonical).includes('canonical-attachment'), 'Canonical detail must retain its authorized attachment reference');

    const bodylessResponse = await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: apiA.apiKey,
      body: { subject: 'Bodyless API compatibility', customer_email: fixture.principals.customerA.email },
    });
    await expectStatus(bodylessResponse, 201, 'Bodyless API create must remain compatible');
    const bodylessCreated = record(await bodylessResponse.json(), 'bodyless API create response');
    const bodylessCanonical = canonicalFrom(bodylessCreated, 'bodyless API create response');
    assert.equal((bodylessCanonical.messages as unknown[]).length, 0, 'Bodyless API create must not manufacture an initial message');
    const bodylessConversation = record(bodylessCanonical.conversation, 'bodyless API canonical conversation');
    const bodylessStoredFacts = await fixture.db.prepare('SELECT created_at, updated_at, intake_received_at, intake_processed_at FROM tickets WHERE id = ?')
      .bind(string(bodylessCreated.id, 'bodyless ticket id'))
      .first<{ created_at: string; updated_at: string; intake_received_at: string; intake_processed_at: string }>();
    assert.ok(bodylessStoredFacts, 'Bodyless API ticket must persist its observed intake facts');
    known(timestamps(bodylessConversation, 'bodyless API conversation').persistedAt, bodylessStoredFacts.created_at, 'bodyless API persistence timestamp');
    known(timestamps(bodylessConversation, 'bodyless API conversation').updatedAt, bodylessStoredFacts.updated_at, 'bodyless API update timestamp');
    known(timestamps(bodylessConversation, 'bodyless API conversation').intakeReceivedAt, bodylessStoredFacts.intake_received_at, 'bodyless API receipt timestamp');
    known(timestamps(bodylessConversation, 'bodyless API conversation').intakeProcessedAt, bodylessStoredFacts.intake_processed_at, 'bodyless API processing timestamp');

    const beforeForeign = await tableCounts(fixture);
    await expectStatus(await fixture.request(`/api/v1/tickets/${apiTicketId}`, { apiKey: apiB.apiKey }), 404,
      'Foreign API key must not read another tenant canonical conversation');
    await expectStatus(await fixture.request(`/api/v1/customer/tickets/${portalTicketId}`, { token: await customerWidgetToken(fixture, fixture.principals.customerA) }), 404,
      'Foreign portal customer must not read another tenant canonical conversation');
    assert.deepEqual(await tableCounts(fixture), beforeForeign, 'Cross-tenant canonical read denials must not write ticket, message, or attachment rows');
  });
});

test('canonical projector preserves historical facts without inferring authentication, direction, or delivery', () => {
  const historicalTicket = {
    id: 'historical-ticket', ticket_no: null, subject: 'Historical conversation', status: 'open', priority: 'normal',
    customer_email: 'historic@example.invalid', source: 'portal', created_at: '2026-09-09T00:00:00.000Z', updated_at: '2026-09-09T00:00:00.000Z',
  } as unknown as Ticket;
  const agentInternal = {
    id: 'historical-agent-note', ticket_id: historicalTicket.id, sender_type: 'agent', sender_id: 'recorded-agent', body: 'internal historic note', is_internal: true,
    created_at: '2026-09-09T00:00:01.000Z',
  } as Article;
  const systemWithStoredBodyReference = {
    id: 'historical-system-event', ticket_id: historicalTicket.id, sender_type: 'system', sender_id: 'recorded-system', body_r2_key: 'tenant-private/body-key', is_internal: false,
    created_at: '2026-09-09T00:00:02.000Z',
  } as Article;
  const dashboardCustomer = {
    id: 'historical-dashboard-customer', ticket_id: historicalTicket.id, sender_type: 'customer', sender_id: 'recorded-dashboard-customer', body: 'legacy dashboard message', is_internal: false,
    created_at: '2026-09-09T00:00:03.000Z',
  } as Article;
  const unsupportedSender = {
    id: 'unsupported-sender', ticket_id: historicalTicket.id, sender_type: 'untrusted-runtime-value', sender_id: 'must-not-be-attributed', body: 'invalid sender type', is_internal: false,
    created_at: '2026-09-09T00:00:04.000Z',
  } as unknown as Article;

  const projection = projectCanonicalConversation(historicalTicket, [agentInternal, systemWithStoredBodyReference, dashboardCustomer, unsupportedSender]);
  assert.deepEqual(projection.conversation.ticketNumber, { status: 'not-recorded' }, 'Missing ticket number must remain not-recorded');
  assert.deepEqual(projection.conversation.localCorrelation, { status: 'known', value: { ticketId: historicalTicket.id } });
  for (const message of projection.messages) {
    assert.deepEqual(message.source, { status: 'not-recorded' }, 'Historical message must not inherit its ticket intake source');
    assert.equal(message.recipient.kind, 'unknown', 'Agent/system row must not claim tenant support as its recipient');
    assert.equal(message.direction.status, 'unknown', 'Agent/system direction must remain unknown without a trusted channel fact');
    assert.deepEqual(message.state, { persistence: 'persisted' });
    assert.deepEqual(message.content.localReference, { status: 'known', value: message.id }, 'Body reference must stay a safe local article reference');
  }
  assert.equal(projection.messages[0].author.kind, 'recorded-agent');
  assert.equal(projection.messages[0].author.provenance, 'stored-article');
  assert.deepEqual(projection.messages[0].author.id, { status: 'known', value: 'recorded-agent' }, 'Stored agent ID must be preserved without an authentication claim');
  assert.equal(projection.messages[1].author.kind, 'recorded-system');
  assert.equal(projection.messages[1].author.provenance, 'stored-article');
  assert.deepEqual(projection.messages[1].author.id, { status: 'known', value: 'recorded-system' }, 'Stored system ID must be preserved without an authentication claim');
  assert.equal(projection.messages[2].author.kind, 'recorded-customer');
  assert.equal(projection.messages[2].author.provenance, 'stored-article');
  assert.deepEqual(projection.messages[2].author.id, { status: 'known', value: 'recorded-dashboard-customer' });
  assert.equal(projection.messages[3].author.kind, 'unknown', 'Unsupported sender types must not become recorded-system provenance');
  assert.equal(projection.messages[3].author.provenance, 'not-recorded');
  assert.deepEqual(projection.messages[3].author.id, { status: 'unknown' });
  assert.deepEqual(projection.messages[0].delivery, { status: 'not-applicable' }, 'Internal agent note must not claim delivery');
  assert.deepEqual(projection.messages[1].delivery, { status: 'not-recorded' }, 'Public system event must not claim delivery');
  assert.deepEqual(projection.messages[2].delivery, { status: 'not-recorded' }, 'Legacy/dashboard customer event must not claim delivery');
  assert.deepEqual(projection.messages[1].content.body, { status: 'unknown' }, 'Unhydrated R2 body must remain unknown');
  assert.equal(JSON.stringify(projection).includes('tenant-private/body-key'), false, 'Canonical projector must not expose an R2 body key');
});


test('portal and widget author attribution requires the recorded ticket customer', () => {
  const ticket = { id: 'ticket', customer_id: 'customer-a', customer_email: 'tocyn-auth-test-a@example.invalid', source: 'portal' } as Ticket;
  for (const intake_source of ['portal', 'widget'] as const) {
    for (const sender_id of ['customer-a', 'customer-b', undefined]) {
      const article = { id: 'message', ticket_id: ticket.id, sender_type: 'customer', sender_id, intake_source } as Article;
      const author = projectCanonicalConversation(ticket, [article]).messages[0].author;
      assert.equal(author.kind, sender_id === ticket.customer_id ? 'authenticated-customer' : 'recorded-customer');
      assert.deepEqual(author.email, sender_id === ticket.customer_id ? { status: 'known', value: ticket.customer_email } : { status: 'not-recorded' });
      const unowned = projectCanonicalConversation({ ...ticket, customer_id: undefined }, [article]).messages[0].author;
      assert.equal(unowned.provenance, 'stored-article');
      assert.deepEqual(unowned.email, { status: 'not-recorded' });
    }
  }
});
