import assert from 'node:assert/strict';
import test from 'node:test';
import { SlaClockRepository } from '../src/repositories/sla-clock.repository';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { DEFAULT_SLA_CALENDAR, parseSlaCalendar } from '../src/domain/sla-clock';
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

test('SLA policy is tenant-scoped, targetless until configured, and rejects malformed calendars', async () => {
  await withTwoTenantFixture(async fixture => {
    assert.equal((await fixture.request('/api/sla-policy')).status, 401);
    const operatorA = await operatorToken(fixture, 'operatorA');
    const operatorB = await operatorToken(fixture, 'operatorB');
    const baseline = await fixture.request('/api/sla-policy', { token: operatorA });
    assert.equal(baseline.status, 200);
    assert.deepEqual(await baseline.json<{ responseTargetMs: number | null; resolutionTargetMs: number | null; revision: number }>(),
      { responseTargetMs: null, resolutionTargetMs: null, revision: 0, calendar: { timeZone: 'UTC', weekly: { monday: [{ startMinute: 0, endMinute: 1440 }], tuesday: [{ startMinute: 0, endMinute: 1440 }], wednesday: [{ startMinute: 0, endMinute: 1440 }], thursday: [{ startMinute: 0, endMinute: 1440 }], friday: [{ startMinute: 0, endMinute: 1440 }], saturday: [{ startMinute: 0, endMinute: 1440 }], sunday: [{ startMinute: 0, endMinute: 1440 }] }, exceptions: [], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } }, reopenPolicy: { response: 'continue', resolution: 'continue' } });
    const calendar = { timeZone: 'Europe/London', weekly: { monday: [{ startMinute: 540, endMinute: 1020 }] }, exceptions: [], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } };
    assert.equal((await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA,
      body: { expectedRevision: 9, calendar, responseTargetMs: 3_600_000, resolutionTargetMs: null } })).status, 409, 'a stale revision cannot create an absent policy');
    assert.equal((await fixture.db.prepare("SELECT count(*) AS n FROM sla_policies WHERE tenant_id='fixture-tenant-a'").first<{ n: number }>())!.n, 0);
    const configured = await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA,
      body: { expectedRevision: 0, calendar, responseTargetMs: 3_600_000, resolutionTargetMs: null, reopenPolicy: { response: 'restart' } } });
    assert.equal(configured.status, 200);
    assert.deepEqual(await configured.json<{ responseTargetMs: number | null; resolutionTargetMs: number | null; reopenPolicy: { response: string; resolution: string }; revision: number }>(),
      { calendar, responseTargetMs: 3_600_000, resolutionTargetMs: null, reopenPolicy: { response: 'restart', resolution: 'continue' }, revision: 1 });
    const created = await fixture.request('/api/tickets', { method: 'POST', token: operatorA,
      body: { subject: 'Configured SLA at creation', customer_email: 'created-ticket@example.invalid', body: 'Synthetic initial message' } });
    assert.equal(created.status, 201);
    const createdTicket = await created.json<{ id: string }>();
    assert.deepEqual(await fixture.db.prepare(`SELECT policy_revision,policy_response_target_ms,response_completed_at
      FROM ticket_sla_clocks WHERE tenant_id='fixture-tenant-a' AND ticket_id=?`).bind(createdTicket.id).first(),
      { policy_revision: 1, policy_response_target_ms: 3_600_000, response_completed_at: null },
      'canonical ticket creation snapshots a configured policy before a reply or state transition');
    const customerA = await customerToken(fixture, 'customerA');
    const state = await (await fixture.request('/api/tickets/fixture-ticket/support-state', { token: operatorA })).json<{ revision: number }>();
    const waiting = await fixture.request('/api/tickets/fixture-ticket/support-state', { method: 'PATCH', token: operatorA,
      body: { definitionId: 'legacy-pending', expectedRevision: state.revision } });
    assert.equal(waiting.status, 200);
    const waitingState = await waiting.json<{ revision: number }>();
    assert.equal((await fixture.request('/api/tickets/fixture-ticket/articles', { method: 'POST', token: operatorA, body: { body: 'Synthetic public reply', is_internal: false } })).status, 201);
    const ticketSla = await fixture.request('/api/tickets/fixture-ticket/sla', { token: operatorA });
    assert.equal(ticketSla.status, 200);
    assert.equal((await ticketSla.json<{ response: { state: string } }>()).response.state, 'on-track', 'the first public staff reply completes the configured response clock');
    assert.ok((await fixture.db.prepare("SELECT response_completed_at FROM ticket_sla_clocks WHERE tenant_id='fixture-tenant-a' AND ticket_id='fixture-ticket'").first<{ response_completed_at: string | null }>())?.response_completed_at,
      'the first public staff reply is durably recorded before its SLA projection is returned');
    const customerSla = await fixture.request('/api/v1/customer/tickets/fixture-ticket/sla', { token: customerA });
    assert.equal(customerSla.status, 200);
    const customerProjection = await customerSla.json<Record<string, unknown>>();
    assert.equal('pauseReason' in customerProjection || 'actorId' in customerProjection || 'email' in customerProjection, false);
    const resolved = await fixture.request('/api/tickets/fixture-ticket/support-state', { method: 'PATCH', token: operatorA,
      body: { definitionId: 'legacy-resolved', expectedRevision: waitingState.revision } });
    assert.equal(resolved.status, 200);
    const reopened = await fixture.request('/api/tickets/fixture-ticket/support-state', { method: 'PATCH', token: operatorA,
      body: { definitionId: 'legacy-open', expectedRevision: (await resolved.json<{ revision: number }>()).revision } });
    assert.equal(reopened.status, 200);
    const reopenedState = await reopened.json<{ changed_at: string }>();
    assert.deepEqual(await fixture.db.prepare(`SELECT response_completed_at,response_started_at,resolution_completed_at
      FROM ticket_sla_clocks WHERE tenant_id='fixture-tenant-a' AND ticket_id='fixture-ticket'`).first(),
      { response_completed_at: null, response_started_at: reopenedState.changed_at, resolution_completed_at: null },
      'response restart clears completion while resolution continue resumes its original anchor');
    await fixture.db.prepare(`INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source)
      VALUES ('fixture-tenant-a','never-transitioned','Synthetic','open','customer-a@example.invalid','dashboard')`).run();
    assert.equal((await fixture.request('/api/tickets/never-transitioned/articles', { method: 'POST', token: operatorA,
      body: { body: 'First reply without state transition', is_internal: false } })).status, 201);
    assert.deepEqual(await fixture.db.prepare(`SELECT policy_response_target_ms,response_completed_at FROM ticket_sla_clocks
      WHERE tenant_id='fixture-tenant-a' AND ticket_id='never-transitioned'`).first(),
      { policy_response_target_ms: 3_600_000, response_completed_at: (await fixture.db.prepare("SELECT response_completed_at FROM ticket_sla_clocks WHERE tenant_id='fixture-tenant-a' AND ticket_id='never-transitioned'").first<{ response_completed_at: string }>())!.response_completed_at },
      'canonical replies initialize SLA evidence even without a support-state transition');
    await fixture.db.prepare(`INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source)
      VALUES ('fixture-tenant-a','explicit-sla-start','Historical synthetic ticket','open','customer-a@example.invalid','dashboard')`).run();
    assert.equal((await fixture.request('/api/tickets/explicit-sla-start/sla', { token: operatorA })).status, 404,
      'an old ticket is not silently given today\'s SLA policy');
    assert.equal((await fixture.request('/api/tickets/explicit-sla-start/sla/initialize', { method: 'POST', token: operatorB, body: {} })).status, 404,
      'an administrator in another tenant cannot initialize a foreign ticket');
    assert.equal((await fixture.request('/api/tickets/explicit-sla-start/sla/initialize', { method: 'POST', token: operatorA, body: {} })).status, 201);
    const explicitProjection = await (await fixture.request('/api/tickets/explicit-sla-start/sla', { token: operatorA })).json<{
      response: { targetWorkingMilliseconds: number | null }; resolution: { state: string }; handlerName: string | null;
    }>();
    assert.equal(explicitProjection.response.targetWorkingMilliseconds, 3_600_000,
      'one explicit, tenant-scoped initialization snapshots the currently configured policy');
    assert.equal(explicitProjection.resolution.state, 'unavailable');
    assert.equal(explicitProjection.handlerName, null);
    assert.equal((await fixture.request('/api/tickets/explicit-sla-start/sla/initialize', { method: 'POST', token: operatorA, body: {} })).status, 200,
      'repeating explicit initialization is idempotent');
    assert.equal((await fixture.db.prepare(`SELECT count(*) AS n FROM ticket_sla_events
      WHERE tenant_id='fixture-tenant-a' AND ticket_id='explicit-sla-start' AND kind='clock.initialized'`).first<{ n: number }>())?.n, 1,
      'the explicit starting decision has one durable audit record');
    const batch = await fixture.request('/api/ticket-sla/projections', { method: 'POST', token: operatorA,
      body: { ticketIds: ['fixture-ticket', 'explicit-sla-start', 'fixture-b-only'] } });
    assert.equal(batch.status, 200);
    const projections = await batch.json<Record<string, unknown>>();
    assert.deepEqual(Object.keys(projections).sort(), ['explicit-sla-start', 'fixture-ticket'],
      'one bounded list request returns only projections visible in the current tenant');
    assert.equal((await fixture.request('/api/ticket-sla/projections', { method: 'POST', token: operatorA,
      body: { ticketIds: Array.from({ length: 26 }, (_, index) => `ticket-${index}`) } })).status, 400,
      'list projection requests are bounded before database work');
    assert.equal((await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA,
      body: { expectedRevision: 1, calendar, responseTargetMs: 7_200_000, resolutionTargetMs: null } })).status, 200);
    const policyEvents = (await fixture.db.prepare("SELECT count(*) AS n FROM sla_policy_events WHERE tenant_id='fixture-tenant-a'").first<{ n: number }>())!.n;
    assert.equal((await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA,
      body: { expectedRevision: 1, calendar, responseTargetMs: 3_600_000, resolutionTargetMs: null } })).status, 409,
      'a stale administrator policy revision cannot overwrite a newer policy');
    assert.equal((await fixture.db.prepare("SELECT count(*) AS n FROM sla_policy_events WHERE tenant_id='fixture-tenant-a'").first<{ n: number }>())!.n, policyEvents,
      'a rejected policy CAS produces no audit event');
    assert.equal((await (await fixture.request('/api/tickets/never-transitioned/sla', { token: operatorA })).json<{ response: { targetWorkingMilliseconds: number | null } }>()).response.targetWorkingMilliseconds, 3_600_000,
      'later policy edits do not reinterpret a clock already started under the prior policy');
    assert.equal((await fixture.request('/api/tickets/never-transitioned/articles', { method: 'POST', token: operatorA,
      body: { body: 'Second public reply', is_internal: false } })).status, 201);
    assert.equal((await fixture.db.prepare("SELECT count(*) AS n FROM ticket_sla_events WHERE tenant_id='fixture-tenant-a' AND ticket_id='never-transitioned' AND kind='clock.responded'").first<{ n: number }>())?.n, 1,
      'later public replies cannot duplicate first-response audit evidence');
    const foreign = await fixture.request('/api/sla-policy', { token: operatorB });
    assert.equal(foreign.status, 200);
    assert.deepEqual(await foreign.json<{ responseTargetMs: number | null; resolutionTargetMs: number | null; revision: number }>(),
      { responseTargetMs: null, resolutionTargetMs: null, revision: 0, calendar: { timeZone: 'UTC', weekly: { monday: [{ startMinute: 0, endMinute: 1440 }], tuesday: [{ startMinute: 0, endMinute: 1440 }], wednesday: [{ startMinute: 0, endMinute: 1440 }], thursday: [{ startMinute: 0, endMinute: 1440 }], friday: [{ startMinute: 0, endMinute: 1440 }], saturday: [{ startMinute: 0, endMinute: 1440 }], sunday: [{ startMinute: 0, endMinute: 1440 }] }, exceptions: [], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } }, reopenPolicy: { response: 'continue', resolution: 'continue' } });
    assert.equal((await fixture.request('/api/sla-policy', { method: 'PUT', token: operatorA,
      body: { expectedRevision: 2, calendar: { ...calendar, timeZone: 'Not/AZone' }, responseTargetMs: 1, resolutionTargetMs: null } })).status, 400);
    await fixture.revokePrincipalSessions('operatorA');
    assert.equal((await fixture.request('/api/sla-policy', { token: operatorA })).status, 401);
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

