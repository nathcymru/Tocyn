import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type LocalTenantFixture, type FixtureResponse } from './local-tenant-fixture';

type RecordBody = { id: string; ticket?: { id: string }; status: string; priority: string; assigned_to: string | null; group_id: string | null; articles: Array<{ id: string; body: string; is_internal: boolean }> };

async function status(response: FixtureResponse, expected: number): Promise<FixtureResponse> {
  assert.equal(response.status, expected, 'Local workflow route status');
  return response;
}
async function staff(fixture: LocalTenantFixture, name: 'operatorA' | 'operatorB'): Promise<string> {
  const challenge = await (await status(await fixture.login(name), 200)).json<{ token: string }>();
  const result = await status(await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(name) },
  }), 200);
  return (await result.json<{ token: string }>()).token;
}
async function customer(fixture: LocalTenantFixture): Promise<string> {
  const principal = fixture.principals.customerA;
  await status(await fixture.request('/api/v1/customer/auth/request', { method: 'POST',
    body: { email: principal.email, widgetKey: principal.widgetKey, type: 'magic_link' },
  }), 200);
  const messages = await (await status(await fixture.request('/__local/auth-capture/messages'), 200))
    .json<Array<{ to: string; loginLink?: string }>>();
  const link = messages.find(message => message.to === principal.email)?.loginLink;
  assert.ok(link, 'Synthetic local customer challenge was captured');
  const token = new URL(link).searchParams.get('token');
  const result = await status(await fixture.request('/api/v1/customer/auth/verify', {
    method: 'POST', body: { token, widgetKey: principal.widgetKey },
  }), 200);
  return (await result.json<{ token: string }>()).token;
}
async function records(fixture: LocalTenantFixture, ticketId: string) {
  const tenant = fixture.principals.operatorA.tenantId;
  return {
    ticket: await fixture.db.prepare('SELECT status,priority,assigned_to,group_id FROM tickets WHERE tenant_id=? AND id=?').bind(tenant,ticketId).first(),
    articles: (await fixture.db.prepare('SELECT id,body,is_internal FROM articles WHERE tenant_id=? AND ticket_id=? ORDER BY id').bind(tenant,ticketId).all()).results,
    events: (await fixture.db.prepare('SELECT id,kind,facts FROM conversation_events WHERE tenant_id=? AND ticket_id=? ORDER BY sequence').bind(tenant,ticketId).all<{id:string;kind:string;facts:string}>()).results,
  };
}

