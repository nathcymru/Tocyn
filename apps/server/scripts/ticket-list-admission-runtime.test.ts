import { TicketQueueCountsRepository } from '../src/repositories/ticket-queue-counts.repository';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { ticketListEnvelope } from '../src/budgets/http-ticket-list-admission.service';
import { SqlTicketRepository } from '../src/repositories';
import { TicketListScanError, TicketListScanRepository } from '../src/repositories/ticket-list-scan.repository';
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
    const settlements:{operationId:string;outcome:string}[]=[];
    const originalSettle=apiTicketBudgetCache.settleOperation.bind(apiTicketBudgetCache);
    apiTicketBudgetCache.settleOperation=(authority,outcome,now)=>{settlements.push({operationId:authority.operationId,outcome});originalSettle(authority,outcome,now);};
    try {body = await list(fixture, nonMember.token);} finally {apiTicketBudgetCache.settleOperation=originalSettle;}
    assert.equal(settlements.length,1);assert.equal(settlements[0].outcome,'committed');
    assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM budget_grant_operations WHERE operation_id=?').bind(settlements[0].operationId).first<{n:number}>())?.n,1);
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
    const beforeFailed=(await fixture.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())!.n;
    const originalList=SqlTicketRepository.prototype.list;settlements.length=0;
    apiTicketBudgetCache.settleOperation=(authority,outcome,now)=>{settlements.push({operationId:authority.operationId,outcome});originalSettle(authority,outcome,now);};
    SqlTicketRepository.prototype.list=async function(options){
      await fixture.db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' '").run();
      return originalList.call(this,options);
    };
    try {assert.equal((await fixture.request('/api/tickets',{token:admin.token})).status,503);}
    finally {SqlTicketRepository.prototype.list=originalList;apiTicketBudgetCache.settleOperation=originalSettle;}
    assert.deepEqual(settlements.map(item=>item.outcome),['unknown']);
    assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())!.n,beforeFailed);
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

test('admitted list count/page rejects a session or saved-filter revision changed after admission', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const scope = createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 1);
    await fixture.db.prepare("INSERT INTO ticket_filters(tenant_id,id,name,conditions) VALUES(?,?,?,?)")
      .bind(tenantId, 'list-fence-filter', 'fence', JSON.stringify([{ field: 'status', operator: 'equals', value: 'open' }])).run();
    const snapshot = await new TicketListScanRepository(fixture.db, scope).snapshot('list-fence-filter');
    const repository = new SqlTicketRepository(scope, fixture.db);
    await fixture.db.prepare('UPDATE users SET session_version=999 WHERE tenant_id=? AND id=?')
      .bind(tenantId, scope.actorId).run();
    await assert.rejects(repository.list({ page: 1, limit: 50, filterId: 'list-fence-filter', scanFence: snapshot,
      viewer: { role: 'admin', actorId: scope.actorId }, currentCredential: { role: 'admin', sessionVersion: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 3600 } }), (error: unknown) => error instanceof TicketListScanError && error.code === 'authority_changed');
    await fixture.db.prepare('UPDATE users SET session_version=1 WHERE tenant_id=? AND id=?').bind(tenantId, scope.actorId).run();
    await fixture.db.prepare('UPDATE ticket_filters SET conditions=? WHERE tenant_id=? AND id=?')
      .bind(JSON.stringify([{ field: 'status', operator: 'equals', value: 'open' }, { field: 'priority', operator: 'equals', value: 'high' }]), tenantId, 'list-fence-filter').run();
    await assert.rejects(repository.list({ page: 1, limit: 50, filterId: 'list-fence-filter', scanFence: snapshot,
      viewer: { role: 'admin', actorId: scope.actorId }, currentCredential: { role: 'admin', sessionVersion: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 3600 } }), (error: unknown) => error instanceof TicketListScanError && error.code === 'fence_changed');
  });
});

