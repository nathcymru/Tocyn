import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type FixturePrincipal, type FixtureResponse, type LocalTenantFixture } from './local-tenant-fixture';
import { initializeLocalBetaFixture } from './local-beta-fixture';

type CredentialSliEvent = {
  version: 1;
  type: 'auth.sli.request';
  scope: 'credential';
  complete: boolean;
  counts: { attempted: number; accepted: number; denied: number; unavailable: number; challenge: number };
};

function tokenFrom(value: unknown): string {
  const token = (value as { token?: unknown }).token;
  if (typeof token !== 'string' || token.length === 0) throw new Error('Expected a route-issued token');
  return token;
}

async function expectStatus(response: FixtureResponse, expected: number, reason: string): Promise<void> {
  if (response.status === expected) return;
  await response.body?.cancel();
  assert.fail(`${reason}: received ${response.status}`);
}

async function captureCredentialSli<T>(run: () => Promise<T>): Promise<{ result: T; events: CredentialSliEvent[] }> {
  const events: CredentialSliEvent[] = [];
  const log = console.log;
  console.log = (value?: unknown) => {
    if (typeof value !== 'string') return;
    try {
      const event = JSON.parse(value) as { type?: unknown };
      if (event.type === 'auth.sli.request') events.push(event as CredentialSliEvent);
    } catch { /* Other diagnostics are outside this bounded assertion. */ }
  };
  try { return { result: await run(), events }; }
  finally { console.log = log; }
}

function unsignedTenantClaimTamper(token: string, tenantId: string): string {
  const [header, encodedPayload, signature, ...extra] = token.split('.');
  assert.equal(extra.length, 0, 'Route-issued JWT must have three segments');
  assert.ok(header && encodedPayload && signature, 'Route-issued JWT must have three segments');
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
  payload.tenant_id = tenantId;
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
}

async function customerWidgetToken(fixture: LocalTenantFixture, principal: FixturePrincipal): Promise<string> {
  const requestIp = `${fixture.rateLimitIdentity}-customer-${principal.name}`;
  await expectStatus(await fixture.request('/api/v1/customer/auth/request', {
    method: 'POST', ip: requestIp,
    body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey },
  }), 200, 'Customer auth request must accept its selected widget key');
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const message = messages.find(candidate => candidate.to === principal.email);
  assert.ok(message?.loginLink, 'Local capture must retain the selected customer message');
  const link = new URL(message.loginLink);
  assert.equal(link.origin, 'http://localhost:5174');
  assert.equal(link.pathname, '/verify');
  assert.equal(link.searchParams.get('key'), principal.widgetKey);
  const token = link.searchParams.get('token');
  assert.ok(token && /^[0-9a-f]{64}$/.test(token), 'Customer link must contain an opaque token');
  const response = await fixture.request('/api/v1/customer/auth/verify', {
    method: 'POST', ip: requestIp, body: { token, widgetKey: principal.widgetKey },
  });
  await expectStatus(response, 200, 'Customer link must verify with its selected widget key');
  return tokenFrom(await response.json());
}

async function operatorAppToken(fixture: LocalTenantFixture, operator: 'operatorA' | 'operatorB'): Promise<{ token: string; challenge: string }> {
  const challenge = await (await fixture.login(operator)).json<{ mfa_required?: boolean; token?: string }>();
  assert.equal(challenge.mfa_required, true, 'Synthetic operator must require MFA');
  assert.equal(typeof challenge.token, 'string');
  const verified = await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) },
  });
  await expectStatus(verified, 200, 'Current operator MFA code must verify');
  return { token: tokenFrom(await verified.json()), challenge: challenge.token! };
}

