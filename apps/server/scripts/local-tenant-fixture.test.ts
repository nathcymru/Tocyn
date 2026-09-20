import assert from 'node:assert/strict';
import test from 'node:test';
import { absoluteWindowHours, calculatePriorityScore, effectiveUrgencyWindowHours } from '@luminatick/shared';
import { projectPriorityClock, type PriorityClockRow } from '../src/repositories/priority-clock.repository';
import { initializeLocalBetaFixture } from './local-beta-fixture';
import { beta2ReviewPrioritySeeds, createLocalFixtureBootstrap, verifyTwoTenantFixture, withTwoTenantFixture } from './local-tenant-fixture';

test('two disposable fixture runs have independent A/B principals and no report secrets', async () => {
  const first = await verifyTwoTenantFixture();
  const second = await verifyTwoTenantFixture();
  assert.deepEqual({ ...first, elapsedMs: 0 }, { ...second, elapsedMs: 0 });
  assert.ok(first.elapsedMs >= 0 && second.elapsedMs >= 0);
  const report = JSON.stringify(first);
  assert.equal(report.includes('password'), false);
  assert.equal(report.includes('provisioning'), false);
  assert.equal(report.includes('lt_'), false);
});

test('fixture uses colliding local IDs only within separate tenant scopes and cleans up after a failed callback', async () => {
  const headerGlobal = globalThis as typeof globalThis & { Headers?: unknown };
  const originalHeaders = headerGlobal.Headers;
  await assert.rejects(withTwoTenantFixture(async fixture => {
    const shared = await fixture.db.prepare(`SELECT id, count(*) AS count, count(DISTINCT tenant_id) AS tenants
      FROM users WHERE id IN ('fixture-customer', 'fixture-operator') GROUP BY id ORDER BY id`).all<{ id: string; count: number; tenants: number }>();
    assert.deepEqual(shared.results, [
      { id: 'fixture-customer', count: 2, tenants: 2 },
      { id: 'fixture-operator', count: 2, tenants: 2 },
    ]);
    throw new Error('intentional fixture callback failure');
  }), /intentional fixture callback failure/);
  assert.equal(headerGlobal.Headers, originalHeaders, 'Fixture must restore global Headers after a failed callback');

  const recovered = await verifyTwoTenantFixture();
  assert.equal(recovered.cleanup, 'disposed');
  assert.equal(recovered.foreignKeyViolations, 0);
});

test('fixture exposes its callback-local R2 binding and named session revocation without secret reports', async () => {
  await withTwoTenantFixture(async fixture => {
    assert.deepEqual(fixture.r2.operationCounts(), { get: 0, put: 0, delete: 0, list: 0 });
    await fixture.r2.bucket.put('fixture/probe.txt', 'synthetic');
    assert.equal(await fixture.r2.bucket.get('fixture/probe.txt') !== null, true);
    await fixture.r2.bucket.delete('fixture/probe.txt');
    assert.deepEqual(fixture.r2.operationCounts(), { get: 1, put: 1, delete: 1, list: 0 });

    const login = await fixture.login('customerA');
    const { token } = await login.json<{ token: string }>();
    await fixture.revokePrincipalSessions('customerA');
    const denied = await fixture.request('/api/auth/me', { token });
    assert.equal(denied.status, 401);
  });
});

test('real local-beta bootstrap includes the classified review matrix', async () => {
  const bootstrap = await createLocalFixtureBootstrap({ MFA_ENCRYPTION_KEY: 'a'.repeat(64) }, { priorityReview: true });
  assert.equal([...bootstrap.sql.matchAll(/UPDATE tickets SET priority_category=/g)].length, 22,
    'The real review seed must classify all 20 tenant-A and two isolated tenant-B cases');
  assert.match(bootstrap.sql, /WHERE tenant_id='fixture-tenant-a' AND id='beta2-breach-billing'/);
  assert.match(bootstrap.sql, /WHERE tenant_id='fixture-tenant-b' AND id='beta2-b-email'/);
  assert.match(bootstrap.sql, /'fixture-tenant-a','fixture-operator',1,'all','priority_focus'/);
});