test('many current group-visible tickets, saved filters, and an all-miss substring stay within the dynamic reservation', async t => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const agent = await fixture.createAgentSession(tenantId);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO groups(tenant_id,id,name) VALUES(?,?,?)').bind(tenantId, 'list-scale-group', 'Scale'),
      fixture.db.prepare('INSERT INTO user_groups(tenant_id,user_id,group_id) VALUES(?,?,?)').bind(tenantId, agent.id, 'list-scale-group'),
      fixture.db.prepare('INSERT INTO ticket_filters(tenant_id,id,name,conditions) VALUES(?,?,?,?)').bind(tenantId, 'list-scale-filter', 'scale', JSON.stringify([{ field: 'status', operator: 'equals', value: 'open' }])),
    ]);
    for (let offset = 0; offset < 10_000; offset += 100) {
      await fixture.db.batch(Array.from({ length: 100 }, (_, index) => fixture.db.prepare(
        "INSERT INTO tickets(tenant_id,id,subject,customer_email,group_id,source,status) VALUES(?,?,?,?,?,?,?)")
        .bind(tenantId, `list-scale-${String(offset + index).padStart(5, '0')}`, 'scale candidate', fixture.principals.customerA.email, 'list-scale-group', 'fixture', 'open')));
    }
    const scope = createVerifiedTenantScope(tenantId, agent.id, ['agent'], 1);
    const snapshot = await new TicketListScanRepository(fixture.db, scope).snapshot('list-scale-filter');
    const envelope = ticketListEnvelope(snapshot, { search: 'all-miss-substring', groupRestricted: true });
    const observations: D1Observation[] = [];
    const result = await new SqlTicketRepository(scope, observeDatabase(fixture.db, observations)).list({ page: 1, limit: 50,
      search: 'all-miss-substring', filterId: 'list-scale-filter', viewer: { role: 'agent', actorId: agent.id }, scanFence: snapshot,
      currentCredential: { role: 'agent', sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
    assert.equal(result.total, 0);
    const actualReads = observations.reduce((total, observation) => total + observation.rowsRead, 0);
    assert.equal(observations.length, 3);
    const boundFailures:string[]=[];
    if(!(actualReads > 0 && actualReads <= envelope!.d1RowsRead!)) boundFailures.push(`existing group/filter/all-miss reads ${actualReads} exceed ${envelope!.d1RowsRead}`);
    t.diagnostic(`real local D1: ${snapshot.ticketRows} tickets, group/filter all-miss reads ${actualReads}, admitted ${envelope!.d1RowsRead}`);
    // Measure the added finite predicates beyond the fixed reserve; no queue surcharge is assumed.
    for(const queue of ['unassigned','mine'] as const) {
      if(queue==='mine') await fixture.db.prepare('UPDATE tickets SET assigned_to=? WHERE tenant_id=?').bind(agent.id,tenantId).run();
      const queueSnapshot=await new TicketListScanRepository(fixture.db,scope).snapshot('list-scale-filter');
      const queueEnvelope=ticketListEnvelope(queueSnapshot,{groupRestricted:true,queue});
      const queueObservations:D1Observation[]=[];
      const page=await new SqlTicketRepository(scope,observeDatabase(fixture.db,queueObservations)).list({queue,
        page:1,limit:50,filterId:'list-scale-filter',viewer:{role:'agent',actorId:agent.id},scanFence:queueSnapshot});
      assert.equal(page.total,10001);
      const reads=queueObservations.reduce((sum,item)=>sum+item.rowsRead,0);
      t.diagnostic(`${queue}: ${queueSnapshot.ticketRows} candidates, ${reads} native reads, ${queueEnvelope!.d1RowsRead} reserved`);
      if(reads>queueEnvelope!.d1RowsRead!) boundFailures.push(`${queue} reads ${reads} exceed ${queueEnvelope!.d1RowsRead}`);
    }
    const countSnapshot=await new TicketListScanRepository(fixture.db,scope).snapshot();
    const countObservations:D1Observation[]=[];
    const totals=await new TicketQueueCountsRepository(observeDatabase(fixture.db,countObservations),scope).counts({snapshot:countSnapshot,
      credential:{role:'agent',sessionVersion:1,expiresAt:Math.floor(Date.now()/1000)+3600}});
    assert.equal(totals.counts.all,10001);assert.equal(totals.counts.mine,10001);assert.equal(totals.counts.unassigned,0);
    const countReads=countObservations.reduce((sum,item)=>sum+item.rowsRead,0);
    const countEnvelope=ticketListEnvelope(countSnapshot,{groupRestricted:true,aggregateCounts:true})!;
    assert.ok(countReads>0&&countReads<=countEnvelope.d1RowsRead!);
    t.diagnostic(`aggregate standard queues: ${countSnapshot.ticketRows} candidates, ${countReads} native read rows, ${countEnvelope.d1RowsRead} reserved`);
    assert.deepEqual(boundFailures,[]);
  });
});

