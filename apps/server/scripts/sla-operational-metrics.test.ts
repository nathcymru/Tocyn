import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { DEFAULT_SLA_CALENDAR, parseSlaCalendar } from '../src/domain/sla-clock';
import { isOperationalMetricProjectionFresh, OperationalMetricAccessError, OperationalMetricsRepository } from '../src/repositories/operational-metrics.repository';
import { withTwoTenantFixture } from './local-tenant-fixture';

const tenantCalendar = JSON.stringify(DEFAULT_SLA_CALENDAR);
const hour = 3_600_000;

async function ticket(fixture: Parameters<typeof withTwoTenantFixture>[0] extends (fixture: infer T) => Promise<unknown> ? T : never, tenantId: string, id: string, groupId: string | null = null) {
  await fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,group_id,source) VALUES (?,?,?,?,?,?,?,?)')
    .bind(tenantId, id, id, 'open', 'normal', tenantId === fixture.principals.customerB.tenantId ? fixture.principals.customerB.email : fixture.principals.customerA.email, groupId, 'api').run();
}

async function clock(fixture: Parameters<typeof withTwoTenantFixture>[0] extends (fixture: infer T) => Promise<unknown> ? T : never, tenantId: string, id: string, values: {
  responseStartedAt: string; responseCompletedAt?: string | null; resolutionStartedAt?: string; resolutionCompletedAt?: string | null;
  pausedAt?: string | null; calendar?: string; responseTargetMs?: number | null; resolutionTargetMs?: number | null;
}) {
  await fixture.db.prepare(`INSERT INTO ticket_sla_clocks
    (tenant_id,ticket_id,response_started_at,response_completed_at,resolution_started_at,resolution_completed_at,paused_at,pause_reason,
     policy_revision,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy)
    VALUES (?,?,?,?,?,?,?,?,1,?,?,?,'continue','restart')`)
    .bind(tenantId, id, values.responseStartedAt, values.responseCompletedAt ?? null, values.resolutionStartedAt ?? values.responseStartedAt,
      values.resolutionCompletedAt ?? null, values.pausedAt ?? null, values.pausedAt ? 'waiting' : null, values.calendar ?? tenantCalendar,
      values.responseTargetMs === undefined ? hour : values.responseTargetMs, values.resolutionTargetMs === undefined ? hour : values.resolutionTargetMs).run();
}