test('two issued tenant identities stay scoped across API and customer portal routes', async () => {
  await withTwoTenantFixture(async fixture => {
    const customerAAppToken = tokenFrom(await (await fixture.login('customerA')).json());
    const customerBAppToken = tokenFrom(await (await fixture.login('customerB')).json());
    assert.equal(await fixture.tokenTenant(customerAAppToken), fixture.principals.customerA.tenantId);
    assert.equal(await fixture.tokenTenant(customerBAppToken), fixture.principals.customerB.tenantId);

    const { token: operatorAToken, challenge: operatorAChallenge } = await operatorAppToken(fixture, 'operatorA');
    await expectStatus(await fixture.request('/api/auth/me', { token: operatorAChallenge }), 401,
      'MFA challenge token must not authorize an app route');
    await expectStatus(await fixture.request('/api/v1/customer/tickets', { token: customerAAppToken }), 401,
      'App-audience customer token must not authorize a widget route');
    await expectStatus(await fixture.request('/api/auth/me', {
      token: unsignedTenantClaimTamper(customerAAppToken, fixture.principals.customerB.tenantId),
    }), 401, 'Unsigned tenant-claim tampering must be rejected');

    const customerAWidgetToken = await customerWidgetToken(fixture, fixture.principals.customerA);
    const customerBWidgetToken = await customerWidgetToken(fixture, fixture.principals.customerB);
    assert.equal(await fixture.widgetTokenTenant(customerAWidgetToken), fixture.principals.customerA.tenantId);
    assert.equal(await fixture.widgetTokenTenant(customerBWidgetToken), fixture.principals.customerB.tenantId);
    await expectStatus(await fixture.request('/api/auth/me', { token: customerAWidgetToken }), 401,
      'Widget-audience token must not authorize an app route');

    await fixture.db.prepare('INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)')
      .bind(fixture.principals.customerA.tenantId, 'widget.title', 'Tenant A support').run();
    await fixture.db.prepare('INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)')
      .bind(fixture.principals.customerB.tenantId, 'widget.title', 'Tenant B support').run();
    const configA = await (await fixture.request(`/api/v1/widget/config?key=${encodeURIComponent(fixture.principals.customerA.widgetKey)}&tenant_id=${fixture.principals.customerB.tenantId}`)).json<{ title: string; portalUrl: string }>();
    const configB = await (await fixture.request(`/api/v1/widget/config?key=${encodeURIComponent(fixture.principals.customerB.widgetKey)}`)).json<{ title: string; portalUrl: string }>();
    assert.equal(configA.title, 'Tenant A support');
    assert.equal(configB.title, 'Tenant B support');
    assert.ok(configA.portalUrl.includes(encodeURIComponent(fixture.principals.customerA.widgetKey)));

    const writeA = await fixture.createScopedApiKey('operatorA', ['tickets:read', 'tickets:write']);
    const writeB = await fixture.createScopedApiKey('operatorB', ['tickets:read', 'tickets:write']);
    const readOnlyA = await fixture.createScopedApiKey('operatorA', ['tickets:read']);
    const ticketA = await (await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: writeA.apiKey })).json<{ subject: string }>();
    const ticketB = await (await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: writeB.apiKey })).json<{ subject: string }>();
    assert.equal(ticketA.subject, 'Fixture ticket A');
    assert.equal(ticketB.subject, 'Fixture ticket B');
    await expectStatus(await fixture.request('/api/v1/tickets/fixture-b-only', { apiKey: writeA.apiKey }), 404,
      'A API key must not resolve B-only ticket');

    const ticketsBeforeDeniedWrite = await fixture.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>();
    await expectStatus(await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: readOnlyA.apiKey,
      body: { subject: 'denied write', customer_email: fixture.principals.customerA.email },
    }), 403, 'Read-only key must not create a ticket');
    const ticketsAfterDeniedWrite = await fixture.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>();
    assert.equal(ticketsAfterDeniedWrite?.count, ticketsBeforeDeniedWrite?.count, 'Denied API-key write must leave D1 unchanged');

    const createdA = await (await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: writeA.apiKey,
      body: {
        subject: 'A scoped ticket', customer_email: fixture.principals.customerA.email, body: 'A route-created message',
        tenant_id: fixture.principals.customerB.tenantId,
      },
    })).json<{ id: string }>();
    const createdARow = await fixture.db.prepare('SELECT tenant_id FROM tickets WHERE id = ?').bind(createdA.id).first<{ tenant_id: string }>();
    assert.equal(createdARow?.tenant_id, fixture.principals.customerA.tenantId, 'Body tenant selector must not override API-key scope');
    await expectStatus(await fixture.request('/api/v1/tickets/fixture-b-only', {
      method: 'PATCH', apiKey: writeA.apiKey, body: { status: 'closed' },
    }), 404, 'A API key must not update B-only ticket');
    const bTicketAfterForeignUpdate = await fixture.db.prepare('SELECT status FROM tickets WHERE tenant_id = ? AND id = ?')
      .bind(fixture.principals.customerB.tenantId, 'fixture-b-only').first<{ status: string }>();
    assert.equal(bTicketAfterForeignUpdate?.status, 'open', 'Foreign API-key update must leave B ticket unchanged');

    await expectStatus(await fixture.request('/api/v1/tickets/fixture-ticket/articles', {
      method: 'POST', apiKey: writeA.apiKey, body: { body: 'Internal A-only note', is_internal: true },
    }), 201, 'A write key may create its own internal note');
    await expectStatus(await fixture.request('/api/v1/tickets/fixture-ticket/articles', {
      method: 'POST', apiKey: writeA.apiKey, body: { body: 'Visible A customer reply', is_internal: false },
    }), 201, 'A write key may create its own external article');

    const customerAList = await (await fixture.request('/api/v1/customer/tickets', { token: customerAWidgetToken })).json<{ data: Array<{ id: string }> }>();
    const customerBList = await (await fixture.request('/api/v1/customer/tickets', { token: customerBWidgetToken })).json<{ data: Array<{ id: string }> }>();
    assert.ok(customerAList.data.some(ticket => ticket.id === 'fixture-ticket'));
    assert.equal(customerAList.data.some(ticket => ticket.id === 'fixture-b-only'), false, 'Customer A list must exclude B ticket');
    assert.ok(customerBList.data.some(ticket => ticket.id === 'fixture-b-only'));

    const customerADetail = await (await fixture.request('/api/v1/customer/tickets/fixture-ticket', { token: customerAWidgetToken }))
      .json<{ ticket: { subject: string }; articles: Array<{ body: string }> }>();
    assert.equal(customerADetail.ticket.subject, 'Fixture ticket A');
    assert.ok(customerADetail.articles.some(article => article.body === 'Visible A customer reply'));
    assert.equal(customerADetail.articles.some(article => article.body === 'Internal A-only note'), false,
      'Portal response must hide internal articles');
    await expectStatus(await fixture.request('/api/v1/customer/tickets/fixture-b-only', { token: customerAWidgetToken }), 404,
      'Customer A must not read B ticket by identifier');
    const articleCountBeforeForeignMessage = await fixture.db.prepare('SELECT count(*) AS count FROM articles').first<{ count: number }>();
    await expectStatus(await fixture.request('/api/v1/customer/tickets/fixture-b-only/messages', {
      method: 'POST', token: customerAWidgetToken, body: { message: 'foreign message' },
    }), 404, 'Customer A must not write B ticket by identifier');
    const articleCountAfterForeignMessage = await fixture.db.prepare('SELECT count(*) AS count FROM articles').first<{ count: number }>();
    assert.equal(articleCountAfterForeignMessage?.count, articleCountBeforeForeignMessage?.count,
      'Foreign customer message must leave D1 unchanged');

    await fixture.revokePrincipalSessions('customerA');
    await expectStatus(await fixture.request('/api/auth/me', { token: customerAAppToken }), 401,
      'A session revocation must deny the stale A app token');
    await expectStatus(await fixture.request('/api/v1/customer/tickets', { token: customerAWidgetToken }), 401,
      'A session revocation must deny the stale A widget token');
    await expectStatus(await fixture.request('/api/auth/me', { token: customerBAppToken }), 200,
      'A session revocation must not invalidate B identity');

    await assert.rejects(
      fixture.db.prepare('INSERT INTO users (tenant_id, id, email, role) VALUES (?, ?, ?, ?)')
        .bind(fixture.principals.customerB.tenantId, 'same-canonical-email', ` ${fixture.principals.customerA.email.toUpperCase()} `, 'customer').run(),
      /UNIQUE constraint failed|SQLITE_CONSTRAINT/,
      'Canonical same-email membership must remain unsupported and rejected',
    );

    await expectStatus(await fixture.request(`/api/api-keys/${writeA.id}`, { method: 'DELETE', token: operatorAToken }), 200,
      'Owning operator may revoke its own integration key');
    await expectStatus(await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: writeA.apiKey }), 401,
      'Revoked integration key must deny access');
  });
});