test('authenticated Drafts queue preserves production-like retention and applies only explicitly enabled local expiry', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId=fixture.principals.operatorA.tenantId;
    const agent=await fixture.createAgentSession(tenantId);
    const colleague=await fixture.createAgentSession(tenantId);
    await fixture.db.batch([
      fixture.db.prepare("INSERT INTO tickets(tenant_id,id,subject,status,customer_email,source) VALUES(?, 'draft-old','Old saved draft','open','synthetic@example.invalid','fixture')").bind(tenantId),
      fixture.db.prepare("INSERT INTO operator_drafts(tenant_id,user_id,ticket_id,generation,revision,mode,body,attachments,base_conversation_revision,updated_at,expires_at) VALUES(?,?, 'fixture-ticket',?,1,'internal','Synthetic own draft','[]',0,'2000-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')").bind(tenantId,agent.id,crypto.randomUUID()),
      fixture.db.prepare("INSERT INTO operator_drafts(tenant_id,user_id,ticket_id,generation,revision,mode,body,attachments,base_conversation_revision,updated_at,expires_at) VALUES(?,?, 'draft-old',?,1,'internal','Synthetic old draft','[]',0,'2000-01-01T00:00:00.000Z',NULL)").bind(tenantId,agent.id,crypto.randomUUID()),
    ]);
    const read=async(token:string)=>{
      const response=await fixture.request('/api/tickets?queue=drafts',{token});
      assert.equal(response.status,200);
      return response.json<{data:Array<{id:string;inclusion_reason:string}>;meta:{total:number}}>();
    };
    let result=await read(agent.token);
    assert.equal(result.meta.total,2,'no local retention is inferred when local beta is off');
    assert.ok(result.data.every(item=>item.inclusion_reason==='drafts'));
    assert.equal((await read(colleague.token)).meta.total,0,'another authenticated operator receives no own-draft matches');
    const customer=await fixture.login('customerA');
    const customerToken=(await customer.json<{token:string}>()).token;
    assert.equal((await fixture.request('/api/tickets?queue=drafts',{token:customerToken})).status,403);
    const key=await fixture.createScopedApiKey('operatorA',['tickets:read']);
    assert.notEqual((await fixture.request('/api/tickets?queue=drafts',{headers:{'X-API-Key':key.apiKey}})).status,200);
    assert.notEqual((await fixture.request('/api/tickets?queue=drafts')).status,200);

    await initializeLocalBetaFixture(fixture,{runId:'draft-queue-admission',tenants:[tenantId,fixture.principals.operatorB.tenantId],
      invitations:[...Object.values(fixture.principals).map(principal=>({tenantId:principal.tenantId,id:principal.localId,kind:principal.role==='customer'?'customer' as const:'staff' as const})),
        {tenantId,id:agent.id,kind:'staff'},{tenantId,id:colleague.id,kind:'staff'}],
      limits:{ticketLimit:2,mutationLimit:8,recoveryReserve:2,uploadLimit:2}});
    await fixture.enableCombinedTicketAdmission();
    result=await read(agent.token);
    assert.deepEqual(result.data.map(item=>item.id),['fixture-ticket']);
    assert.equal(result.meta.total,1);
    assert.equal((await read(colleague.token)).meta.total,0);
    assert.equal((await fixture.db.prepare('SELECT COUNT(*) AS total FROM operator_drafts WHERE tenant_id=? AND user_id=?').bind(tenantId,agent.id).first<{total:number}>())?.total,2,
      'the queue read filters local expiry without deleting stored drafts');
    await fixture.db.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND id=?").bind(tenantId,agent.id).run();
    assert.notEqual((await fixture.request('/api/tickets?queue=drafts',{token:agent.token})).status,200);
  });
});