test('API and portal intake complete the human handling loop with public responses and private notes', async context => {
  const started = Date.now();
  let report: Record<string,number> = {};
  await withTwoTenantFixture(async fixture => {
    const operator = await staff(fixture,'operatorA');
    const publicSession = await customer(fixture);
    const key = await fixture.createScopedApiKey('operatorA',['tickets:read','tickets:write']);
    const baseline = await fixture.resourceUsage();
    const assigneeId = '00000000-0000-4000-8000-000000000062';
    await fixture.db.prepare("INSERT INTO users (tenant_id,id,email,full_name,role) VALUES (?,?,?,'Synthetic assignee','agent')")
      .bind(fixture.principals.operatorA.tenantId,assigneeId,'assigned.operator@example.invalid').run();
    const group = await (await status(await fixture.request('/api/groups',{method:'POST',token:operator,body:{name:'Synthetic workflow group'}}),201)).json<{id:string}>();
    for (const source of ['api','portal'] as const) {
      const created = await status(source === 'api'
        ? await fixture.request('/api/v1/tickets',{method:'POST',apiKey:key.apiKey,body:{subject:'API operator journey',customer_email:fixture.principals.customerA.email,body:'API customer question'}})
        : await fixture.request('/api/v1/customer/tickets',{method:'POST',token:publicSession,origin:'http://localhost:5174',body:{subject:'Portal operator journey',message:'Portal customer question'}}),201);
      const body = await created.json<RecordBody>();
      const id = body.ticket?.id ?? body.id;
      const feed = await (await status(await fixture.request(`/api/tickets?search=${source === 'api' ? 'API' : 'Portal'}%20operator%20journey`,{token:operator}),200)).json<{data:Array<{id:string}>}>();
      assert.equal(feed.data.some(ticket=>ticket.id === id),true,'Incoming ticket appears in the scoped operator feed');
      const read = async () => (await status(await fixture.request(`/api/tickets/${id}`,{token:operator}),200)).json<RecordBody>();
      assert.equal((await read()).articles.length,1,'Operator opens the initial customer message');
      fixture.resetNotificationAttempts();
      await status(await fixture.request(`/api/tickets/${id}`,{method:'PATCH',token:operator,body:{assigned_to:assigneeId,group_id:group.id,status:'pending',priority:'high'}}),200);
      assert.equal(fixture.notificationAttempts(),1,'Committed ticket changes notify connected operators');
      assert.equal((await read()).assigned_to,assigneeId,'Assignment was persisted, not only displayed optimistically');
      await status(await fixture.request(`/api/tickets/${id}`,{method:'PATCH',token:operator,body:{assigned_to:null,group_id:null}}),200);
      const cleared = await read();
      assert.equal(cleared.assigned_to,null);
      assert.equal(cleared.group_id,null);
      const publicBody = `Synthetic ${source} operator response`;
      const privateBody = `Synthetic ${source} internal note`;
      await status(await fixture.request(`/api/tickets/${id}/articles`,{method:'POST',token:operator,body:{body:publicBody,is_internal:false}}),201);
      await status(await fixture.request(`/api/tickets/${id}/articles`,{method:'POST',token:operator,body:{body:privateBody,is_internal:true}}),201);
      await status(await fixture.request(`/api/tickets/${id}`,{method:'PATCH',token:operator,body:{status:'resolved'}}),200);
      const final = await read();
      assert.equal(final.status,'resolved');
      assert.equal(final.articles.some(article=>article.body===publicBody),true);
      assert.equal(final.articles.some(article=>article.body===privateBody),true);
      for (const response of [
        await fixture.request(`/api/v1/tickets/${id}`,{apiKey:key.apiKey}),
        await fixture.request(`/api/v1/customer/tickets/${id}`,{token:publicSession}),
      ]) {
        const visible = await (await status(response,200)).json<RecordBody>();
        assert.equal(visible.articles.some(article=>article.body===publicBody),true,'Supported public path retrieves the staff response');
        assert.equal(JSON.stringify(visible).includes(privateBody),false,'Public retrieval does not expose the internal note');
      }
      const persisted = await records(fixture,id);
      assert.equal(persisted.events.filter(event=>event.kind==='ticket.assignment_changed').length,2);
      const clearFacts = JSON.parse(persisted.events.filter(event=>event.kind==='ticket.assignment_changed')[1].facts);
      assert.deepEqual(clearFacts.after,{assignedTo:null,groupId:null},'Audit agrees with persisted unassignment');
      assert.equal(persisted.events.filter(event=>event.kind==='message.reply').length,2);
    }
    const usage = await fixture.resourceUsage();
    report = {selectedD1RowDelta:usage.d1Rows-baseline.d1Rows,routeRequests:usage.routeRequests-baseline.routeRequests,r2Objects:usage.r2Objects};
    assert.equal(usage.r2Objects,0);
  });
  context.diagnostic(JSON.stringify({...report,elapsedMs:Date.now()-started,cleanup:'disposed',externalDelivery:'disabled-by-local-profile'}));
});

test('operator rejection and lost-response recovery preserve scoped persisted state', async () => {
  await withTwoTenantFixture(async fixture => {
    const operator = await staff(fixture,'operatorA');
    const foreign = await staff(fixture,'operatorB');
    const created = await status(await fixture.request('/api/tickets',{method:'POST',token:operator,body:{subject:'Recovery journey',customer_email:fixture.principals.customerA.email,body:'Synthetic initial message'}}),201);
    const {id} = await created.json<{id:string}>();
    const before = await records(fixture,id);
    await status(await fixture.request(`/api/tickets/${id}`,{token:foreign}),404);
    fixture.resetNotificationAttempts();
    await status(await fixture.request(`/api/tickets/${id}`,{method:'PATCH',token:foreign,body:{status:'closed'}}),404);
    await status(await fixture.request(`/api/tickets/${id}/articles`,{method:'POST',token:foreign,body:{body:'Foreign response attempt',is_internal:false}}),404);
    await status(await fixture.request(`/api/tickets/${id}`,{method:'PATCH',token:operator,body:{status:'unsupported'}}),400);
    await status(await fixture.request(`/api/tickets/${id}/articles`,{method:'POST',token:operator,body:{body:'',is_internal:false}}),400);
    assert.equal(fixture.notificationAttempts(),0,'Rejected changes do not broadcast');
    assert.deepEqual(await records(fixture,id),before,'Rejected workflow steps produce no ticket/article/audit changes');
    // Discard a committed response to model transport loss. Recovery reads; it does not resend a non-idempotent write.
    const lost = await status(await fixture.request(`/api/tickets/${id}/articles`,{method:'POST',token:operator,body:{body:'Committed response recovered by refresh',is_internal:false}}),201);
    await lost.body?.cancel();
    const recovered = await (await status(await fixture.request(`/api/tickets/${id}`,{token:operator}),200)).json<RecordBody>();
    assert.equal(recovered.articles.filter(article=>article.body==='Committed response recovered by refresh').length,1);
    const after = await records(fixture,id);
    assert.equal(after.events.length,before.events.length+1);
    await fixture.revokePrincipalSessions('operatorA');
    await status(await fixture.request(`/api/tickets/${id}`,{method:'PATCH',token:operator,body:{status:'closed'}}),401);
    assert.deepEqual(await records(fixture,id),after,'Revoked staff cannot alter the recovered ticket');
  });
});
