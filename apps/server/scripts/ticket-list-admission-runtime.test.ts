import assert from 'node:assert/strict';
import test from 'node:test';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { ticketListEnvelope } from '../src/budgets/http-ticket-list-admission.service';
import { SqlTicketRepository } from '../src/repositories';
import { TicketListScanRepository } from '../src/repositories/ticket-list-scan.repository';
import { initializeLocalBetaFixture } from './local-beta-fixture';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';

type D1Observation = { rowsRead: number; rowsWritten: number };

/** Records native D1 metadata while preserving the real statements and batch snapshot. */
function observeDatabase(db: D1Database, observations: D1Observation[]): D1Database {
  type State = { raw: D1PreparedStatement };
  const states = new WeakMap<object, State>();
  const wrap = (raw: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(raw as object, { get(target, property) {
      if (property === 'bind') return (...values: unknown[]) => wrap((target as D1PreparedStatement).bind(...values));
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as D1PreparedStatement;
    states.set(proxy as object, { raw });
    return proxy;
  };
  return new Proxy(db as object, { get(target, property) {
    if (property === 'prepare') return (sql: string) => wrap((target as D1Database).prepare(sql));
    if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
      const raw = statements.map(statement => states.get(statement as object)?.raw ?? statement);
      const results = await (target as D1Database).batch(raw);
      for (const result of results) observations.push({ rowsRead: result.meta.rows_read ?? 0, rowsWritten: result.meta.rows_written ?? 0 });
      return results;
    };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } }) as D1Database;
}

async function widgetToken(fixture: LocalTenantFixture) {
  const customer = fixture.principals.customerA;
  assert.equal((await fixture.request('/api/v1/customer/auth/request', { method: 'POST',
    body: { email: customer.email, type: 'magic_link', widgetKey: customer.widgetKey } })).status, 200);
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const link = messages.find(message => message.to === customer.email)?.loginLink;
  assert.ok(link);
  const verified = await fixture.request('/api/v1/customer/auth/verify', { method: 'POST',
    body: { token: new URL(link).searchParams.get('token'), widgetKey: customer.widgetKey } });
  assert.equal(verified.status, 200);
  return (await verified.json<{ token: string }>()).token;
}

async function list(fixture: LocalTenantFixture, token: string) {
  const response = await fixture.request('/api/tickets?search=full-history-needle&limit=50', { token });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json<{ data: Array<{ id: string }>; meta: { total: number } }>();
}

test('ticket list keeps exact search results while current group authority applies with metering off and enabled', async t => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const agent = await fixture.createAgentSession(tenantId);
    const nonMember = await fixture.createAgentSession(tenantId);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO groups(tenant_id,id,name) VALUES(?,?,?)').bind(tenantId, 'list-visible-group', 'Visible'),
      fixture.db.prepare('INSERT INTO groups(tenant_id,id,name) VALUES(?,?,?)').bind(tenantId, 'list-hidden-group', 'Hidden'),
      fixture.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,group_id,source) VALUES(?,?,?,?,?,?,?)")
        .bind(tenantId, 'list-visible', 'Visible full-history-needle', fixture.principals.customerA.localId, fixture.principals.customerA.email, 'list-visible-group', 'fixture'),
      fixture.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,group_id,source) VALUES(?,?,?,?,?,?,?)")
        .bind(tenantId, 'list-hidden', 'Hidden full-history-needle', fixture.principals.customerA.localId, fixture.principals.customerA.email, 'list-hidden-group', 'fixture'),
      fixture.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,source) VALUES(?,?,?,?,?,?)")
        .bind(tenantId, 'list-ungrouped', 'Ungrouped full-history-needle', fixture.principals.customerA.localId, fixture.principals.customerA.email, 'fixture'),
      fixture.db.prepare('INSERT INTO user_groups(tenant_id,user_id,group_id) VALUES(?,?,?)').bind(tenantId, agent.id, 'list-visible-group'),
    ]);
    // Disabled budget policy retains the same current group boundary.
    let body = await list(fixture, agent.token);
    assert.deepEqual(body.data.map(ticket => ticket.id).sort(), ['list-ungrouped', 'list-visible']);
    assert.equal(body.meta.total, 2);
    body = await list(fixture, nonMember.token);
    assert.deepEqual(body.data.map(ticket => ticket.id), ['list-ungrouped']);
    assert.equal(body.meta.total, 1, 'a non-member cannot retain hidden rows or their total when metering is off');

    await initializeLocalBetaFixture(fixture, { runId: 'ticket-list-admission', tenants: [tenantId, fixture.principals.operatorB.tenantId],
      invitations: [...Object.values(fixture.principals).map(principal => ({ tenantId: principal.tenantId, id: principal.localId,
      kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const })), { tenantId, id: agent.id, kind: 'staff' },
      { tenantId, id: nonMember.id, kind: 'staff' }],
      limits: { ticketLimit: 2, mutationLimit: 8, recoveryReserve: 2, uploadLimit: 2 } });
    await fixture.enableCombinedTicketAdmission();
    body = await list(fixture, nonMember.token);
    assert.deepEqual(body.data.map(ticket => ticket.id), ['list-ungrouped']);
    assert.equal(body.meta.total, 1, 'a non-member cannot retain hidden rows or their total when metering is enabled');
    body = await list(fixture, agent.token);
    assert.deepEqual(body.data.map(ticket => ticket.id).sort(), ['list-ungrouped', 'list-visible']);
    assert.equal(body.meta.total, 2);

    const adminChallenge = await (await fixture.login('operatorA')).json<{ token: string }>();
    const admin = await (await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: adminChallenge.token,
      body: { code: fixture.currentMfaCode('operatorA') } })).json<{ token: string }>();
    const administrator = await list(fixture, admin.token);
    assert.deepEqual(administrator.data.map(ticket => ticket.id).sort(), ['list-hidden', 'list-ungrouped', 'list-visible']);
    assert.equal(administrator.meta.total, 3, 'administrator search keeps the exact full result set');

    const customer = await widgetToken(fixture);
    const portal = await fixture.request('/api/v1/customer/tickets?limit=50', { token: customer });
    assert.equal(portal.status, 200, await portal.clone().text());
    assert.equal((await portal.json<{ total: number }>()).total, 4, 'portal keeps all of the customer’s tickets');
    await fixture.db.prepare('DELETE FROM user_groups WHERE tenant_id=? AND user_id=? AND group_id=?').bind(tenantId, agent.id, 'list-visible-group').run();
    assert.equal((await fixture.request('/api/tickets?search=full-history-needle', { token: agent.token })).status, 401,
      'a revoked staff session is denied before list metadata or business work');
    t.diagnostic('real local D1: disabled/enabled group totals and customer current-credential list verified');
  });
});