test('support-state listing paginates deterministically within the tenant boundary', async () => {
  await withTwoTenantFixture(async fixture => {
    const operatorA = await operatorToken(fixture, 'operatorA');
    await fixture.db.batch(Array.from({ length: 101 }, (_, index) => fixture.db.prepare(
      `INSERT INTO support_state_definitions
        (tenant_id,id,legacy_status,internal_label,public_label)
       VALUES ('fixture-tenant-a',?,'open',?,?)`,
    ).bind(`state-${String(index).padStart(3, '0')}`, `State ${String(index).padStart(3, '0')}`, `State ${index}`)));
    await fixture.db.prepare(`INSERT INTO support_state_definitions
      (tenant_id,id,legacy_status,internal_label,public_label) VALUES ('fixture-tenant-b','state-999','open','State 999','State 999')`).run();

    const first = await fixture.request('/api/support-states?limit=100', { token: operatorA });
    assert.equal(first.status, 200);
    const firstPage = await first.json<Array<{ id: string }>>();
    const cursor = first.headers.get('X-Next-Cursor');
    assert.equal(firstPage.length, 100);
    assert.ok(cursor);
    assert.equal(firstPage.some(state => state.id === 'state-999'), false);

    const second = await fixture.request(`/api/support-states?limit=100&cursor=${encodeURIComponent(cursor!)}`, { token: operatorA });
    assert.equal(second.status, 200);
    const secondPage = await second.json<Array<{ id: string }>>();
    assert.equal(secondPage.length, 5);
    assert.equal(second.headers.get('X-Next-Cursor'), null);
    assert.equal([...firstPage, ...secondPage].filter(state => state.id.startsWith('state-')).length, 101);
    assert.equal([...firstPage, ...secondPage].some(state => state.id === 'state-999'), false, 'foreign tenant definitions never cross the cursor pages');
    assert.equal((await fixture.request('/api/support-states?cursor=bad', { token: operatorA })).status, 400);
    assert.equal((await fixture.request(`/api/support-states?cursor=${'a'.repeat(1025)}`, { token: operatorA })).status, 400);
  });
});

