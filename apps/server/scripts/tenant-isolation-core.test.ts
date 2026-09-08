import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type FixturePrincipal, type FixtureResponse, type LocalTenantFixture } from './local-tenant-fixture';

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