test('credential SLI records current API-key and widget decisions without treating a foreign resource denial as failed authentication', async () => {
  await withTwoTenantFixture(async fixture => {
    const keyA = await fixture.createScopedApiKey('operatorA', ['tickets:read']);
    const keyB = await fixture.createScopedApiKey('operatorB', ['tickets:read']);
    await initializeLocalBetaFixture(fixture, {
      runId: 'credential-sli-evidence',
      tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      invitations: [
        ...Object.values(fixture.principals).map(principal => ({
          tenantId: principal.tenantId, id: principal.localId,
          kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
        })),
        { tenantId: fixture.principals.customerA.tenantId, id: keyA.id, kind: 'api-key' as const },
        { tenantId: fixture.principals.customerB.tenantId, id: keyB.id, kind: 'api-key' as const },
      ],
    });
    const widgetA = await customerWidgetToken(fixture, fixture.principals.customerA);
    fixture.enableIsolatedObservability();
    const privateValue = 'synthetic-credential-sli-private-value';
    const captured = await captureCredentialSli(async () => {
      await expectStatus(await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: keyA.apiKey }), 200, 'Current API key accepts tenant A');
      await expectStatus(await fixture.request('/api/v1/customer/tickets/fixture-b-only', { token: widgetA }), 404, 'Current tenant A widget credential cannot read tenant B resource');
      await fixture.db.prepare('UPDATE api_keys SET is_active = 0 WHERE tenant_id = ? AND id = ?')
        .bind(fixture.principals.customerA.tenantId, keyA.id).run();
      await expectStatus(await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: keyA.apiKey }), 401, 'Revoked API key is denied');
      await fixture.revokePrincipalSessions('customerA');
      await expectStatus(await fixture.request('/api/v1/customer/tickets', { token: widgetA }), 401, 'Revoked widget session is denied');
      return privateValue;
    });
    assert.equal(captured.result, privateValue);
    assert.deepEqual(captured.events, [
      { version: 1, type: 'auth.sli.request', scope: 'credential', complete: true,
        counts: { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 } },
      { version: 1, type: 'auth.sli.request', scope: 'credential', complete: true,
        counts: { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 } },
      { version: 1, type: 'auth.sli.request', scope: 'credential', complete: true,
        counts: { attempted: 1, accepted: 0, denied: 1, unavailable: 0, challenge: 0 } },
      { version: 1, type: 'auth.sli.request', scope: 'credential', complete: true,
        counts: { attempted: 1, accepted: 0, denied: 1, unavailable: 0, challenge: 0 } },
    ]);
    assert.equal(JSON.stringify(captured.events).includes(privateValue), false, 'Credential summaries omit request content');
    assert.equal(JSON.stringify(captured.events).includes(fixture.principals.customerA.tenantId), false, 'Credential summaries omit tenant IDs');

    const log = console.log;
    console.log = (value?: unknown) => {
      if (typeof value === 'string' && JSON.parse(value).type === 'auth.sli.request') throw new Error('synthetic observer fault');
    };
    try {
      await expectStatus(await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: keyB.apiKey }), 200, 'Observer failure cannot reject an accepted API credential');
    } finally { console.log = log; }
  });
});

