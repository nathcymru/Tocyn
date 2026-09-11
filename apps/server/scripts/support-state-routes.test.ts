import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';

async function operatorToken(fixture: LocalTenantFixture, operator: 'operatorA' | 'operatorB'): Promise<string> {
  const challenge = await (await fixture.login(operator)).json<{ token: string }>();
  const verified = await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) },
  });
  assert.equal(verified.status, 200);
  return (await verified.json<{ token: string }>()).token;
}

async function customerToken(fixture: LocalTenantFixture, customer: 'customerA' | 'customerB'): Promise<string> {
  const principal = fixture.principals[customer];
  const response = await fixture.request('/api/v1/customer/auth/request', {
    method: 'POST', body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey }, ip: `${fixture.rateLimitIdentity}-${customer}`,
  });
  assert.equal(response.status, 200);
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const token = new URL(messages.find(message => message.to === principal.email)?.loginLink ?? '').searchParams.get('token');
  assert.ok(token);
  const verified = await fixture.request('/api/v1/customer/auth/verify', { method: 'POST', body: { token, widgetKey: principal.widgetKey }, ip: `${fixture.rateLimitIdentity}-${customer}` });
  assert.equal(verified.status, 200);
  return (await verified.json<{ token: string }>()).token;
}

test('support-state routes enforce current identity, settings capability, ticket group scope and customer-safe visibility', async () => {
  await withTwoTenantFixture(async fixture => {
    assert.equal((await fixture.request('/api/support-states')).status, 401);
    const operatorA = await operatorToken(fixture, 'operatorA');
    const operatorB = await operatorToken(fixture, 'operatorB');
    const create = await fixture.request('/api/support-states', {
      method: 'POST', token: operatorA,
      body: { id: 'awaiting-customer', legacyStatus: 'pending', internalLabel: 'Awaiting private proof', publicLabel: 'Waiting for information', waitingReasonRequired: true },
    });
    assert.equal(create.status, 201);
    const definition = await create.json<{ id: string; internal_label: string; public_label: string }>();
    assert.deepEqual(definition, { ...definition, id: 'awaiting-customer', internal_label: 'Awaiting private proof', public_label: 'Waiting for information' });
    assert.equal((await fixture.request('/api/support-states?limit=101', { token: operatorA })).status, 400);
    assert.equal((await fixture.request('/api/support-states', { token: operatorB })).status, 200);

    const before = await (await fixture.request('/api/tickets/fixture-ticket/support-state', { token: operatorA })).json<{ revision: number }>();
    const first = await fixture.request('/api/tickets/fixture-ticket/support-state', {
      method: 'PATCH', token: operatorA,
      body: { definitionId: 'awaiting-customer', waitingReason: 'Need a receipt', expectedRevision: before.revision },
    });
    assert.equal(first.status, 200);
    const state = await first.json<{ definition_id: string; waiting_reason: string }>();
    assert.equal(state.definition_id, 'awaiting-customer');
    assert.equal(state.waiting_reason, 'Need a receipt');
    const stale = await fixture.request('/api/tickets/fixture-ticket/support-state', {
      method: 'PATCH', token: operatorA,
      body: { definitionId: 'awaiting-customer', waitingReason: 'Stale write', expectedRevision: before.revision },
    });
    assert.equal(stale.status, 409);
    assert.equal((await fixture.request('/api/tickets/fixture-b-only/support-state', {
      method: 'PATCH', token: operatorA,
      body: { definitionId: 'awaiting-customer', waitingReason: 'Cross tenant', expectedRevision: 1 },
    })).status, 404);

    const customerA = await customerToken(fixture, 'customerA');
    const publicResponse = await fixture.request('/api/v1/customer/tickets/fixture-ticket/support-state', { token: customerA });
    assert.equal(publicResponse.status, 200);
    const publicState = await publicResponse.json<Record<string, unknown>>();
    assert.deepEqual(publicState, { lifecycle: 'pending', label: 'Waiting for information', changedAt: publicState.changedAt });
    assert.equal('waitingReason' in publicState || 'waiting_reason' in publicState || 'internal_label' in publicState, false);
    assert.equal((await fixture.request('/api/v1/customer/tickets/fixture-b-only/support-state', { token: customerA })).status, 404);

    await fixture.revokePrincipalSessions('operatorA');
    assert.equal((await fixture.request('/api/support-states', { token: operatorA })).status, 401);
  });
});

