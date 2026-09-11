import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { isOperationalMetricProjectionFresh, OperationalMetricAccessError, OperationalMetricsRepository } from '../src/repositories/operational-metrics.repository';

test('operational metrics reconcile current work to scoped canonical events and fail closed for customers', async () => {
  await withTwoTenantFixture(async fixture => {
    const keyA = await fixture.createScopedApiKey('operatorA', ['tickets:write', 'tickets:read']);
    const scopeA = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const repository = new OperationalMetricsRepository(fixture.db, scopeA, () => new Date('2026-09-11T11:59:00.000Z'));
    const baseline = await repository.currentWork();
    const create = async (key: string, email: string, subject: string) => {
      const response = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key, body: { subject, customer_email: email, body: 'synthetic metric event' } });
      assert.equal(response.status, 201);
      const body = await response.json() as { id?: string; ticket?: { id?: string } };
      const id = body.ticket?.id ?? body.id;
      assert.equal(typeof id, 'string');
      return id;
    };
    const ticketA = await create(keyA.apiKey, fixture.principals.customerA.email, 'A one');
    await create(keyA.apiKey, fixture.principals.customerA.email, 'A two');
    await fixture.db.prepare("UPDATE tickets SET assigned_to=? WHERE tenant_id=? AND id=?")
      .bind(fixture.principals.operatorA.localId, fixture.principals.operatorA.tenantId, ticketA).run();

    assert.ok(baseline.currentWork.total !== null);
    assert.ok(baseline.currentWork.unassigned !== null);
    assert.ok(baseline.currentWork.assigned !== null);
    assert.ok(baseline.canonicalEvents.total !== null);
    const projection = await repository.currentWork();
    assert.equal(projection.definitionVersion, '2026-09-11.3');
    assert.equal(projection.currentWork.status, 'available');
    assert.equal(projection.currentWork.total, baseline.currentWork.total + 2);
    assert.equal(projection.currentWork.unassigned, baseline.currentWork.unassigned + 1);
    assert.equal(projection.currentWork.assigned, baseline.currentWork.assigned + 1);
    assert.deepEqual(projection.currentWork.byAssignee, [{ actorId: fixture.principals.operatorA.localId, count: 1 }]);
    assert.equal(projection.canonicalEvents.total, baseline.canonicalEvents.total + 2, 'each accepted canonical intake contributes exactly one event');
    assert.equal(projection.canonicalEvents.lateOrReplayed, 'not-derived');
    assert.equal(projection.sla.status, 'unavailable');
    assert.equal(projection.routing.status, 'unavailable');
    assert.equal(isOperationalMetricProjectionFresh(projection, () => new Date('2026-09-11T11:59:59.999Z')), true);
    assert.equal(isOperationalMetricProjectionFresh(projection, () => new Date('2026-09-11T12:00:00.001Z')), false, 'a receipt becomes stale after its declared freshness window');

    // Deliberately collide the local ticket ID in tenant B: the scoped read must remain unchanged.
    await fixture.db.prepare(`INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source)
      VALUES (?,?,?,?,?,?,?)`).bind(
      fixture.principals.customerB.tenantId, ticketA, 'B one', 'open', 'normal', fixture.principals.customerB.email, 'api',
    ).run();
    const afterForeignWrite = await repository.currentWork();
    assert.deepEqual(afterForeignWrite.currentWork, projection.currentWork);
    assert.deepEqual(afterForeignWrite.canonicalEvents, projection.canonicalEvents);

    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO groups (tenant_id,id,name,description) VALUES (?,?,?,?)').bind(fixture.principals.operatorA.tenantId, 'metric-allowed', 'Metric allowed', null),
      fixture.db.prepare('INSERT INTO groups (tenant_id,id,name,description) VALUES (?,?,?,?)').bind(fixture.principals.operatorA.tenantId, 'metric-denied', 'Metric denied', null),
      fixture.db.prepare('INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,?,?)').bind(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, 'metric-allowed'),
      fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,group_id,source) VALUES (?,?,?,?,?,?,?,?)').bind(fixture.principals.operatorA.tenantId, 'metric-group-allowed', 'Allowed', 'open', 'normal', fixture.principals.customerA.email, 'metric-allowed', 'api'),
      fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,group_id,source) VALUES (?,?,?,?,?,?,?,?)').bind(fixture.principals.operatorA.tenantId, 'metric-group-denied', 'Denied', 'open', 'normal', fixture.principals.customerA.email, 'metric-denied', 'api'),
    ]);
    await fixture.db.prepare('UPDATE users SET role=? WHERE tenant_id=? AND id=?')
      .bind('agent', fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId).run();
    const agentScope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['agent'], 1);
    const agentProjection = await new OperationalMetricsRepository(fixture.db, agentScope).currentWork();
    assert.equal(agentProjection.currentWork.total, projection.currentWork.total + 1, 'current group membership includes only the allowed group');

    await assert.rejects(
      () => new OperationalMetricsRepository(fixture.db, createVerifiedTenantScope(fixture.principals.customerA.tenantId, fixture.principals.customerA.localId, ['customer'], 0)).currentWork(),
      OperationalMetricAccessError,
    );
  });
});