test('credential SLI observes password step-up, MFA completion, revoked challenge, and opaque customer verification without treating an auth request acknowledgement as acceptance', async () => {
  await withTwoTenantFixture(async fixture => {
    await initializeLocalBetaFixture(fixture, {
      runId: 'credential-sli-password-mfa-evidence',
      tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      invitations: Object.values(fixture.principals).map(principal => ({
        tenantId: principal.tenantId,
        id: principal.localId,
        kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
      })),
    });
    fixture.enableIsolatedObservability();
    const captured = await captureCredentialSli(async () => {
      const operator = await operatorAppToken(fixture, 'operatorA');
      await fixture.revokePrincipalSessions('operatorA');
      await expectStatus(await fixture.request('/api/auth/mfa/verify', {
        method: 'POST', token: operator.challenge, body: { code: fixture.currentMfaCode('operatorA') },
      }), 401, 'Revoked MFA challenge must not complete authentication');
      return customerWidgetToken(fixture, fixture.principals.customerB);
    });
    assert.equal(typeof captured.result, 'string');
    assert.deepEqual(captured.events, [
      { version: 1, type: 'auth.sli.request', scope: 'credential', complete: true,
        counts: { attempted: 1, accepted: 0, denied: 0, unavailable: 0, challenge: 1 } },
      { version: 1, type: 'auth.sli.request', scope: 'credential', complete: true,
        counts: { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 } },
      { version: 1, type: 'auth.sli.request', scope: 'credential', complete: true,
        counts: { attempted: 1, accepted: 0, denied: 1, unavailable: 0, challenge: 0 } },
      { version: 1, type: 'auth.sli.request', scope: 'credential', complete: true,
        counts: { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 } },
    ]);
    assert.equal(captured.events.length, 4, 'Customer auth request acknowledgement emits no credential decision');
    assert.equal(JSON.stringify(captured.events).includes(fixture.principals.customerB.tenantId), false, 'Credential summaries omit tenant IDs');
  });
});