test('Mine and Unassigned HTTP queues require a current operator and bind Mine independently of caller filters',async()=>{
  await withTwoTenantFixture(async fixture=>{
    const tenantId=fixture.principals.operatorA.tenantId;
    const agent=await fixture.createAgentSession(tenantId);
    const colleague=await fixture.createAgentSession(tenantId);
    const read=async(queue:string,token:string,extra='')=>{
      const response=await fixture.request(`/api/tickets?queue=${queue}${extra}`,{token});
      assert.equal(response.status,200);return response.json<{data:Array<{id:string;inclusion_reason:string}>;meta:{total:number}}>();
    };
    assert.equal((await read('unassigned',agent.token)).meta.total,1);
    assert.equal((await read('mine',agent.token)).meta.total,0);
    await fixture.db.prepare("UPDATE tickets SET assigned_to=? WHERE tenant_id=? AND id='fixture-ticket'").bind(agent.id,tenantId).run();
    assert.equal((await read('unassigned',agent.token)).meta.total,0);
    const own=await read('mine',agent.token);
    assert.equal(own.meta.total,1);assert.equal(own.data[0].inclusion_reason,'mine');
    assert.equal((await read('mine',colleague.token)).meta.total,0);
    assert.equal((await read('mine',agent.token,`&assigned_to=${colleague.id}`)).meta.total,0);
    const customerToken=(await (await fixture.login('customerA')).json<{token:string}>()).token;
    const key=await fixture.createScopedApiKey('operatorA',['tickets:read']);
    for(const queue of ['mine','unassigned']){
      assert.equal((await fixture.request(`/api/tickets?queue=${queue}`,{token:customerToken})).status,403);
      assert.notEqual((await fixture.request(`/api/tickets?queue=${queue}`,{headers:{'X-API-Key':key.apiKey}})).status,200);
    }
    await initializeLocalBetaFixture(fixture,{runId:'ownership-queue-admission',tenants:[tenantId,fixture.principals.operatorB.tenantId],
      invitations:[...Object.values(fixture.principals).map(principal=>({tenantId:principal.tenantId,id:principal.localId,kind:principal.role==='customer'?'customer' as const:'staff' as const})),
        {tenantId,id:agent.id,kind:'staff'},{tenantId,id:colleague.id,kind:'staff'}],
      limits:{ticketLimit:2,mutationLimit:8,recoveryReserve:2,uploadLimit:2}});
    await fixture.enableCombinedTicketAdmission();
    assert.equal((await read('mine',agent.token)).meta.total,1);
    assert.equal((await read('unassigned',agent.token)).meta.total,0);
    await fixture.db.prepare('UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND id=?').bind(tenantId,agent.id).run();
    for(const queue of ['mine','unassigned']) assert.notEqual((await fixture.request(`/api/tickets?queue=${queue}`,{token:agent.token})).status,200);
  });
});