test('late recorded events are included on rebuild while a replay does not inflate the canonical denominator', async () => {
  await withTwoTenantFixture(async fixture => {
    const key = await fixture.createScopedApiKey('operatorA', ['tickets:write', 'tickets:read']);
    const created = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key.apiKey, idempotencyKey: 'metric-replay', body: { subject: 'A replay', customer_email: fixture.principals.customerA.email, body: 'synthetic' } });
    assert.equal(created.status, 201);
    const body = await created.json() as { id?: string; ticket?: { id?: string } };
    const ticketId = body.ticket?.id ?? body.id;
    assert.equal(typeof ticketId, 'string');
    const replay = await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key.apiKey, idempotencyKey: 'metric-replay', body: { subject: 'A replay', customer_email: fixture.principals.customerA.email, body: 'synthetic' } });
    assert.equal(replay.status, 201);
    await fixture.db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,sequence,kind,recorded_at,actor_kind,actor_id,actor_provenance,source,visibility,facts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      fixture.principals.operatorA.tenantId, 'metric-late-event', ticketId, 2, 'ticket.state_changed',
      '2000-01-01T00:00:00.000Z', 'staff', fixture.principals.operatorA.localId, 'mfa-staff', 'dashboard', 'internal', '{}',
    ).run();
    const scope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const projection = await new OperationalMetricsRepository(fixture.db, scope).currentWork();
    assert.equal(projection.canonicalEvents.total, 2, 'one intake plus one deliberately late persisted event; replay adds none');
    assert.notEqual(projection.canonicalEvents.latestRecordedAt, '2000-01-01T00:00:00.000Z');
  });
});

test('operational metrics fail closed after a role/session revocation and return bounded receipts', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const actorId = fixture.principals.operatorA.localId;
    const scope = createVerifiedTenantScope(tenantId, actorId, ['admin'], 0);
    const capped = new OperationalMetricsRepository(fixture.db, scope, () => new Date('2026-09-11T12:00:00.000Z'), {
      tenantTicketCandidates: 2, tenantEventCandidates: 2, assignees: 2,
    });
    for (const id of ['metric-cap-1', 'metric-cap-2']) {
      await fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES (?,?,?,?,?,?,?)')
        .bind(tenantId, id, id, 'open', 'normal', fixture.principals.customerA.email, 'api').run();
    }
    const ticketBound = await capped.currentWork();
    assert.equal(ticketBound.currentWork.status, 'truncated');
    assert.equal(ticketBound.currentWork.total, null, 'a ticket cap must not be presented as an exact tenant total');
    assert.equal(ticketBound.canonicalEvents.status, 'truncated');
    assert.equal(ticketBound.canonicalEvents.total, null);

    await fixture.db.prepare('UPDATE users SET role=? WHERE tenant_id=? AND id=?').bind('customer', tenantId, actorId).run();
    await assert.rejects(() => capped.currentWork(), OperationalMetricAccessError, 'a stale staff scope must not survive a live role/session revocation');
  });
});