test('durable operator drafts and workspace state remain per-tenant, revision-bound, and session-scoped', async () => {
  await withTwoTenantFixture(async fixture => {
    const { token: operatorA } = await operatorAppToken(fixture, 'operatorA');
    const { token: operatorB } = await operatorAppToken(fixture, 'operatorB');
    const attachmentKey = 'agent-attachments/fixture-operator/draft.txt';
    await fixture.r2.bucket.put(`${fixture.principals.operatorA.tenantId}/${attachmentKey}`, 'draft attachment', {
      httpMetadata: { contentType: 'text/plain' },
    });
    const draft = {
      expectedGeneration: null, expectedRevision: 0, mode: 'internal', body: 'synthetic A-only draft',
      attachments: [{ storageKey: attachmentKey, filename: 'draft.txt' }],
    };
    const created = await fixture.request('/api/workspace/drafts/fixture-ticket', { method: 'PUT', token: operatorA, body: draft });
    await expectStatus(created, 200, 'A may persist its own scoped draft');
    assert.equal(created.headers.get('cache-control'), 'private, no-store');
    const createdBody = await created.json<{ generation: string; revision: number; body: string; attachments: Array<{ storageKey: string }>; baseConversationRevision: number }>();
    assert.equal(createdBody.revision, 1);
    assert.equal(createdBody.body, draft.body);
    assert.deepEqual(createdBody.attachments, [{ storageKey: attachmentKey, filename: 'draft.txt', size: 16, contentType: 'text/plain' }]);
    assert.equal(createdBody.baseConversationRevision, 0, 'No canonical event must not be misrepresented as an unchanged conversation');

    const draftList = await fixture.request('/api/workspace/drafts?limit=1', { token: operatorA });
    await expectStatus(draftList, 200, 'A may list its scoped draft indicators');
    assert.equal(draftList.headers.get('cache-control'), 'private, no-store');
    const page = await draftList.json<{ items: Array<{ ticketId: string; updatedAt: string }>; next: string | null }>();
    assert.equal(page.items[0].ticketId, 'fixture-ticket');
    assert.deepEqual(Object.keys(page.items[0]).sort(), ['ticketId', 'updatedAt']);
    assert.equal(page.next, null);
    const otherDrafts = await fixture.request('/api/workspace/drafts', { token: operatorB });
    assert.deepEqual(await otherDrafts.json(), { items: [], next: null });
    await expectStatus(await fixture.request('/api/workspace/drafts?limit=51', { token: operatorA }), 400, 'Draft pages are bounded');
    await expectStatus(await fixture.request('/api/workspace/drafts'), 401, 'Draft indicators require authentication');

    await fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES (?,?,?,?,?)')
      .bind(fixture.principals.operatorA.tenantId, 'sequenced-ticket', 'Sequenced ticket', fixture.principals.customerA.email, 'dashboard').run();
    await fixture.db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
      fixture.principals.operatorA.tenantId, 'sequence-seven', 'sequenced-ticket', 7, 'message.reply', 'staff',
      fixture.principals.operatorA.localId, 'mfa-staff', 'dashboard', 'public', '{}',
    ).run();
    const sequenced = await fixture.request('/api/workspace/drafts/sequenced-ticket', {
      method: 'PUT', token: operatorA, body: { expectedGeneration: null, expectedRevision: 0, mode: 'public', body: 'derived revision', attachments: [] },
    });
    await expectStatus(sequenced, 200, 'Draft save derives its base revision from the canonical event sequence');
    const sequencedBody = await sequenced.json<{ generation: string; baseConversationRevision: number }>();
    assert.equal(sequencedBody.baseConversationRevision, 7);
    await fixture.db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
      fixture.principals.operatorA.tenantId, 'sequence-eight', 'sequenced-ticket', 8, 'message.reply', 'customer',
      fixture.principals.customerA.localId, 'authenticated-customer', 'portal', 'public', '{}',
    ).run();
    const autosaved = await fixture.request('/api/workspace/drafts/sequenced-ticket', {
      method: 'PUT', token: operatorA,
      body: { expectedGeneration: sequencedBody.generation, expectedRevision: 1, mode: 'public', body: 'derived revision updated', attachments: [] },
    });
    await expectStatus(autosaved, 200, 'Autosave may advance a matching draft revision');
    assert.equal((await autosaved.json<{ baseConversationRevision: number }>()).baseConversationRevision, 7, 'Autosave preserves the original collision base');
    await expectStatus(await fixture.request('/api/workspace/drafts/sequenced-ticket', {
      method: 'PUT', token: operatorA,
      body: { expectedGeneration: sequencedBody.generation, expectedRevision: 2, mode: 'public', body: 'forged revision', attachments: [], baseConversationRevision: 999 },
    }), 400, 'Client-supplied canonical revision cannot override the server-derived value');

    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-b-only', { token: operatorA }), 404,
      'A cannot restore B-only ticket work');
    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', { token: operatorB }), 204,
      'B cannot observe A draft despite an identically named tenant-local ticket');
    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorB, body: { ...draft, body: 'synthetic B-only draft', attachments: [] },
    }), 200, 'B owns a distinct draft for its tenant-local ticket');

    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorA, body: draft,
    }), 409, 'An old draft revision cannot overwrite a saved draft');
    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorA,
      body: { ...draft, expectedGeneration: createdBody.generation, expectedRevision: 1, attachments: [{ storageKey: 'agent-attachments/other-operator/forged.txt', filename: 'forged.txt' }] },
    }), 400, 'A foreign attachment reference cannot be bound into an existing draft');
    const updated = await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorA, body: { ...draft, expectedGeneration: createdBody.generation, expectedRevision: 1, body: 'synthetic A revision two', attachments: [] },
    });
    await expectStatus(updated, 200, 'Matching revision updates a draft');
    const updatedBody = await updated.json<{ generation: string; revision: number }>();
    assert.equal(updatedBody.revision, 2);
    await expectStatus(await fixture.request(`/api/workspace/drafts/fixture-ticket?generation=${updatedBody.generation}&revision=1`, { method: 'DELETE', token: operatorA }), 409,
      'Confirmed-send cleanup cannot remove a newer draft revision');
    await expectStatus(await fixture.request(`/api/workspace/drafts/fixture-ticket?generation=${updatedBody.generation}&revision=2`, { method: 'DELETE', token: operatorA }), 204,
      'Matching version permits explicit discard');
    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorA, body: { ...draft, expectedGeneration: updatedBody.generation, expectedRevision: 2, body: 'stale save', attachments: [] },
    }), 409, 'A stale save after deletion cannot create a replacement draft');
    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', { token: operatorA }), 204,
      'Rejected stale save leaves no replacement draft');
    const recreated = await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorA, body: { ...draft, expectedGeneration: null, expectedRevision: 0, body: 'recreated draft', attachments: [] },
    });
    await expectStatus(recreated, 200, 'A deleted draft can be recreated as a new generation');
    const recreatedBody = await recreated.json<{ generation: string; revision: number }>();
    assert.notEqual(recreatedBody.generation, updatedBody.generation);
    await expectStatus(await fixture.request(`/api/workspace/drafts/fixture-ticket?generation=${updatedBody.generation}&revision=2`, { method: 'DELETE', token: operatorA }), 409,
      'Delayed cleanup for an old generation cannot delete a recreated draft');
    const retained = await fixture.request('/api/workspace/drafts/fixture-ticket', { token: operatorA });
    await expectStatus(retained, 200, 'Mismatched cleanup retains the current draft');
    assert.equal((await retained.json<{ body: string }>()).body, 'recreated draft');

    const state = {
      expectedRevision: 0, view: 'custom', sort: 'updated_desc', filters: {},
      listQuery: 'synthetic current-view query', listAnchor: 'opaque-anchor-1', selectedTicketId: 'fixture-ticket', panel: 'details',
    };
    const stateA = await fixture.request('/api/workspace/state', { method: 'PUT', token: operatorA, body: state });
    await expectStatus(stateA, 200, 'A may persist server-scoped workspace continuity');
    const storedState = await stateA.json<{ revision: number; view: string; sort: string; filters: unknown; listQuery: string; listAnchor: string; selectedTicketId: string | null; panel: string; updatedAt: string }>();
    assert.equal(storedState.revision, 1);
    assert.equal(storedState.view, 'custom');
    assert.equal(storedState.sort, 'updated_desc');
    assert.deepEqual(storedState.filters, {});
    assert.equal(storedState.listQuery, 'synthetic current-view query');
    assert.equal(storedState.listAnchor, 'opaque-anchor-1');
    assert.equal(storedState.selectedTicketId, 'fixture-ticket');
    assert.equal(storedState.panel, 'details');
    assert.match(storedState.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    const stateUpdate = await fixture.request('/api/workspace/state', {
      method: 'PUT', token: operatorA, body: { ...state, expectedRevision: 1, listAnchor: 'opaque-anchor-2' },
    });
    await expectStatus(stateUpdate, 200, 'A matching workspace revision updates state');
    assert.equal((await stateUpdate.json<{ revision: number; listAnchor: string }>()).revision, 2);
    const races = await Promise.all(['opaque-anchor-3a', 'opaque-anchor-3b'].map(listAnchor =>
      fixture.request('/api/workspace/state', { method: 'PUT', token: operatorA, body: { ...state, expectedRevision: 2, listAnchor } }),
    ));
    assert.deepEqual(races.map(response => response.status).sort(), [200, 409], 'Only one same-revision workspace save may commit');
    await expectStatus(await fixture.request('/api/workspace/state', { method: 'PUT', token: operatorA, rawBody: '{', contentType: 'application/json' }), 400,
      'Malformed workspace JSON is a client error');
    await expectStatus(await fixture.request('/api/workspace/state', { method: 'PUT', token: operatorA, rawBody: 'x'.repeat(64 * 1024 + 1), contentType: 'application/json' }), 413,
      'Oversized workspace bodies are rejected before parsing');
    const stateB = await fixture.request('/api/workspace/state', { token: operatorB });
    await expectStatus(stateB, 200, 'B may read only its own workspace state');
    assert.equal(await stateB.json(), null, 'B cannot observe A workspace continuity');

    await fixture.revokePrincipalSessions('operatorA');
    await expectStatus(await fixture.request('/api/workspace/drafts', { token: operatorA }), 401, 'Revoked sessions cannot list draft indicators');
    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', { token: operatorA }), 401,
      'Revoked A session cannot restore its prior draft');
    await expectStatus(await fixture.request('/api/workspace/state', { token: operatorA }), 401,
      'Revoked A session cannot restore its prior workspace state');
    await expectStatus(await fixture.request('/api/workspace/drafts/fixture-ticket', { token: operatorB }), 200,
      'A revocation does not disturb B work');
  });
});