test('support-state cursor preserves Unicode labels across pages', async () => {
  await withTwoTenantFixture(async fixture => {
    const operatorA = await operatorToken(fixture, 'operatorA');
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO support_state_definitions
        (tenant_id,id,legacy_status,internal_label,public_label) VALUES ('fixture-tenant-a','unicode-greek','open','Ω waiting','Waiting')`),
      fixture.db.prepare(`INSERT INTO support_state_definitions
        (tenant_id,id,legacy_status,internal_label,public_label) VALUES ('fixture-tenant-a','unicode-emoji','open','🔥 later','Later')`),
    ]);

    const first = await fixture.request('/api/support-states?limit=5', { token: operatorA });
    assert.equal(first.status, 200);
    const cursor = first.headers.get('X-Next-Cursor');
    assert.ok(cursor, 'a full page with another state has a cursor');
    const second = await fixture.request(`/api/support-states?limit=5&cursor=${encodeURIComponent(cursor!)}`, { token: operatorA });
    assert.equal(second.status, 200);
    const definitions = [...await first.json<Array<{ id: string }>>(), ...await second.json<Array<{ id: string }>>()];
    assert.deepEqual(definitions.filter(state => state.id.startsWith('unicode-')).map(state => state.id), ['unicode-greek', 'unicode-emoji']);
    assert.equal(second.headers.get('X-Next-Cursor'), null);
  });
});


test('SLA projection freezes paused and completed clocks and clips history to each clock anchor', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenant = 'fixture-tenant-a';
    const repo = new SlaClockRepository(fixture.db, createVerifiedTenantScope(tenant, 'synthetic-reader', ['admin'], 1));
    await fixture.db.prepare(`INSERT INTO ticket_sla_clocks
      (tenant_id,ticket_id,response_started_at,response_completed_at,resolution_started_at,paused_at,pause_reason,
       policy_revision,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy)
      VALUES (?,'fixture-ticket','2026-09-11T09:00:00.000Z','2026-09-11T09:15:00.000Z','2026-09-11T09:00:00.000Z','2026-09-11T09:30:00.000Z','waiting',1,?,3600000,7200000,'continue','restart')`)
      .bind(tenant, JSON.stringify(DEFAULT_SLA_CALENDAR)).run();
    await fixture.db.prepare(`INSERT INTO ticket_sla_pause_intervals (tenant_id,ticket_id,started_at,reason,support_state_revision)
      VALUES (?,'fixture-ticket','2026-09-11T09:30:00.000Z','waiting',1)`).bind(tenant).run();
    const early = await repo.getProjection('fixture-ticket', new Date('2026-09-11T09:30:00.000Z'));
    const later = await repo.getProjection('fixture-ticket', new Date('2026-09-14T10:00:00.000Z'));
    assert.deepEqual(later, early, 'open pauses neither age remaining work nor rewrite completed deadlines');
    assert.deepEqual(early?.response, { state: 'on-track', phase: 'completed', completedAt: '2026-09-11T09:15:00.000Z',
      dueAt: '2026-09-11T10:00:00.000Z', remainingWorkingMilliseconds: 2700000, targetWorkingMilliseconds: 3600000 });
    assert.deepEqual(early?.resolution, { state: 'on-track', phase: 'paused', completedAt: null,
      dueAt: null, remainingWorkingMilliseconds: 5400000, targetWorkingMilliseconds: 7200000 });
    await fixture.db.batch([
      fixture.db.prepare("UPDATE ticket_sla_pause_intervals SET ended_at='2026-09-11T10:30:00.000Z' WHERE tenant_id=? AND ticket_id='fixture-ticket'").bind(tenant),
      fixture.db.prepare("UPDATE ticket_sla_clocks SET paused_at=NULL,pause_reason=NULL WHERE tenant_id=? AND ticket_id='fixture-ticket'").bind(tenant),
    ]);
    const resumed = await repo.getProjection('fixture-ticket', new Date('2026-09-11T11:00:00.000Z'));
    assert.deepEqual(resumed?.response, early?.response);
    assert.deepEqual(resumed?.resolution, { state: 'on-track', phase: 'running', completedAt: null,
      dueAt: '2026-09-11T12:00:00.000Z', remainingWorkingMilliseconds: 3600000, targetWorkingMilliseconds: 7200000 });
    await fixture.db.prepare("UPDATE ticket_sla_clocks SET resolution_completed_at='2026-09-11T12:01:00.000Z' WHERE tenant_id=? AND ticket_id='fixture-ticket'").bind(tenant).run();
    const completed = await repo.getProjection('fixture-ticket', new Date('2026-09-14T11:00:00.000Z'));
    assert.equal(completed?.resolution.phase, 'completed');
    assert.equal(completed?.resolution.state, 'breached');
    assert.equal(completed?.resolution.dueAt, '2026-09-11T12:00:00.000Z');
    // A restarted clock ignores all previous-cycle pauses, including a valid
    // same-instant pause/resume fact admitted by the storage constraints.
    await fixture.db.batch([
      fixture.db.prepare("UPDATE ticket_sla_clocks SET resolution_started_at='2026-09-14T09:00:00.000Z',resolution_completed_at=NULL WHERE tenant_id=? AND ticket_id='fixture-ticket'").bind(tenant),
      fixture.db.prepare("INSERT INTO ticket_sla_pause_intervals (tenant_id,ticket_id,started_at,ended_at,reason,support_state_revision) VALUES (?,'fixture-ticket','2026-09-14T09:30:00.000Z','2026-09-14T09:30:00.000Z','waiting',2)").bind(tenant),
    ]);
    const restarted = await repo.getProjection('fixture-ticket', new Date('2026-09-14T10:00:00.000Z'));
    assert.equal(restarted?.resolution.dueAt, '2026-09-14T11:00:00.000Z');
    assert.equal(restarted?.resolution.remainingWorkingMilliseconds, 3600000);
    await fixture.db.prepare("UPDATE ticket_sla_clocks SET paused_at='2026-09-14T11:00:00.000Z',pause_reason='waiting' WHERE tenant_id=? AND ticket_id='fixture-ticket'").bind(tenant).run();
    const exactDeadline = await repo.getProjection('fixture-ticket', new Date('2026-09-15T11:00:00.000Z'));
    assert.equal(exactDeadline?.resolution.state, 'on-track', 'pausing exactly at the deadline does not create a later breach');
    assert.equal(exactDeadline?.resolution.remainingWorkingMilliseconds, 0);
    assert.equal(exactDeadline?.resolution.dueAt, null);
    // Calendar configuration is frozen; a DST-spanning clock uses local working
    // windows and closure exceptions, not the server or browser timezone.
    const business = parseSlaCalendar({ timeZone: 'Europe/London', weekly: {
      friday: [{ startMinute: 540, endMinute: 1020 }], monday: [{ startMinute: 540, endMinute: 1020 }], tuesday: [{ startMinute: 540, endMinute: 1020 }],
    }, exceptions: [{ date: '2026-03-30', intervals: [] }], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } });
    await fixture.db.prepare("UPDATE ticket_sla_clocks SET policy_calendar_json=?,resolution_started_at='2026-03-27T16:00:00.000Z',paused_at=NULL,pause_reason=NULL WHERE tenant_id=? AND ticket_id='fixture-ticket'").bind(JSON.stringify(business),tenant).run();
    const dst = await repo.getProjection('fixture-ticket', new Date('2026-03-31T08:30:00.000Z'));
    assert.equal(dst?.resolution.dueAt, '2026-03-31T09:00:00.000Z');
    assert.equal(dst?.resolution.remainingWorkingMilliseconds, 1800000);
  });
});