test('canonical-event caps do not report a partial denominator', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const ticketId = 'fixture-ticket';
    for (const sequence of [1, 2]) {
      await fixture.db.prepare(`INSERT INTO conversation_events
        (tenant_id,id,ticket_id,sequence,kind,recorded_at,actor_kind,actor_id,actor_provenance,source,visibility,facts)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        tenantId, `metric-event-cap-${sequence}`, ticketId, sequence, 'ticket.state_changed',
        `2026-09-11T12:00:0${sequence}.000Z`, 'staff', fixture.principals.operatorA.localId,
        'mfa-staff', 'dashboard', 'internal', '{}',
      ).run();
    }
    const scope = createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const projection = await new OperationalMetricsRepository(fixture.db, scope, undefined, {
      tenantTicketCandidates: 10, tenantEventCandidates: 1, assignees: 10,
    }).currentWork();
    assert.equal(projection.currentWork.status, 'available');
    assert.equal(projection.canonicalEvents.status, 'truncated');
    assert.equal(projection.canonicalEvents.reason, 'tenant_event_candidate_cap_exceeded');
    assert.equal(projection.canonicalEvents.total, null, 'the event cap must not be presented as an exact denominator');
  });
});

test('one statement produces a coherent receipt when a canonical intake races the read', async () => {
  await withTwoTenantFixture(async fixture => {
    const key = await fixture.createScopedApiKey('operatorA', ['tickets:write', 'tickets:read']);
    const scope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const repository = new OperationalMetricsRepository(fixture.db, scope);
    const before = await repository.currentWork();
    const [response, raced] = await Promise.all([
      fixture.request('/api/v1/tickets', { method: 'POST', apiKey: key.apiKey, body: {
        subject: 'concurrent metric intake', customer_email: fixture.principals.customerA.email, body: 'synthetic',
      } }),
      repository.currentWork(),
    ]);
    assert.equal(response.status, 201);
    assert.equal(raced.currentWork.status, 'available');
    assert.equal(raced.canonicalEvents.status, 'available');
    const workDelta = raced.currentWork.total! - before.currentWork.total!;
    const eventDelta = raced.canonicalEvents.total! - before.canonicalEvents.total!;
    assert.ok(workDelta === 0 || workDelta === 1, 'the raced read observes one whole D1 snapshot');
    assert.equal(eventDelta, workDelta, 'ticket and canonical-event totals never combine different snapshots');
    const after = await repository.currentWork();
    assert.equal(after.currentWork.total, before.currentWork.total! + 1);
    assert.equal(after.canonicalEvents.total, before.canonicalEvents.total! + 1);
  });
});

test('tenant candidate caps bound sparse agent visibility before group filtering', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const actorId = fixture.principals.operatorA.localId;
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO groups (tenant_id,id,name,description) VALUES (?,?,?,?)').bind(tenantId, 'metric-hidden', 'Metric hidden', null),
      fixture.db.prepare('INSERT INTO groups (tenant_id,id,name,description) VALUES (?,?,?,?)').bind(tenantId, 'metric-visible', 'Metric visible', null),
      fixture.db.prepare('INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,?,?)').bind(tenantId, actorId, 'metric-visible'),
    ]);
    for (const id of ['a-hidden-1', 'a-hidden-2', 'a-hidden-3', 'a-hidden-4']) {
      await fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,group_id,source) VALUES (?,?,?,?,?,?,?,?)')
        .bind(tenantId, id, id, 'open', 'normal', fixture.principals.customerA.email, 'metric-hidden', 'api').run();
    }
    await fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,group_id,source) VALUES (?,?,?,?,?,?,?,?)')
      .bind(tenantId, 'z-visible', 'Visible', 'open', 'normal', fixture.principals.customerA.email, 'metric-visible', 'api').run();
    await fixture.db.prepare('UPDATE users SET role=? WHERE tenant_id=? AND id=?').bind('agent', tenantId, actorId).run();
    const agentScope = createVerifiedTenantScope(tenantId, actorId, ['agent'], 1);
    const capped = await new OperationalMetricsRepository(fixture.db, agentScope, undefined, {
      tenantTicketCandidates: 3, tenantEventCandidates: 10, assignees: 10,
    }).currentWork();
    assert.equal(capped.currentWork.status, 'truncated');
    assert.equal(capped.currentWork.reason, 'tenant_ticket_candidate_cap_exceeded');
    assert.equal(capped.currentWork.total, null);
    assert.deepEqual(capped.currentWork.byAssignee, [], 'a candidate-cap receipt exposes no hidden row detail');

    const complete = await new OperationalMetricsRepository(fixture.db, agentScope, undefined, {
      tenantTicketCandidates: 10, tenantEventCandidates: 10, assignees: 10,
    }).currentWork();
    assert.equal(complete.currentWork.status, 'available');
    assert.equal(complete.currentWork.total, 2, 'the ungrouped fixture and allowed group are counted when the tenant candidate set is complete');

    const ticketPlan = await fixture.db.prepare(`EXPLAIN QUERY PLAN
      SELECT id,assigned_to,status,group_id FROM tickets WHERE tenant_id=? ORDER BY id ASC LIMIT ?`)
      .bind(tenantId, 4).all<{ detail: string }>();
    const eventPlan = await fixture.db.prepare(`EXPLAIN QUERY PLAN
      SELECT ticket_id,recorded_at FROM conversation_events WHERE tenant_id=? ORDER BY ticket_id ASC,sequence ASC LIMIT ?`)
      .bind(tenantId, 4).all<{ detail: string }>();
    assert.ok((ticketPlan.results ?? []).some(row => row.detail.includes('COVERING INDEX idx_tickets_operational_metric_projection')));
    assert.ok((eventPlan.results ?? []).some(row => row.detail.includes('COVERING INDEX idx_conversation_events_operational_metric_projection')));
  });
});

test('freshness begins before the projection statement starts', async () => {
  await withTwoTenantFixture(async fixture => {
    let statementPrepared = false;
    const clock = () => new Date(statementPrepared ? '2026-09-11T12:05:00.000Z' : '2026-09-11T12:00:00.000Z');
    const db = { prepare(sql: string) { statementPrepared = true; return fixture.db.prepare(sql); } } as unknown as typeof fixture.db;
    const scope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const projection = await new OperationalMetricsRepository(db, scope, clock).currentWork();
    assert.equal(projection.asOf, '2026-09-11T12:00:00.000Z');
    assert.equal(projection.freshThrough, '2026-09-11T12:01:00.000Z');
  });
});