test('general Miniflare helper retains the eight-ticket base matrix without review-only SLA facts', async () => {
  await withTwoTenantFixture(async fixture => {
    const tickets = await fixture.db.prepare(`SELECT tenant_id, id, status, assigned_to, source, source_email
      FROM tickets WHERE id LIKE 'beta2-%' ORDER BY id`).all<{
      tenant_id: string; id: string; status: string; assigned_to: string | null; source: string; source_email: string | null;
    }>();
    assert.equal(tickets.results.length, 8);
    assert.deepEqual(tickets.results.map(ticket => ticket.id), [
      'beta2-b-email', 'beta2-b-open-unassigned', 'beta2-email', 'beta2-internal-attachment',
      'beta2-open-assigned', 'beta2-pending-unassigned', 'beta2-resolved', 'beta2-snoozed-assigned',
    ]);
    assert.equal(tickets.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-a').length, 6);
    assert.equal(tickets.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-b').length, 2);
    assert.equal(tickets.results.find(ticket => ticket.id === 'beta2-open-assigned')?.assigned_to, 'fixture-operator');
    assert.equal(tickets.results.find(ticket => ticket.id === 'beta2-pending-unassigned')?.assigned_to, null);
    assert.equal(tickets.results.find(ticket => ticket.id === 'beta2-email')?.source_email, 'support@synthetic.example.test');

    const articles = await fixture.db.prepare(`SELECT tenant_id, ticket_id, sender_type, body, snippet, is_internal, intake_source, raw_email_id
      FROM articles WHERE id LIKE 'beta2-%' ORDER BY id`).all<{
      tenant_id: string; ticket_id: string; sender_type: string; body: string; snippet: string | null; is_internal: number; intake_source: string; raw_email_id: string | null;
    }>();
    assert.equal(articles.results.length, 8);
    assert.ok(articles.results.every(article => article.snippet === article.body.substring(0, 250)), 'Every synthetic article has a bounded ticket-list preview');
    assert.deepEqual(articles.results.filter(article => article.is_internal === 1).map(article => article.ticket_id), ['beta2-internal-attachment']);
    assert.equal(articles.results.filter(article => article.intake_source === 'email').length, 2);
    assert.equal(articles.results.find(article => article.ticket_id === 'beta2-email')?.raw_email_id, 'beta2-email-raw');
    assert.equal(articles.results.find(article => article.ticket_id === 'beta2-email')?.snippet, 'Hello support,\n\nCould you explain the additional line item on my invoice?\n\nThanks.');
    assert.equal(articles.results.find(article => article.ticket_id === 'beta2-internal-attachment')?.snippet, 'Private handoff: verify the replacement address against the attached receipt.');

    const listFor = async (principal: 'operatorA' | 'operatorB') => {
      const login = await fixture.login(principal);
      assert.equal(login.status, 200);
      const challenge = await login.json<{ token: string }>();
      const verified = await fixture.request('/api/auth/mfa/verify', {
        method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(principal) },
      });
      assert.equal(verified.status, 200);
      const session = await verified.json<{ token: string }>();
      const response = await fixture.request('/api/tickets?limit=50', { token: session.token });
      assert.equal(response.status, 200);
      return (await response.json<{ data: Array<{ id: string; snippet: string | null }> }>()).data;
    };
    const tenantAList = await listFor('operatorA');
    const tenantBList = await listFor('operatorB');
    assert.equal(tenantAList.filter(ticket => ticket.id.startsWith('beta2-')).length, 6);
    assert.equal(tenantBList.filter(ticket => ticket.id.startsWith('beta2-')).length, 2);
    assert.ok(tenantAList.filter(ticket => ticket.id.startsWith('beta2-')).every(ticket => ticket.snippet));
    assert.ok(tenantBList.filter(ticket => ticket.id.startsWith('beta2-')).every(ticket => ticket.snippet));
    assert.equal(tenantAList.find(ticket => ticket.id === 'beta2-email')?.snippet, 'Hello support,\n\nCould you explain the additional line item on my invoice?\n\nThanks.');
    assert.equal(tenantAList.find(ticket => ticket.id === 'beta2-internal-attachment')?.snippet, 'Private handoff: verify the replacement address against the attached receipt.');
    assert.equal(tenantAList.some(ticket => ticket.id === 'beta2-b-email'), false);
    assert.equal(tenantBList.some(ticket => ticket.id === 'beta2-email'), false);

    const attachments = await fixture.db.prepare(`SELECT tenant_id, article_id, file_name, content_type, r2_key
      FROM attachments WHERE id LIKE 'beta2-%' ORDER BY id`).all<{
      tenant_id: string; article_id: string; file_name: string; content_type: string; r2_key: string;
    }>();
    assert.deepEqual(attachments.results, [
      { tenant_id: 'fixture-tenant-b', article_id: 'beta2-article-b-email', file_name: 'invoice.png', content_type: 'image/png', r2_key: 'fixture-tenant-b/beta2-b-email/invoice.png' },
      { tenant_id: 'fixture-tenant-a', article_id: 'beta2-article-internal', file_name: 'order-summary.pdf', content_type: 'application/pdf', r2_key: 'fixture-tenant-a/beta2-internal-attachment/order-summary.pdf' },
    ]);

    const snooze = await fixture.db.prepare(`SELECT snoozed_until, resurface_reason FROM ticket_support_state
      WHERE tenant_id = 'fixture-tenant-a' AND ticket_id = 'beta2-snoozed-assigned'`).first<{ snoozed_until: string; resurface_reason: string }>();
    assert.deepEqual(snooze, { snoozed_until: '2099-01-01T12:00:00.000Z', resurface_reason: 'manual' });
  });
});

test('opt-in local beta review has 20 tenant-A conversations, real SLA variety and tenant isolation', async () => {
  await withTwoTenantFixture(async fixture => {
    const reviewTickets = await fixture.db.prepare(`SELECT tenant_id,id,ticket_no,priority,status,assigned_to,source,customer_email
      FROM tickets WHERE id LIKE 'beta2-%' ORDER BY tenant_id,id`).all<{
      tenant_id: string; id: string; ticket_no: number; priority: string; status: string; assigned_to: string | null; source: string; customer_email: string;
    }>();
    assert.equal(reviewTickets.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-a').length, 20);
    assert.equal(reviewTickets.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-b').length, 2);
    assert.equal(new Set(reviewTickets.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-a').map(ticket => ticket.ticket_no)).size, 20);
    assert.deepEqual([...new Set(reviewTickets.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-a').map(ticket => ticket.priority))].sort(), ['high', 'low', 'normal', 'urgent']);
    assert.deepEqual([...new Set(reviewTickets.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-a').map(ticket => ticket.status))].sort(), ['closed', 'open', 'pending', 'resolved']);
    assert.deepEqual([...new Set(reviewTickets.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-a').map(ticket => ticket.source))].sort(), ['api', 'email', 'portal', 'web', 'widget']);
    const classified = await fixture.db.prepare(`SELECT tenant_id,id,created_at,priority_category,priority_scope,
      priority_regulatory_officer_on_site,priority_vip_blocked,priority_hard_deadline,priority_score,contract_sla_tier,criticality_tier
      FROM tickets WHERE id LIKE 'beta2-%' ORDER BY tenant_id,id`).all<{
      tenant_id:string;id:string;created_at:string;priority_category:string;priority_scope:string;
      priority_regulatory_officer_on_site:number;priority_vip_blocked:number;priority_hard_deadline:number;
      priority_score:number;contract_sla_tier:'alpha'|'bravo'|'charlie'|'delta';criticality_tier:1|2|3|4;
    }>();
    const tenantAClassified = classified.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-a');
    assert.equal(tenantAClassified.length, 20);
    assert.equal(classified.results.filter(ticket => ticket.tenant_id === 'fixture-tenant-b').length, 2);
    assert.deepEqual(new Set(tenantAClassified.map(ticket => `${ticket.contract_sla_tier}:${ticket.criticality_tier}`)).size, 16,
      'The review matrix exercises all 16 contract×criticality combinations');
    assert.deepEqual(new Set(tenantAClassified.map(ticket => ticket.priority_category)).size, 11,
      'Every approved category has a review example');
    for (const ticket of classified.results) {
      const flags = [ticket.priority_regulatory_officer_on_site,ticket.priority_vip_blocked,ticket.priority_hard_deadline];
      assert.ok(flags.every(flag => flag === 0 || flag === 1), `Complete urgency flags required for ${ticket.id}`);
      assert.equal(ticket.priority_score, calculatePriorityScore(ticket.priority_category as Parameters<typeof calculatePriorityScore>[0],
        ticket.priority_scope as Parameters<typeof calculatePriorityScore>[1],5*flags.reduce<number>((sum,flag)=>sum+flag,0)),ticket.id);
    }
    assert.equal(tenantAClassified.find(ticket => ticket.id === 'beta2-billing-urgent')?.priority_vip_blocked,1);
    assert.equal(tenantAClassified.find(ticket => ticket.id === 'beta2-billing-urgent')?.priority_hard_deadline,1);
    const priorityClocks = await fixture.db.prepare(`SELECT c.tenant_id,c.ticket_id,c.started_at,c.active_since,c.accrued_active_ms,
      c.stop_reason,c.last_support_state_revision,c.revision,c.updated_at,
      t.contract_sla_tier,t.criticality_tier,t.status,s.waiting_reason
      FROM ticket_priority_clocks c JOIN tickets t ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id
      JOIN ticket_support_state s ON s.tenant_id=c.tenant_id AND s.ticket_id=c.ticket_id
      WHERE c.ticket_id LIKE 'beta2-%' ORDER BY c.tenant_id,c.ticket_id`)
      .all<PriorityClockRow & { tenant_id:string;status:string;waiting_reason:string|null }>();
    const tenantAClocks = priorityClocks.results.filter(clock => clock.tenant_id === 'fixture-tenant-a');
    const tenantBClocks = priorityClocks.results.filter(clock => clock.tenant_id === 'fixture-tenant-b');
    assert.equal(tenantAClocks.length,20,'Every tenant-A review ticket has an authoritative priority clock');
    assert.equal(tenantBClocks.length,2,'Tenant-B clocks remain in their own tenant');
    assert.deepEqual(tenantBClocks.map(clock => clock.ticket_id),['beta2-b-email','beta2-b-open-unassigned']);
    assert.ok(tenantAClocks.every(clock => !tenantBClocks.some(foreign => foreign.ticket_id === clock.ticket_id)));
    const asOf = Date.now();
    const projected = new Map(priorityClocks.results.map(clock => [clock.ticket_id,projectPriorityClock(clock,asOf)]));
    assert.ok(priorityClocks.results.every(clock => projected.get(clock.ticket_id)), 'Every classified fixture clock projects');
    const remainingHours = (ticketId:string) => {
      const projection = projected.get(ticketId);
      assert.ok(projection,`Missing authoritative priority clock for ${ticketId}`);
      return projection.timeRemainingHours;
    };
    for (const id of ['beta2-breach-billing','beta2-breach-delivery']) {
      const ticket = tenantAClassified.find(candidate => candidate.id === id);
      assert.equal(ticket?.contract_sla_tier,'alpha');
      assert.equal(ticket?.criticality_tier,4);
      assert.ok(remainingHours(id)<0,`${id} must exceed its one-hour A4 window`);
      assert.equal(projected.get(id)?.paused,false,`${id} must still be actively accruing`);
    }
    assert.ok(tenantAClocks.filter(clock => clock.status === 'pending').length >= 2);
    for (const clock of tenantAClocks.filter(clock => clock.status === 'pending')) {
      if (clock.waiting_reason) {
        assert.equal(clock.stop_reason,'waiting',`${clock.ticket_id} must pause while waiting`);
        assert.equal(clock.active_since,null,`${clock.ticket_id} must have no running interval`);
        assert.equal(projected.get(clock.ticket_id)?.paused,true);
      } else {
        assert.equal(clock.stop_reason,null,`${clock.ticket_id} has no waiting reason`);
        assert.ok(clock.active_since,`${clock.ticket_id} remains actionable`);
        assert.equal(projected.get(clock.ticket_id)?.paused,false);
        assert.ok(remainingHours(clock.ticket_id)<absoluteWindowHours(clock.contract_sla_tier!,clock.criticality_tier!),
          `${clock.ticket_id} continues accruing while pending without a waiting reason`);
      }
    }
    assert.ok(tenantAClocks.filter(clock => clock.status === 'resolved' || clock.status === 'closed').length >= 2);
    for (const clock of tenantAClocks.filter(clock => clock.status === 'resolved' || clock.status === 'closed')) {
      assert.equal(clock.stop_reason,'resolved',`${clock.ticket_id} must stop after resolution`);
      assert.equal(clock.active_since,null,`${clock.ticket_id} must have no running interval`);
      assert.equal(projected.get(clock.ticket_id)?.paused,true);
    }
    assert.equal(tenantBClocks.find(clock => clock.ticket_id === 'beta2-b-email')?.stop_reason,null);
    assert.equal(tenantBClocks.find(clock => clock.ticket_id === 'beta2-b-open-unassigned')?.stop_reason,null);
    assert.equal(effectiveUrgencyWindowHours(48,remainingHours('beta2-api-update')),24);
    assert.equal(effectiveUrgencyWindowHours(48,remainingHours('beta2-security-question')),4);
    assert.equal(Object.keys(beta2ReviewPrioritySeeds).length,20);
    const articleCounts = await fixture.db.prepare(`SELECT ticket_id,count(*) AS count FROM articles WHERE tenant_id='fixture-tenant-a' AND ticket_id LIKE 'beta2-%' GROUP BY ticket_id`).all<{ticket_id:string;count:number}>();
    assert.equal(articleCounts.results.length, 20);
    assert.ok(articleCounts.results.every(row => row.count >= 1));
    assert.ok(articleCounts.results.filter(row => row.count >= 2).length >= 3);
    const waiting = await fixture.db.prepare(`SELECT definition_id,waiting_reason,next_action FROM ticket_support_state
      WHERE tenant_id='fixture-tenant-a' AND ticket_id='beta2-waiting-customer'`).first<{definition_id:string;waiting_reason:string;next_action:string}>();
    assert.equal(waiting?.definition_id, 'beta2-awaiting-customer');
    assert.ok(waiting?.waiting_reason && waiting.next_action);

    const policies = await fixture.db.prepare('SELECT tenant_id,response_target_ms,resolution_target_ms FROM sla_policies ORDER BY tenant_id')
      .all<{ tenant_id: string; response_target_ms: number; resolution_target_ms: number }>();
    assert.deepEqual(policies.results, [
      { tenant_id: 'fixture-tenant-a', response_target_ms: 21_600_000, resolution_target_ms: 86_400_000 },
      { tenant_id: 'fixture-tenant-b', response_target_ms: 21_600_000, resolution_target_ms: 86_400_000 },
    ]);
    const clocks = await fixture.db.prepare('SELECT tenant_id,ticket_id,response_started_at,response_due_at,response_completed_at,resolution_completed_at,policy_revision,policy_response_target_ms,policy_resolution_target_ms FROM ticket_sla_clocks ORDER BY tenant_id,ticket_id')
      .all<{ tenant_id: string; ticket_id: string; response_started_at: string; response_due_at: string | null; response_completed_at: string | null; resolution_completed_at: string | null; policy_revision: number; policy_response_target_ms: number | null; policy_resolution_target_ms: number | null }>();
    assert.equal(clocks.results.filter(clock => clock.tenant_id === 'fixture-tenant-a').length, 20);
    assert.equal(clocks.results.filter(clock => clock.tenant_id === 'fixture-tenant-b').length, 2);
    assert.ok(clocks.results.filter(clock => clock.response_due_at !== null).every(clock => Date.parse(clock.response_due_at!) - Date.parse(clock.response_started_at) === 21_600_000));
    const legacyClock = clocks.results.find(clock => clock.ticket_id === 'beta2-pending-unassigned');
    assert.deepEqual(legacyClock && [legacyClock.response_due_at, legacyClock.policy_revision, legacyClock.policy_response_target_ms, legacyClock.policy_resolution_target_ms],
      [null, 0, null, null], 'The unavailable ticket retains a targetless revision-0 snapshot predating the synthetic revision-1 policy');
    assert.ok(clocks.results.find(clock => clock.ticket_id === 'beta2-resolved')?.response_completed_at);
    assert.ok(clocks.results.find(clock => clock.ticket_id === 'beta2-resolved')?.resolution_completed_at);

    const session = async (principal: 'operatorA' | 'operatorB') => {
      const login = await fixture.login(principal);
      assert.equal(login.status, 200);
      const { token } = await login.json<{ token: string }>();
      const verified = await fixture.request('/api/auth/mfa/verify', {
        method: 'POST', token, body: { code: fixture.currentMfaCode(principal) },
      });
      assert.equal(verified.status, 200);
      return (await verified.json<{ token: string }>()).token;
    };
    const operatorA = await session('operatorA');
    const operatorB = await session('operatorB');
    const firstPage = await fixture.request('/api/tickets?limit=20', { token: operatorA });
    assert.equal(firstPage.status, 200);
    const listed = (await firstPage.json<{ data: Array<{ id: string }> }>()).data;
    assert.equal(listed.length, 20);
    assert.ok(listed.every(ticket => ticket.id.startsWith('beta2-')), 'The 20 review conversations all fit the first Inbox page');
    const batch = await fixture.request('/api/ticket-sla/projections', {
      method: 'POST', token: operatorA, body: { ticketIds: listed.map(ticket => ticket.id) },
    });
    assert.equal(batch.status, 200);
    const projections = await batch.json<Record<string, { response: { state: string } }>>();
    assert.equal(Object.keys(projections).length, 20, 'Every visible row has an SLA projection, including unavailable');
    assert.deepEqual(['beta2-breach-billing', 'beta2-breach-delivery'].map(id => projections[id]?.response.state), ['breached', 'breached']);
    assert.equal(projections['beta2-pending-unassigned']?.response.state, 'unavailable');
    const projection = async (token: string, id: string) => fixture.request(`/api/tickets/${id}/sla`, { token });
    const onTrack = await projection(operatorA, 'beta2-open-assigned');
    assert.equal(onTrack.status, 200);
    assert.equal((await onTrack.json<{ response: { state: string; phase: string } }>()).response.state, 'on-track');
    const breached = await projection(operatorA, 'beta2-email');
    assert.equal(breached.status, 200);
    assert.equal((await breached.json<{ response: { state: string; phase: string } }>()).response.state, 'breached');
    const completed = await projection(operatorA, 'beta2-resolved');
    assert.equal(completed.status, 200);
    assert.equal((await completed.json<{ response: { state: string; phase: string }; resolution: { phase: string } }>()).response.phase, 'completed');
    const unavailable = await projection(operatorA, 'beta2-pending-unassigned');
    assert.equal(unavailable.status, 200);
    assert.equal((await unavailable.json<{ response: { state: string }; resolution: { state: string } }>()).response.state, 'unavailable');
    for (const id of ['beta2-breach-billing', 'beta2-breach-delivery']) {
      const response = await projection(operatorA, id);
      assert.equal(response.status, 200);
      assert.equal((await response.json<{ response: { state: string } }>()).response.state, 'breached');
      assert.equal(reviewTickets.results.find(ticket => ticket.id === id)?.assigned_to, null);
    }
    const foreign = await projection(operatorA, 'beta2-b-open-unassigned');
    assert.equal(foreign.status, 404);
    const tenantB = await projection(operatorB, 'beta2-b-open-unassigned');
    assert.equal(tenantB.status, 200);
    assert.equal((await tenantB.json<{ response: { state: string } }>()).response.state, 'on-track');
  }, { reviewBeta2: true });
});

test('fresh local-beta runtime serves the classified priority-focus review matrix to tenant A', async () => {
  await withTwoTenantFixture(async fixture => {
    await initializeLocalBetaFixture(fixture, {
      runId: 'priority-review-http',
      tenants: [fixture.principals.operatorA.tenantId, fixture.principals.operatorB.tenantId],
      invitations: Object.values(fixture.principals).map(principal => ({
        tenantId: principal.tenantId,
        id: principal.localId,
        kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
      })),
      limits: { ticketLimit: 30, mutationLimit: 20, recoveryReserve: 2, uploadLimit: 2 },
    });
    await fixture.enableCombinedTicketAdmission();
    const login = await fixture.login('operatorA');
    assert.equal(login.status, 200);
    const challenge = await login.json<{ token: string }>();
    const verified = await fixture.request('/api/auth/mfa/verify', {
      method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode('operatorA') },
    });
    assert.equal(verified.status, 200);
    const { token } = await verified.json<{ token: string }>();
    const response = await fixture.request('/api/tickets?sort=priority_focus&limit=20', { token });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json<{
      data: Array<{ id: string; priority_category: string | null; priority_scope: string | null;
        contract_sla_tier: string | null; criticality_tier: number | null; priority_score: number | null }>;
      meta: { total: number; limit: number };
      priorityClocks: Record<string, { remainingHours: number; paused: boolean; asOf: string } | null>;
      triageOverdueCount: number;
      asOf: string;
    }>();
    assert.equal(body.meta.total, 20, 'The disposable review inbox contains exactly 20 classified tickets');
    assert.equal(body.meta.limit, 20);
    assert.equal(body.data.length, 20);
    assert.deepEqual(body.data.map(ticket => ticket.id).sort(), Object.keys(beta2ReviewPrioritySeeds).sort(),
      'The authenticated queue contains exactly the 20 tenant-A review tickets');
    assert.ok(body.data.every(ticket => ticket.priority_category && ticket.priority_scope
      && ticket.contract_sla_tier && ticket.criticality_tier && Number.isFinite(ticket.priority_score)));
    assert.ok(body.triageOverdueCount >= 2);
    assert.deepEqual(Object.keys(body.priorityClocks).sort(), body.data.map(ticket => ticket.id).sort());
    assert.ok(Object.values(body.priorityClocks).every(clock => clock && Number.isFinite(clock.remainingHours)
      && Number.isFinite(Date.parse(clock.asOf))));
    assert.ok(Number.isFinite(Date.parse(body.asOf)));
    for (const id of ['beta2-breach-billing', 'beta2-breach-delivery']) {
      assert.equal(body.data.find(ticket => ticket.id === id)?.contract_sla_tier, 'alpha');
      assert.equal(body.data.find(ticket => ticket.id === id)?.criticality_tier, 4);
      assert.ok(body.priorityClocks[id]!.remainingHours < 0, `${id} must be overdue`);
      assert.equal(body.priorityClocks[id]!.paused, false, `${id} must still be running`);
    }
    assert.equal(body.data.some(ticket => ticket.id === 'beta2-b-email' || ticket.id === 'beta2-b-open-unassigned'), false);
    assert.equal('beta2-b-email' in body.priorityClocks || 'beta2-b-open-unassigned' in body.priorityClocks, false);
  }, { reviewBeta2: true });
});