test('tenant-maintained counters price a large same-tenant article history and fence the exact retained search', async t => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    for (let offset = 0; offset < 1_200; offset += 100) {
      await fixture.db.batch(Array.from({ length: 100 }, (_, item) => fixture.db.prepare(
        "INSERT INTO articles(tenant_id,id,ticket_id,sender_type,body,is_internal,intake_source) VALUES(?,?,?,?,?,?,?)")
        .bind(tenantId, `list-history-${offset + item}`, 'fixture-ticket', 'customer', `historical row ${offset + item}`, 0, 'fixture')));
    }
    await fixture.db.prepare("INSERT INTO articles(tenant_id,id,ticket_id,sender_type,body,is_internal,intake_source) VALUES(?,?,?,?,?,?,?)")
      .bind(tenantId, 'list-history-needle', 'fixture-ticket', 'customer', 'full-history-needle is retained', 0, 'fixture').run();
    const scope = createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 1);
    const scans = new TicketListScanRepository(fixture.db, scope);
    const snapshot = await scans.snapshot();
    assert.ok(snapshot.articleRows >= 1_201);
    assert.ok(snapshot.articleSearchBytes >= 1_200 * 'historical row 0'.length);
    const envelope = ticketListEnvelope(snapshot, { search: 'full-history-needle', groupRestricted: false });
    assert.ok(envelope?.d1RowsRead && envelope.d1RowsRead > snapshot.articleRows * 2,
      'the reservation grows with actual retained article count and bytes; it is not a fixed candidate cap');
    const observations: D1Observation[] = [];
    const result = await new SqlTicketRepository(scope, observeDatabase(fixture.db, observations)).list({ page: 1, limit: 50, search: 'full-history-needle',
      viewer: { role: 'admin', actorId: scope.actorId }, scanFence: snapshot });
    assert.equal(result.total, 1);
    assert.deepEqual(result.data.map(ticket => ticket.id), ['fixture-ticket']);
    const counter = await fixture.db.prepare('SELECT ticket_rows,article_rows,article_search_bytes FROM ticket_list_scan_counters WHERE tenant_id=?')
      .bind(tenantId).first<{ ticket_rows: number; article_rows: number; article_search_bytes: number }>();
    assert.deepEqual(counter, { ticket_rows: snapshot.ticketRows, article_rows: snapshot.articleRows, article_search_bytes: snapshot.articleSearchBytes });
    const actualReads = observations.reduce((total, observation) => total + observation.rowsRead, 0);
    assert.equal(observations.length, 3, 'fence, exact count and page share one native D1 batch');
    assert.ok(actualReads > 0 && actualReads <= envelope!.d1RowsRead!, `actual native reads ${actualReads} fit admitted ${envelope!.d1RowsRead}`);
    t.diagnostic(`real local D1: ${snapshot.articleRows} same-tenant article rows, exact total ${result.total}, actual reads ${actualReads}, admitted reads ${envelope!.d1RowsRead}`);
  });
});