test('SLA metrics project frozen clock deadlines, completed outcomes, pauses, reopen anchors, and calendar windows', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    for (const id of ['sla-on-time', 'sla-late', 'sla-paused', 'sla-reopened', 'sla-calendar', 'sla-targetless', 'sla-legacy']) await ticket(fixture, tenantId, id);
    await clock(fixture, tenantId, 'sla-on-time', { responseStartedAt: '2026-09-11T09:00:00.000Z', responseCompletedAt: '2026-09-11T09:30:00.000Z', resolutionCompletedAt: '2026-09-11T09:45:00.000Z' });
    await clock(fixture, tenantId, 'sla-late', { responseStartedAt: '2026-09-11T09:00:00.000Z', responseCompletedAt: '2026-09-11T10:01:00.000Z', resolutionCompletedAt: '2026-09-11T10:01:00.000Z' });
    await clock(fixture, tenantId, 'sla-paused', { responseStartedAt: '2026-09-11T09:00:00.000Z', responseCompletedAt: '2026-09-11T10:45:00.000Z', resolutionCompletedAt: '2026-09-11T10:45:00.000Z' });
    await fixture.db.prepare(`INSERT INTO ticket_sla_pause_intervals (tenant_id,ticket_id,started_at,ended_at,reason,support_state_revision)
      VALUES (?,'sla-paused','2026-09-11T09:30:00.000Z','2026-09-11T10:30:00.000Z','waiting',1)`).bind(tenantId).run();
    // Reopen policy restarted this cycle: the retained old start must not put its new due date in the wrong window.
    await clock(fixture, tenantId, 'sla-reopened', { responseStartedAt: '2026-09-11T12:00:00.000Z', responseCompletedAt: '2026-09-11T12:30:00.000Z', resolutionStartedAt: '2026-09-11T12:00:00.000Z', resolutionCompletedAt: '2026-09-11T12:30:00.000Z' });
    const businessCalendar = JSON.stringify(parseSlaCalendar({ timeZone: 'Europe/London', weekly: {
      monday: [{ startMinute: 540, endMinute: 1020 }], tuesday: [{ startMinute: 540, endMinute: 1020 }], wednesday: [{ startMinute: 540, endMinute: 1020 }], thursday: [{ startMinute: 540, endMinute: 1020 }], friday: [{ startMinute: 540, endMinute: 1020 }],
    }, exceptions: [], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } }));
    await clock(fixture, tenantId, 'sla-calendar', { responseStartedAt: '2026-09-11T16:00:00.000Z', responseCompletedAt: '2026-09-14T09:30:00.000Z', resolutionCompletedAt: '2026-09-14T10:01:00.000Z', calendar: businessCalendar, responseTargetMs: 7_200_000, resolutionTargetMs: 7_200_000 });
    await clock(fixture, tenantId, 'sla-targetless', { responseStartedAt: '2026-09-11T09:00:00.000Z', responseTargetMs: null, resolutionTargetMs: null });
    const repository = new OperationalMetricsRepository(fixture.db, createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 0), () => new Date('2026-09-14T12:00:00.000Z'));

    const friday = await repository.slaForWindow({ startsAt: '2026-09-11T10:00:00.000Z', endsAt: '2026-09-11T13:30:00.000Z' });
    assert.equal(friday.status, 'available');
    if (friday.status === 'available') {
      assert.deepEqual(friday.firstResponse, { numerator: 3, denominator: 4, denominatorDescription: friday.firstResponse.denominatorDescription });
      assert.deepEqual(friday.resolution, { numerator: 3, denominator: 4, denominatorDescription: friday.resolution.denominatorDescription });
      assert.match(friday.firstResponse.denominatorDescription, /targetless, legacy, and open-paused clocks are excluded/);
      assert.equal(isOperationalMetricProjectionFresh(friday, () => new Date('2026-09-14T12:00:59.999Z')), true);
      assert.equal(isOperationalMetricProjectionFresh(friday, () => new Date('2026-09-14T12:01:00.001Z')), false);
    }
    const monday = await repository.slaForWindow({ startsAt: '2026-09-14T09:30:00.000Z', endsAt: '2026-09-14T10:30:00.000Z' });
    assert.equal(monday.status, 'available');
    if (monday.status === 'available') {
      assert.equal(monday.firstResponse.denominator, 1, 'the frozen London business calendar carries Friday work into Monday');
      assert.equal(monday.firstResponse.numerator, 1);
      assert.equal(monday.resolution.denominator, 1);
      assert.equal(monday.resolution.numerator, 0, 'a completion after the frozen calendar deadline is late');
    }
  });
});

