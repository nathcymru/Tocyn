import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTwoTenantFixture, withTwoTenantFixture } from './local-tenant-fixture';

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

test('local beta seeds the deterministic eight-ticket queue and timeline matrix', async () => {
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
    assert.equal(articles.results.find(article => article.ticket_id === 'beta2-email')?.snippet, 'Email body\n\nThank you for checking this.');
    assert.equal(articles.results.find(article => article.ticket_id === 'beta2-internal-attachment')?.snippet, 'Internal handoff note for the synthetic case.');

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
    assert.equal(tenantAList.find(ticket => ticket.id === 'beta2-email')?.snippet, 'Email body\n\nThank you for checking this.');
    assert.equal(tenantAList.find(ticket => ticket.id === 'beta2-internal-attachment')?.snippet, 'Internal handoff note for the synthetic case.');
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
