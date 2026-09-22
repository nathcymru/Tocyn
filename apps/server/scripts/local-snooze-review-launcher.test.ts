import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import * as OTPAuth from 'otpauth';
import { createReviewDisposal, startIsolatedSnoozeReview } from './local-snooze-review-launcher';

async function sparePort(): Promise<number> {
  for (;;) {
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') reject(new Error('Expected loopback TCP port'));
        else resolve(address.port);
      });
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (port !== 8787) return port;
  }
}

async function operatorToken(origin: string, credential: { email: string; password: string; provisioningUri?: string }): Promise<string> {
  assert.ok(credential.provisioningUri);
  const login = await fetch(`${origin}/api/auth/login`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: credential.email, password: credential.password }) });
  assert.equal(login.status, 200);
  const challenge = await login.json() as { token: string; mfa_required: boolean };
  assert.equal(challenge.mfa_required, true);
  const code = OTPAuth.URI.parse(credential.provisioningUri);
  assert.ok(code instanceof OTPAuth.TOTP);
  const verified = await fetch(`${origin}/api/auth/mfa/verify`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${challenge.token}` },
    body: JSON.stringify({ code: code.generate() }) });
  assert.equal(verified.status, 200);
  const session = await verified.json() as { token: string };
  assert.ok(session.token);
  return session.token;
}

test('launcher rejects the existing review port and unbounded authority windows before setup', async () => {
  await assert.rejects(startIsolatedSnoozeReview({ port: 8787, intervalWindowMs: 60_000 }));
  await assert.rejects(startIsolatedSnoozeReview({ port: 5176, intervalWindowMs: 60_000 }));
  await assert.rejects(startIsolatedSnoozeReview({ port: 8790, intervalWindowMs: 86_400_001 }));
});

test('a throwing RPC disposer does not skip runtime and file cleanup and remains retryable', async () => {
  const calls: string[] = [];
  const failure = new Error('synthetic RPC disposal failure');
  let failRpc = true;
  const dispose = createReviewDisposal({
    controller: async () => { calls.push('controller'); },
    rpc: () => { calls.push('rpc'); if (failRpc) throw failure; },
    runtime: async () => { calls.push('runtime'); },
    files: async () => { calls.push('files'); },
  });
  await assert.rejects(dispose(), error => error === failure);
  assert.deepEqual(calls, ['controller', 'rpc', 'runtime', 'files']);
  failRpc = false;
  await dispose();
  await dispose();
  assert.deepEqual(calls, ['controller', 'rpc', 'runtime', 'files', 'rpc']);
});

test('isolated one-owner review launcher serves authenticated app and wakes private due work without a route', async () => {
  const port = await sparePort();
  const scheduler = { set(callback: () => void, requestedMs: number) {
    assert.equal(requestedMs, 60_000);
    return setTimeout(callback, 80);
  }, clear(handle: unknown) { clearTimeout(handle as NodeJS.Timeout); } };
  const review = await startIsolatedSnoozeReview({ port, intervalWindowMs: 60_000, scheduler });
  try {
    for (const [tenant, expectedCount] of [['fixture-tenant-a', 21], ['fixture-tenant-b', 3]] as const) {
      const matrix = await review.db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN priority_category IS NULL OR priority_scope IS NULL OR contract_sla_tier IS NULL
          OR criticality_tier IS NULL THEN 1 ELSE 0 END) AS unclassified
        FROM tickets WHERE tenant_id=?`).bind(tenant).first<{ total: number; unclassified: number }>();
      assert.deepEqual(matrix, { total: expectedCount, unclassified: 0 },
        'the specialist runtime retains a complete synthetic priority matrix');
      const due = await review.db.prepare(`SELECT ticket_no,priority_category,priority_scope,priority_regulatory_officer_on_site,
        priority_vip_blocked,priority_hard_deadline,priority_score,contract_sla_tier,criticality_tier
        FROM tickets WHERE tenant_id=? AND id='due-review'`).bind(tenant).first();
      assert.deepEqual(due, { ticket_no: 901, priority_category: 'status-follow-up', priority_scope: 'isolated',
        priority_regulatory_officer_on_site: 0, priority_vip_blocked: 0, priority_hard_deadline: 0,
        priority_score: 4, contract_sla_tier: 'delta', criticality_tier: 1 });
      const article = await review.db.prepare("SELECT sender_type,body,snippet FROM articles WHERE tenant_id=? AND ticket_id='due-review'")
        .bind(tenant).all<{ sender_type: string; body: string; snippet: string }>();
      assert.equal(article.results.length, 1);
      assert.equal(article.results[0].sender_type, 'customer');
      assert.ok(article.results[0].body);
      assert.ok(article.results[0].snippet);
      const clock = await review.db.prepare("SELECT started_at,accrued_active_ms FROM ticket_priority_clocks WHERE tenant_id=? AND ticket_id='due-review'")
        .bind(tenant).first<{ started_at: string; accrued_active_ms: number }>();
      assert.ok(clock);
      assert.ok(clock.started_at);
      assert.equal(clock.accrued_active_ms, 0);
    }
    const health = await fetch(`${review.origin}/health`);
    assert.equal(health.status, 200);
    await health.body?.cancel();
    const eventsBeforeDeniedRoute = (await review.db.prepare(
      "SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-a'",
    ).first<{ n: number }>())?.n ?? 0;
    const privateRoute = await fetch(`${review.origin}/runDue`);
    assert.ok([404, 503].includes(privateRoute.status), 'private due RPC has no successful HTTP route');
    await privateRoute.body?.cancel();
    assert.equal((await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-a'")
      .first<{ n: number }>())?.n, eventsBeforeDeniedRoute, 'the denied HTTP request cannot run due work');

    const operatorA = review.credentials.find(credential => credential.email === 'fixture.operator.a@example.test');
    const operatorB = review.credentials.find(credential => credential.email === 'fixture.operator.b@example.test');
    assert.ok(operatorA && operatorB);
    const tokenA = await operatorToken(review.origin, operatorA);
    const tokenB = await operatorToken(review.origin, operatorB);
    type DueDetail = { id: string; ticket_no: number; customer_email: string; priority_score: number;
      contract_sla_tier: string; criticality_tier: number; articles: Array<{ body: string; snippet: string; sender_type: string }> };
    const readDue = async (token: string): Promise<DueDetail> => {
      const response = await fetch(`${review.origin}/api/tickets/due-review`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      return response.json() as Promise<DueDetail>;
    };
    const dueA = await readDue(tokenA);
    const dueB = await readDue(tokenB);
    for (const detail of [dueA, dueB]) {
      assert.equal(detail.id, 'due-review');
      assert.equal(detail.ticket_no, 901);
      assert.equal(detail.priority_score, 4);
      assert.equal(detail.contract_sla_tier, 'delta');
      assert.equal(detail.criticality_tier, 1);
      assert.equal(detail.articles.length, 1);
      assert.equal(detail.articles[0].sender_type, 'customer');
      assert.ok(detail.articles[0].snippet);
    }
    assert.equal(dueA.customer_email, 'tocyn-auth-test-a@example.invalid');
    assert.match(dueA.articles[0].body, /delivery update/);
    assert.doesNotMatch(dueA.articles[0].body, /account update/);
    assert.equal(dueB.customer_email, 'tocyn-auth-test-b@example.invalid');
    assert.match(dueB.articles[0].body, /account update/);
    assert.doesNotMatch(dueB.articles[0].body, /delivery update/);
    const queue = async (token: string, name: 'snoozed' | 'actionable') => {
      const response = await fetch(`${review.origin}/api/tickets?queue=${name}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200, `${name} queue should be available to its operator`);
      const body = await response.json() as { data: Array<{ id: string; inclusion_reason: string }>; meta: { total: number } };
      return { total: body.meta.total, items: body.data.map(ticket => [ticket.id, ticket.inclusion_reason] as const) };
    };
    const counts = async (token: string) => {
      const response = await fetch(`${review.origin}/api/tickets/queue-counts`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200, 'standard queue counts should be available to its operator');
      const body = await response.json() as { scope: string; counts: Record<string, number> };
      assert.equal(body.scope, 'standard_queues');
      return { all: body.counts.all, actionable: body.counts.actionable, snoozed: body.counts.snoozed };
    };
    const beforeQueuesA = { snoozed: await queue(tokenA, 'snoozed'), actionable: await queue(tokenA, 'actionable'), counts: await counts(tokenA) };
    const beforeQueuesB = { snoozed: await queue(tokenB, 'snoozed'), actionable: await queue(tokenB, 'actionable'), counts: await counts(tokenB) };
    assert.ok(beforeQueuesA.snoozed.items.some(([id, reason]) => id === 'due-review' && reason === 'snoozed'));
    assert.ok(!beforeQueuesA.actionable.items.some(([id]) => id === 'due-review'));
    assert.ok(beforeQueuesB.snoozed.items.some(([id, reason]) => id === 'due-review' && reason === 'snoozed'));
    assert.ok(!beforeQueuesB.actionable.items.some(([id]) => id === 'due-review'));
    // Change only this disposable run's deadline after its first due cycle.
    await review.db.prepare("UPDATE ticket_support_state SET snoozed_until=? WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review'")
      .bind(new Date(Date.now() + 300).toISOString()).run();
    const deadline = Date.now() + 5_000;
    let events = 0;
    while (Date.now() < deadline) {
      events = (await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review' AND kind='ticket.transition'")
        .first<{ n: number }>())?.n ?? 0;
      if (events === 1) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(events, 1, 'host timer must invoke private due RPC without a test tick');
    assert.deepEqual(await review.db.prepare("SELECT snoozed_until,resurface_reason FROM ticket_support_state WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review'").first(),
      { snoozed_until: null, resurface_reason: 'due' });
    const afterSnoozedA = await queue(tokenA, 'snoozed');
    const afterActionableA = await queue(tokenA, 'actionable');
    const afterCountsA = await counts(tokenA);
    assert.ok(!afterSnoozedA.items.some(([id]) => id === 'due-review'));
    assert.ok(afterActionableA.items.some(([id, reason]) => id === 'due-review' && reason === 'actionable'));
    assert.deepEqual(afterCountsA, { all: beforeQueuesA.counts.all,
      actionable: beforeQueuesA.counts.actionable + 1, snoozed: beforeQueuesA.counts.snoozed - 1 });
    assert.deepEqual(await queue(tokenB, 'snoozed'), beforeQueuesB.snoozed);
    assert.deepEqual(await queue(tokenB, 'actionable'), beforeQueuesB.actionable);
    assert.deepEqual(await counts(tokenB), beforeQueuesB.counts);
    assert.equal((await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-b' AND ticket_id='due-review' AND kind='ticket.transition'")
      .first<{ n: number }>())?.n, 0, 'same ticket ID in tenant B remains isolated');
    assert.ok((await review.db.prepare("SELECT snoozed_until FROM ticket_support_state WHERE tenant_id='fixture-tenant-b' AND ticket_id='due-review'")
      .first<{ snoozed_until: string | null }>())?.snoozed_until);
  } finally {
    await review.dispose();
  }
});

test('isolated restart recovers the due marker and persisted tenant-scoped D1 state', async () => {
  const port = await sparePort();
  const scheduler = { set(_callback: () => void, requestedMs: number) {
    assert.equal(requestedMs, 60_000);
    return 1;
  }, clear(_handle: unknown) {} };
  const review = await startIsolatedSnoozeReview({ port, intervalWindowMs: 60_000, scheduler });
  try {
    assert.deepEqual(review.dueSnapshot().map(row => row.status), ['ready', 'ready']);
    await review.db.prepare("UPDATE ticket_support_state SET snoozed_until=? WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review'")
      .bind(new Date(Date.now() - 1_000).toISOString()).run();
    await review.restart();
    assert.equal((await fetch(`${review.origin}/health`)).status, 200);
    assert.deepEqual(review.dueSnapshot().map(row => row.status), ['ready', 'ready'],
      'restart must read and recover its persisted due marker');
    assert.deepEqual(await review.db.prepare("SELECT snoozed_until,resurface_reason FROM ticket_support_state WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review'").first(),
      { snoozed_until: null, resurface_reason: 'due' });
    assert.equal((await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review' AND kind='ticket.transition'")
      .first<{ n: number }>())?.n, 1);
    assert.ok((await review.db.prepare("SELECT snoozed_until FROM ticket_support_state WHERE tenant_id='fixture-tenant-b' AND ticket_id='due-review'")
      .first<{ snoozed_until: string | null }>())?.snoozed_until);
    assert.equal((await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-b' AND ticket_id='due-review' AND kind='ticket.transition'")
      .first<{ n: number }>())?.n, 0);
    await review.restart();
    assert.equal((await review.db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='fixture-tenant-a' AND ticket_id='due-review' AND kind='ticket.transition'")
      .first<{ n: number }>())?.n, 1, 'a second recovery must not resurface the same ticket twice');
  } finally {
    await review.dispose();
  }
});
