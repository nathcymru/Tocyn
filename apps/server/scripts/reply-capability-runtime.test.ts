import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type FixtureResponse, type LocalTenantFixture } from './local-tenant-fixture';

async function expectStatus(response: FixtureResponse, expected: number, reason: string): Promise<void> {
  if (response.status === expected) return;
  await response.body?.cancel();
  assert.fail(`${reason}: received ${response.status}`);
}

async function operatorToken(fixture: LocalTenantFixture, operator: 'operatorA' | 'operatorB'): Promise<string> {
  const challenge = await (await fixture.login(operator)).json<{ token?: string; mfa_required?: boolean }>();
  assert.equal(challenge.mfa_required, true, 'Fixture operator must require MFA');
  assert.equal(typeof challenge.token, 'string');
  const verified = await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) },
  });
  await expectStatus(verified, 200, 'Current MFA must mint the dashboard session');
  const body = await verified.json<{ token?: string }>();
  assert.equal(typeof body.token, 'string');
  return body.token!;
}

async function initializeLocalBeta(fixture: LocalTenantFixture): Promise<void> {
  await fixture.db.batch([
    fixture.db.prepare("INSERT INTO local_beta_runs(run_id,ticket_limit,mutation_limit,recovery_reserve,upload_limit) VALUES ('reply-contract',2,4,2,2)"),
    ...['fixture-tenant-a', 'fixture-tenant-b'].map(tenantId => fixture.db.prepare("INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES ('reply-contract',?)").bind(tenantId)),
    ...Object.values(fixture.principals).map(principal => fixture.db.prepare("INSERT INTO local_beta_invitations(run_id,tenant_id,principal_kind,principal_id) VALUES ('reply-contract',?,?,?)")
      .bind(principal.tenantId, principal.role === 'customer' ? 'customer' : 'staff', principal.localId)),
    fixture.db.prepare("INSERT INTO local_beta_policy(singleton,run_id,revision,state) VALUES(1,'reply-contract',1,'running')"),
  ]);
}

test('reply capability remains tenant-, session-, MFA-, and group-fenced in the real two-tenant runtime', async t => {
  await withTwoTenantFixture(async fixture => {
    const adminA = await operatorToken(fixture, 'operatorA');
    const adminB = await operatorToken(fixture, 'operatorB');
    const customerA = (await (await fixture.login('customerA')).json<{ token: string }>()).token;

    const initial = await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: adminA });
    await expectStatus(initial, 200, 'Current tenant admin may read the contract');
    const capability = await initial.json<{ ticketId: string; modes: Array<{ body: { format: string }; recipient: unknown; delivery: string }> }>();
    assert.equal(capability.ticketId, 'fixture-ticket');
    assert.deepEqual(capability.modes.map(mode => mode.body.format), ['stored_text', 'stored_text']);
    assert.ok(capability.modes.every(mode => mode.body.format !== 'markdown'), 'The contract must not claim Markdown acceptance');
    assert.deepEqual(capability.modes.map(mode => mode.recipient), ['ticket_customer', null]);
    assert.deepEqual(capability.modes.map(mode => mode.delivery), ['email_attempted', 'recorded_only']);

    await expectStatus(await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: customerA }), 403,
      'Customer sessions cannot read dashboard reply capabilities');
    await expectStatus(await fixture.request('/api/tickets/fixture-b-only/reply-capability', { token: adminA }), 404,
      'Tenant A cannot discover a B-only ticket capability');
    await expectStatus(await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: adminB }), 200,
      'Colliding local ticket identifiers resolve only inside the authenticated tenant');

    const agent = await fixture.createAgentSession(fixture.principals.operatorA.tenantId);
    const noMfaAgent = await fixture.createAgentSession(fixture.principals.operatorA.tenantId, false);
    await fixture.db.batch([
      fixture.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES (?, 'reply-group', 'Reply group')").bind(fixture.principals.operatorA.tenantId),
      fixture.db.prepare("UPDATE tickets SET group_id = 'reply-group' WHERE tenant_id = ? AND id = 'fixture-ticket'").bind(fixture.principals.operatorA.tenantId),
    ]);
    await expectStatus(await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: agent.token }), 403,
      'An agent outside the ticket group cannot read the capability');
    await fixture.db.prepare('INSERT INTO user_groups (tenant_id, user_id, group_id) VALUES (?, ?, ?)')
      .bind(fixture.principals.operatorA.tenantId, agent.id, 'reply-group').run();
    await expectStatus(await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: agent.token }), 200,
      'A current agent group member may read the capability');
    await expectStatus(await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: noMfaAgent.token }), 403,
      'An unverified MFA claim cannot reach the route');

    fixture.enableLocalBeta();
    await initializeLocalBeta(fixture);
    await fixture.db.prepare("UPDATE local_beta_policy SET state = 'writes_stopped', revision = revision + 1 WHERE singleton = 1").run();
    fixture.restartLocalRuntime();
    await expectStatus(await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: adminA }), 200,
      'The guarded local profile permits this read after writes stop');

    await fixture.revokePrincipalSessions('operatorA');
    await expectStatus(await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: adminA }), 401,
      'Revoked staff sessions cannot read the capability');
    t.diagnostic(JSON.stringify({ tenants: 2, remoteProviderCalls: 0, storedTextFormat: true, markdownClaimed: false }));
  });
});