test('SLA metrics enforce tenant/group/revocation boundaries and fail closed on caps or malformed state', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantA = fixture.principals.operatorA.tenantId;
    const tenantB = fixture.principals.operatorB.tenantId;
    const actorId = fixture.principals.operatorA.localId;
    await ticket(fixture, tenantA, 'sla-visible');
    await ticket(fixture, tenantB, 'sla-visible');
    await clock(fixture, tenantA, 'sla-visible', { responseStartedAt: '2026-09-11T09:00:00.000Z', responseCompletedAt: '2026-09-11T09:30:00.000Z' });
    await clock(fixture, tenantB, 'sla-visible', { responseStartedAt: '2026-09-11T09:00:00.000Z', responseCompletedAt: '2026-09-11T10:30:00.000Z' });
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO groups (tenant_id,id,name,description) VALUES (?,?,?,?)').bind(tenantA, 'sla-hidden', 'SLA hidden', null),
      fixture.db.prepare('INSERT INTO groups (tenant_id,id,name,description) VALUES (?,?,?,?)').bind(tenantA, 'sla-allowed', 'SLA allowed', null),
      fixture.db.prepare('INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,?,?)').bind(tenantA, actorId, 'sla-allowed'),
    ]);
    await ticket(fixture, tenantA, 'sla-hidden-ticket', 'sla-hidden');
    await ticket(fixture, tenantA, 'sla-allowed-ticket', 'sla-allowed');
    await clock(fixture, tenantA, 'sla-hidden-ticket', { responseStartedAt: '2026-09-11T09:00:00.000Z', responseCompletedAt: '2026-09-11T09:30:00.000Z' });
    await clock(fixture, tenantA, 'sla-allowed-ticket', { responseStartedAt: '2026-09-11T09:00:00.000Z', responseCompletedAt: '2026-09-11T09:30:00.000Z' });
    await fixture.db.prepare('UPDATE users SET role=? WHERE tenant_id=? AND id=?').bind('agent', tenantA, actorId).run();
    const scope = createVerifiedTenantScope(tenantA, actorId, ['agent'], 1);
    const window = { startsAt: '2026-09-11T10:00:00.000Z', endsAt: '2026-09-11T10:30:00.000Z' };
    const evaluateAt = () => new Date('2026-09-11T12:00:00.000Z');
    const projected = await new OperationalMetricsRepository(fixture.db, scope, evaluateAt).slaForWindow(window);
    assert.equal(projected.status, 'available', JSON.stringify(projected));
    if (projected.status === 'available') assert.equal(projected.firstResponse.denominator, 2, 'the other tenant and a disallowed group are absent');
    await fixture.db.prepare('UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND id=?').bind(tenantA, actorId).run();
    await assert.rejects(() => new OperationalMetricsRepository(fixture.db, scope).slaForWindow(window), OperationalMetricAccessError);

    const adminScope = createVerifiedTenantScope(tenantA, actorId, ['agent'], 2);
    const invalidWindow = await new OperationalMetricsRepository(fixture.db, adminScope, evaluateAt).slaForWindow({ startsAt: window.startsAt, endsAt: window.startsAt });
    assert.deepEqual(invalidWindow, { status: 'unavailable', reason: 'invalid_selected_window', selectedWindow: null, asOf: null, freshThrough: null, firstResponse: { numerator: null, denominator: null }, resolution: { numerator: null, denominator: null } });
    const capped = await new OperationalMetricsRepository(fixture.db, adminScope, evaluateAt, { slaClockCandidates: 1 }).slaForWindow(window);
    assert.equal(capped.status, 'unavailable');
    if (capped.status === 'unavailable') {
      assert.equal(capped.reason, 'tenant_sla_clock_candidate_cap_exceeded');
      assert.deepEqual(capped.firstResponse, { numerator: null, denominator: null });
      assert.equal(capped.freshThrough, '2026-09-11T12:01:00.000Z');
    }
    const recovered = await new OperationalMetricsRepository(fixture.db, adminScope, evaluateAt).slaForWindow(window);
    assert.equal(recovered.status, 'available', 'a fresh bounded projection recovers once its configured candidate ceiling is sufficient');
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO ticket_sla_pause_intervals (tenant_id,ticket_id,started_at,ended_at,reason,support_state_revision)
        VALUES (?,'sla-visible','2026-09-11T09:10:00.000Z','2026-09-11T09:15:00.000Z','waiting',1)`).bind(tenantA),
      fixture.db.prepare(`INSERT INTO ticket_sla_pause_intervals (tenant_id,ticket_id,started_at,ended_at,reason,support_state_revision)
        VALUES (?,'sla-visible','2026-09-11T09:20:00.000Z','2026-09-11T09:25:00.000Z','waiting',2)`).bind(tenantA),
    ]);
    const pauseCapped = await new OperationalMetricsRepository(fixture.db, adminScope, evaluateAt, { slaPauseCandidates: 1 }).slaForWindow(window);
    assert.equal(pauseCapped.status, 'unavailable');
    if (pauseCapped.status === 'unavailable') assert.equal(pauseCapped.reason, 'tenant_sla_pause_candidate_cap_exceeded');
    const calendarCapped = await new OperationalMetricsRepository(fixture.db, adminScope, evaluateAt, { slaCalendarDays: 1 }).slaForWindow(window);
    assert.equal(calendarCapped.status, 'unavailable');
    if (calendarCapped.status === 'unavailable') assert.equal(calendarCapped.reason, 'sla_calendar_work_cap_exceeded');
    await fixture.db.prepare("UPDATE ticket_sla_clocks SET policy_calendar_json='{' WHERE tenant_id=? AND ticket_id='sla-visible'").bind(tenantA).run();
    const malformed = await new OperationalMetricsRepository(fixture.db, adminScope, evaluateAt).slaForWindow(window);
    assert.equal(malformed.status, 'unavailable');
    if (malformed.status === 'unavailable') assert.equal(malformed.reason, 'malformed_sla_clock_or_calendar');
  });
});
