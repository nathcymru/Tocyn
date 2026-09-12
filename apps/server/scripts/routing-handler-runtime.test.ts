import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeLocalBetaFixture } from './local-beta-fixture';
import { type FixtureResponse, type LocalTenantFixture, withTwoTenantFixture } from './local-tenant-fixture';

type Session = Readonly<{ id: string; token: string }>;

async function status(response: FixtureResponse, expected: number): Promise<FixtureResponse> {
  if (response.status !== expected) assert.fail(`expected ${expected}, received ${response.status}: ${await response.text()}`);
  return response;
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

async function setup(fixture: LocalTenantFixture): Promise<{ operatorA: Session; operatorB: Session; agent: Session }> {
  const operatorA = await operatorSession(fixture, 'operatorA');
  const operatorB = await operatorSession(fixture, 'operatorB');
  const agent = await fixture.createAgentSession(fixture.principals.operatorA.tenantId);
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
    fixture.db.prepare("INSERT INTO operator_routing_profiles (tenant_id,user_id,is_available,assignment_capacity) VALUES ('fixture-tenant-a',?,1,10)").bind(operatorA.id),
    fixture.db.prepare("UPDATE tickets SET group_id='route-group' WHERE tenant_id='fixture-tenant-a' AND id='fixture-ticket'"),
    fixture.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('fixture-tenant-a','wrong-group-ticket','Wrong group','tocyn-auth-test-a@example.invalid','other-group','fixture')"),
  ]);
  await fixture.enableCombinedTicketAdmission();
  return { operatorA, operatorB, agent };
}

test('routing handlers enforce MFA/session/tenant/group boundaries and retry contracts', async () => {
  await withTwoTenantFixture(async fixture => {
    const { operatorA, operatorB, agent } = await setup(fixture);
    const route = (token: string, key: string, ticket = 'fixture-ticket') => fixture.request(`/api/tickets/${ticket}/route`, {
      method: 'POST', token, idempotencyKey: key, body: {},
    });
    const first = await status(await route(operatorA.token, 'route-once'), 200);
    assert.deepEqual(await first.json(), { success: true, responsibleOwnerId: operatorA.id });
    const replay = await status(await route(operatorA.token, 'route-once'), 200);
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(await replay.json(), { success: true, responsibleOwnerId: operatorA.id });
    const conflict = await status(await route(operatorA.token, 'route-once', 'wrong-group-ticket'), 409);
    assert.equal((await conflict.json<{ code: string }>()).code, 'idempotency_conflict');

    await status(await route(operatorB.token, 'foreign-ticket'), 403);
    await status(await route(agent.token, 'agent-wrong-group', 'wrong-group-ticket'), 403);
    const missingKey = await status(await fixture.request('/api/tickets/fixture-ticket/route', { method: 'POST', token: operatorA.token, body: {} }), 400);
    assert.equal((await missingKey.json<{ code: string }>()).code, 'idempotency_key_required');

    const challenge = await status(await fixture.login('operatorA'), 200);
    const challengeToken = (await challenge.json<{ token: string }>()).token;
    await status(await route(challengeToken, 'mfa-challenge'), 401);
    await fixture.revokePrincipalSessions('operatorA');
    await status(await route(operatorA.token, 'revoked-session'), 401);
  });
});

test('routing profile updates are admin-authorized, bounded, tenant-scoped, and enforce zero capacity', async () => {
  await withTwoTenantFixture(async fixture => {
    const { operatorA, operatorB } = await setup(fixture);
    const profilePath = `/api/operators/${operatorA.id}/routing-profile`;
    const updated = await status(await fixture.request(profilePath, { method: 'PUT', token: operatorA.token, body: { available: true, assignmentCapacity: 0 } }), 200);
    const updatedBody = await updated.json<{ available: boolean; assignmentCapacity: number; updatedAt: string }>();
    assert.equal(updatedBody.available, true);
    assert.equal(updatedBody.assignmentCapacity, 0);
    assert.equal(typeof updatedBody.updatedAt, 'string');

    await fixture.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('fixture-tenant-a','zero-capacity-ticket','Zero capacity','tocyn-auth-test-a@example.invalid','route-group','fixture')").run();
    const exhausted = await status(await fixture.request('/api/tickets/zero-capacity-ticket/route', { method: 'POST', token: operatorA.token, idempotencyKey: 'zero-capacity' }), 409);
    assert.equal((await exhausted.json<{ code: string }>()).code, 'routing_no_eligible_operator');

    await status(await fixture.request(profilePath, { method: 'PUT', token: operatorA.token, body: { available: true, assignmentCapacity: -1 } }), 400);
    await status(await fixture.request(`/api/operators/${operatorA.id}/routing-profile`, { method: 'PUT', token: operatorB.token, body: { available: true, assignmentCapacity: 1 } }), 403);
  });
});