test('list completion ledger shares atomic policy, credential and population fences',async()=>{
  await withTwoTenantFixture(async fixture=>{
    await initializeLocalBetaFixture(fixture,{runId:'list-ledger',tenants:[fixture.principals.operatorA.tenantId,fixture.principals.operatorB.tenantId],
      invitations:Object.values(fixture.principals).map(principal=>({tenantId:principal.tenantId,id:principal.localId,kind:principal.role==='customer'?'customer' as const:'staff' as const})),
      limits:{ticketLimit:100,mutationLimit:100,recoveryReserve:10,uploadLimit:10}});
    await fixture.enableCombinedTicketAdmission();
    const tenantId=fixture.principals.operatorA.tenantId;
    const actor=await fixture.createAgentSession(tenantId);
    const scope=createVerifiedTenantScope(tenantId,actor.id,['agent'],1);
    const {BudgetAuthorityRepository}=await import('../src/repositories/budget-authority.repository');
    const currentCredential={role:'agent' as const,sessionVersion:1,expiresAt:Math.floor(Date.now()/1000)+3600};
    for(const change of ['normal','empty','policy','credential','population','closed','foreign'] as const){
      const snapshot=await new TicketListScanRepository(fixture.db,scope).snapshot();
      const resolution=await new BudgetAuthorityRepository(fixture.db,scope).resolveForVerifiedScope(scope,Date.now());
      assert.equal(resolution.kind,'active');if(resolution.kind!=='active')throw new Error('Synthetic authority unavailable');
      const operationId=crypto.randomUUID(),operationFingerprint='synthetic-list-fingerprint';
      const envelope=ticketListEnvelope(snapshot,{groupRestricted:true})!;
      const authority={snapshot:resolution.commitSnapshot,expiresAt:Date.now()+60000,purpose:'new-work' as const,operationId,operationFingerprint,
        grant:{tenantId,aggregateId:resolution.authority.aggregateId,reservationId:crypto.randomUUID(),holderId:'synthetic-list-holder',operationId,operationFingerprint,operationEnvelope:envelope}};
      const before=(await fixture.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())!.n;
      if(change==='closed')await fixture.db.prepare(`INSERT INTO budget_grant_closures
        (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json)
        VALUES (?,?,?,?,?,?,1,'{}','{}')`).bind(tenantId,authority.grant.reservationId,authority.grant.holderId,
          authority.grant.aggregateId,crypto.randomUUID(),'synthetic-closed').run();
      if(change==='foreign')authority.snapshot={...authority.snapshot,tenant_id:fixture.principals.operatorB.tenantId};
      if(change==='policy')await fixture.db.prepare('UPDATE budget_owner_policies SET policy_json=policy_json||?').bind(' ').run();
      if(change==='credential')await fixture.db.prepare('UPDATE users SET session_version=2 WHERE tenant_id=? AND id=?').bind(tenantId,scope.actorId).run();
      if(change==='population')await fixture.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,source) VALUES (?,'new-population','Synthetic','synthetic@example.invalid','email')").bind(tenantId).run();
      const observations:D1Observation[]=[];
      const work=new SqlTicketRepository(scope,observeDatabase(fixture.db,observations)).list({page:1,limit:50,scanFence:snapshot,currentCredential,
        viewer:{role:'agent',actorId:scope.actorId},budgetAuthority:authority,...(change==='empty'?{customerEmail:'missing@example.invalid'}:{})});
      if(change==='normal'||change==='empty'){
        const result=await work;if(change==='empty')assert.equal(result.total,0);
        assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())!.n,before+1);
        assert.equal(observations.length,5);assert.ok(observations.reduce((sum,item)=>sum+item.rowsWritten,0)<=16);
      }else{
        await assert.rejects(work,error=>error instanceof TicketListScanError);
        assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())!.n,before);
      }
      if(change==='credential')await fixture.db.prepare('UPDATE users SET session_version=1 WHERE tenant_id=? AND id=?').bind(tenantId,scope.actorId).run();
    }
  });
});