test('support-state transition preserves local-beta stop, budget, and stale-CAS accounting', async () => {
  await withTwoTenantFixture(async fixture => {
    const operatorA = await operatorToken(fixture, 'operatorA');
    const definitionResponse = await fixture.request('/api/support-states', {
      method: 'POST', token: operatorA,
      body: { id: 'beta-waiting', legacyStatus: 'pending', internalLabel: 'Beta wait', publicLabel: 'Waiting', waitingReasonRequired: true },
    });
    assert.equal(definitionResponse.status, 201);
    const initial = await (await fixture.request('/api/tickets/fixture-ticket/support-state', { token: operatorA })).json<{ revision: number }>();

    const { initializeLocalBetaFixture, betaCounters } = await import('./local-beta-fixture');
    await initializeLocalBetaFixture(fixture, {
      runId: 'support-state-local-beta',
      tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      limits: { ticketLimit: 4, mutationLimit: 3, recoveryReserve: 1, uploadLimit: 2 },
      invitations: Object.values(fixture.principals).map(principal => ({
        tenantId: principal.tenantId,
        id: principal.localId,
        kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
      })),
    });
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 0, upload_attempts: 0 });

    const accepted = await fixture.request('/api/tickets/fixture-ticket/support-state', {
      method: 'PATCH', token: operatorA,
      body: { definitionId: 'beta-waiting', waitingReason: 'Need beta evidence', expectedRevision: initial.revision },
    });
    assert.equal(accepted.status, 200);
    const current = await accepted.json<{ revision: number }>();
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 1, upload_attempts: 0 });

    const stale = await fixture.request('/api/tickets/fixture-ticket/support-state', {
      method: 'PATCH', token: operatorA,
      body: { definitionId: 'beta-waiting', waitingReason: 'Old request', expectedRevision: initial.revision },
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 1, upload_attempts: 0 });

    await fixture.db.prepare("UPDATE local_beta_policy SET state='writes_stopped', revision=revision+1 WHERE singleton=1").run();
    const stopped = await fixture.request('/api/tickets/fixture-ticket/support-state', {
      method: 'PATCH', token: operatorA,
      body: { definitionId: 'legacy-open', expectedRevision: current.revision },
    });
    assert.equal(stopped.status, 503);
    assert.equal((await stopped.json<{ code: string }>()).code, 'beta_intake_stopped');
    assert.deepEqual(await betaCounters(fixture), { tickets: 0, mutations: 1, upload_attempts: 0 });
  });
});

test('support-state ticket routes enforce live agent group membership', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const actorId = fixture.principals.operatorA.localId;
    await fixture.db.batch([
      fixture.db.prepare("UPDATE users SET role='agent', session_version=session_version+1 WHERE tenant_id=? AND id=?").bind(tenantId, actorId),
      fixture.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES (?, 'support-state-group', 'Support state group')").bind(tenantId),
      fixture.db.prepare("UPDATE tickets SET group_id='support-state-group' WHERE tenant_id=? AND id='fixture-ticket'").bind(tenantId),
    ]);
    const agent = await operatorToken(fixture, 'operatorA');
    assert.equal((await fixture.request('/api/tickets/fixture-ticket/support-state', { token: agent })).status, 404);
    await fixture.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,?,'support-state-group')").bind(tenantId, actorId).run();
    assert.equal((await fixture.request('/api/tickets/fixture-ticket/support-state', { token: agent })).status, 200);
  });
});
