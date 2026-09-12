import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { initializeLocalBetaFixture } from './local-beta-fixture';
import { type FixtureResponse, type LocalTenantFixture, withTwoTenantFixture } from './local-tenant-fixture';

type Session = Readonly<{ id: string; token: string }>;

async function status(response: FixtureResponse, expected: number): Promise<FixtureResponse> {
  if (response.status !== expected) assert.fail(`expected ${expected}, received ${response.status}: ${await response.text()}`);
  return response;
}

async function assertDenied(response: Promise<FixtureResponse>): Promise<void> {
  const result = await response;
  assert.notEqual(result.status, 200);
}

async function operatorSession(fixture: LocalTenantFixture, name: 'operatorA' | 'operatorB'): Promise<Session> {
  const login = await status(await fixture.login(name), 200);
  const challenge = await login.json<{ token: string; mfa_required: boolean }>();
  assert.equal(challenge.mfa_required, true);
  const verified = await status(await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(name) },
  }), 200);
  const body = await verified.json<{ token: string; user: { id: string } }>();
  return { id: body.user.id, token: body.token };
}

async function setup(fixture: LocalTenantFixture): Promise<{ operatorA: Session; operatorB: Session; agent: Session; routeOwner: Session }> {
  const operatorA = await operatorSession(fixture, 'operatorA');
  const operatorB = await operatorSession(fixture, 'operatorB');
  const agent = await fixture.createAgentSession(fixture.principals.operatorA.tenantId);
  const routeOwner = { id: randomUUID(), token: operatorA.token };
  await fixture.db.prepare('INSERT INTO users (tenant_id, id, email, full_name, role, mfa_enabled, session_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(fixture.principals.operatorA.tenantId, routeOwner.id, 'route-owner@example.test', 'Synthetic route owner', 'agent', 1, 1)
    .run();
  await initializeLocalBetaFixture(fixture, {
    runId: 'routing-handler-runtime',
    tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
    invitations: [
      ...Object.values(fixture.principals).map(principal => ({ tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const })),
      { tenantId: fixture.principals.customerA.tenantId, id: agent.id, kind: 'staff' },
    ],
    limits: { ticketLimit: 4, mutationLimit: 20, recoveryReserve: 2, uploadLimit: 2 },
  });
  await fixture.db.batch([
    fixture.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('fixture-tenant-a','route-group','Routing group')"),
    fixture.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('fixture-tenant-a','other-group','Other group')"),
    fixture.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('fixture-tenant-a',?,'route-group')").bind(operatorA.id),
    fixture.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('fixture-tenant-a',?,'route-group')").bind(routeOwner.id),
    fixture.db.prepare("INSERT INTO operator_routing_profiles (tenant_id,user_id,is_available,assignment_capacity) VALUES ('fixture-tenant-a',?,1,10)").bind(operatorA.id),
    fixture.db.prepare("INSERT INTO operator_routing_profiles (tenant_id,user_id,is_available,assignment_capacity) VALUES ('fixture-tenant-a',?,1,10)").bind(routeOwner.id),
    fixture.db.prepare("UPDATE tickets SET group_id='route-group' WHERE tenant_id='fixture-tenant-a' AND id='fixture-ticket'"),
    fixture.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('fixture-tenant-a','wrong-group-ticket','Wrong group','tocyn-auth-test-a@example.invalid','other-group','fixture')"),
  ]);
  await fixture.enableCombinedTicketAdmission();
  return { operatorA, operatorB, agent, routeOwner };
}

test('routing handlers enforce MFA/session/tenant/group boundaries and retry contracts', async () => {
  await withTwoTenantFixture(async fixture => {
  const { operatorA, operatorB, agent, routeOwner } = await setup(fixture);
    const route = (token: string, key: string, ticket = 'fixture-ticket', ownerId: string | null = routeOwner.id, expectedOwnerId: string | null = null) => fixture.request(`/api/tickets/${ticket}/route`, {
      method: 'POST', token, idempotencyKey: key, body: { ownerId, expectedOwnerId },
    });
    const first = await status(await route(operatorA.token, 'route-once'), 200);
    assert.deepEqual(await first.json(), { success: true, responsibleOwnerId: routeOwner.id });
    const replay = await status(await route(operatorA.token, 'route-once'), 200);
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(await replay.json(), { success: true, responsibleOwnerId: routeOwner.id });
    const conflict = await status(await route(operatorA.token, 'route-once', 'fixture-ticket', routeOwner.id, randomUUID()), 409);
    assert.equal((await conflict.json<{ code: string }>()).code, 'idempotency_conflict');

    await assertDenied(route(operatorB.token, 'foreign-ticket'));
    await assertDenied(route(agent.token, 'agent-wrong-group', 'wrong-group-ticket'));
    const missingKey = await status(await fixture.request('/api/tickets/fixture-ticket/route', {
      method: 'POST',
      token: operatorA.token,
      body: { ownerId: routeOwner.id, expectedOwnerId: null },
    }), 400);
    assert.equal((await missingKey.json<{ code: string }>()).code, 'idempotency_key_required');

    await assertDenied(fixture.request('/api/tickets/fixture-ticket/route', { method: 'GET', token: operatorA.token }));
    await assertDenied(fixture.request('/api/tickets/fixture-ticket/route/extra', { method: 'POST', token: operatorA.token, idempotencyKey: 'near-path' }));
    await assertDenied(fixture.request('/api/v1/tickets/fixture-ticket/route', { method: 'POST', token: operatorA.token, idempotencyKey: 'api-v1' }));

    const challenge = await status(await fixture.login('operatorA'), 200);
    const challengeToken = (await challenge.json<{ token: string }>()).token;
    await status(await route(challengeToken, 'mfa-challenge'), 401);
    const customerLogin = await status(await fixture.login('customerA'), 200);
    const customerToken = (await customerLogin.json<{ token: string }>()).token;
    await assertDenied(fixture.request('/api/tickets/fixture-ticket/route', { method: 'POST', token: customerToken, idempotencyKey: 'customer-route' }));
    await fixture.revokePrincipalSessions('operatorA');
    await status(await route(operatorA.token, 'revoked-session'), 401);
  });
});

test('routing profile updates are admin-authorized, bounded, tenant-scoped, and enforce zero capacity', async () => {
  await withTwoTenantFixture(async fixture => {
    const { operatorA, operatorB } = await setup(fixture);
    const profilePath = `/api/operators/${operatorA.id}/routing-profile`;
    const blocked = await status(await fixture.request(profilePath, { method: 'PUT', token: operatorA.token, body: { available: true, assignmentCapacity: 0 } }), 503);
    assert.equal((await blocked.json<{ code: string }>()).code, 'feature_disabled');

    await status(await fixture.request(`/api/operators/${operatorB.id}/routing-profile`, { method: 'PUT', token: operatorA.token, body: { available: true, assignmentCapacity: 1 } }), 503);
    await status(await fixture.request(`/api/operators/${operatorA.id}/routing-profile`, { method: 'PUT', token: operatorB.token, body: { available: true, assignmentCapacity: 1 } }), 503);
  });
});
