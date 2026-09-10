import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';
import { BoundedConversationReadRepository } from '../src/repositories/bounded-conversation-read.repository';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { LocalBetaAdmissionRepository } from '../src/repositories/local-beta-admission.repository';
import { localBetaRoute } from '../src/middleware/local-beta';
import { parseListPage, decodeArticleCursor } from '../src/services/conversation-read-bounds';
import { LocalBetaDiagnostics } from '../src/services/local-beta-diagnostics';
import type { D1Database as CloudflareD1 } from '@cloudflare/workers-types';

async function initialize(f:LocalTenantFixture,apiKeyIds:{tenantId:string;id:string}[]=[]) {
  await f.db.batch([
    f.db.prepare("INSERT INTO local_beta_runs(run_id,ticket_limit,mutation_limit,recovery_reserve,upload_limit) VALUES ('guarded-fixture',2,4,2,2)"),
    ...['fixture-tenant-a','fixture-tenant-b'].map(t=>f.db.prepare("INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES ('guarded-fixture',?)").bind(t)),
    ...Object.values(f.principals).map(p=>f.db.prepare("INSERT INTO local_beta_invitations(run_id,tenant_id,principal_kind,principal_id) VALUES ('guarded-fixture',?,?,?)").bind(p.tenantId,p.role==='customer'?'customer':'staff',p.localId)),
    ...apiKeyIds.map(k=>f.db.prepare("INSERT INTO local_beta_invitations(run_id,tenant_id,principal_kind,principal_id) VALUES ('guarded-fixture',?,'api-key',?)").bind(k.tenantId,k.id)),
    f.db.prepare("INSERT INTO local_beta_policy(singleton,run_id,revision,state) VALUES(1,'guarded-fixture',1,'running')"),
  ]);
}

function differentOtp(code:string):string {
  return String((Number(code)+1)%1_000_000).padStart(6,'0');
}

test('guarded local profile: explicit policy, real invited credentials, exact capture and default-denied optional features', async t=>{
  await withTwoTenantFixture(async f=>{
    const key=await f.createScopedApiKey('operatorA',['tickets:read','tickets:write']);
    const nonInvitedKey=await f.createScopedApiKey('operatorA',['tickets:read']);
    const staffChallenge=await (await f.login('operatorA')).json<{token:string}>();
    const staff=await (await f.request('/api/auth/mfa/verify',{method:'POST',token:staffChallenge.token,body:{code:f.currentMfaCode('operatorA')}})).json<{token:string}>();
    f.enableLocalBeta();
    assert.equal((await f.request('/health')).status,503,'Missing policy fails closed');
    await initialize(f,[{tenantId:f.principals.operatorA.tenantId,id:key.id}]);
    assert.equal((await f.request('/health')).status,200);
    for (const p of ['customerA','customerB','operatorA','operatorB'] as const) assert.equal((await f.login(p)).status,200,`Invited ${p} authenticates`);
    assert.equal((await f.request('/api/auth/me',{token:staff.token})).status,200);
    const mutations = async () => (await f.db.prepare("SELECT mutations FROM local_beta_runs WHERE run_id='guarded-fixture'").first<{mutations:number}>())!.mutations;
    assert.equal(await mutations(),0);
    const savedState=await f.request('/api/workspace/state',{method:'PUT',token:staff.token,body:{
      expectedRevision:0,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId:null,panel:'conversation',
    }});
    assert.equal(savedState.status,200);
    const state=await savedState.json<{revision:number}>();assert.equal(state.revision,1);assert.equal(await mutations(),1);
    const sameContentState=await f.request('/api/workspace/state',{method:'PUT',token:staff.token,body:{
      expectedRevision:state.revision,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId:null,panel:'conversation',
    }});
    assert.equal(sameContentState.status,200);
    const currentState=await sameContentState.json<{revision:number}>();assert.equal(currentState.revision,2);assert.equal(await mutations(),2,'revision-changing state saves consume mutation capacity');
    const staleState=await f.request('/api/workspace/state',{method:'PUT',token:staff.token,body:{
      expectedRevision:0,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:2',selectedTicketId:null,panel:'conversation',
    }});
    assert.equal(staleState.status,409);assert.equal(await mutations(),2,'stale workspace CAS does not consume mutation capacity');
    const savedDraft=await f.request('/api/workspace/drafts/fixture-ticket',{method:'PUT',token:staff.token,body:{
      expectedGeneration:null,expectedRevision:0,mode:'internal',body:'guarded local draft',attachments:[],
    }});
    assert.equal(savedDraft.status,200);
    const draft=await savedDraft.json<{generation:string;revision:number}>();assert.equal(draft.revision,1);assert.equal(await mutations(),3);
    const staleDraft=await f.request('/api/workspace/drafts/fixture-ticket',{method:'PUT',token:staff.token,body:{
      expectedGeneration:null,expectedRevision:0,mode:'internal',body:'stale local draft',attachments:[],
    }});
    assert.equal(staleDraft.status,409);assert.equal(await mutations(),3,'stale draft CAS does not consume mutation capacity');
    const discarded=await f.request(`/api/workspace/drafts/fixture-ticket?generation=${draft.generation}&revision=${draft.revision}`,{method:'DELETE',token:staff.token});
    assert.equal(discarded.status,204);assert.equal(await mutations(),4);
    assert.equal((await f.request('/api/v1/tickets/fixture-ticket',{apiKey:key.apiKey})).status,200);
    const nonInvited=await f.request('/api/v1/tickets/fixture-ticket',{apiKey:nonInvitedKey.apiKey});
    assert.equal(nonInvited.status,403);assert.equal((await nonInvited.json<{code:string}>()).code,'beta_not_invited');
    const before=f.r2.operationCounts();const usage=await f.resourceUsage();
    for (const [path,method] of [
      ['/api/v1/widget/chat','POST'],['/api/v1/widget/tickets','POST'],['/api/knowledge/tickets/fixture-ticket/ai-suggest','GET'],
      ['/api/knowledge/documents','POST'],['/api/automations','POST'],['/api/api-keys','POST'],['/api/settings','PUT'],['/api/groups','POST'],
      ['/api/unclassified-future-route','POST'],
      ['/api/workspace/state','PATCH'],['/api/workspace/state','DELETE'],['/api/workspace/drafts','POST'],
      ['/api/workspace/drafts/fixture-ticket','PATCH'],['/api/workspace/drafts/fixture-ticket/extra','GET'],
    ]) {
      const response=await f.request(path,{method,token:staff.token,body:method==='GET'?undefined:{}});
      assert.equal(response.status,503,path);assert.equal((await response.json<{code:string}>()).code,'feature_disabled');
    }
    assert.deepEqual({...f.r2.operationCounts(),list:before.list},{...before});
    assert.equal((await f.resourceUsage()).d1Rows,usage.d1Rows);
    const unknown=await f.request('/api/v1/customer/auth/request',{method:'POST',body:{email:'not-invited@example.invalid',widgetKey:f.principals.customerA.widgetKey},ip:f.rateLimitIdentity+'-unknown'});
    assert.equal(unknown.status,200);
    assert.deepEqual(await (await f.request('/__local/auth-capture/messages')).json(),[]);
    const customer=f.principals.customerA;
    assert.equal((await f.request('/api/v1/customer/auth/request',{method:'POST',body:{email:customer.email,widgetKey:customer.widgetKey},ip:f.rateLimitIdentity+'-approved'})).status,200);
    const messages=await (await f.request('/__local/auth-capture/messages')).json<{to:string;loginLink:string}[]>();
    assert.deepEqual(messages.map(m=>m.to),[customer.email]);
    const token=new URL(messages[0].loginLink).searchParams.get('token');
    const verified=await f.request('/api/v1/customer/auth/verify',{method:'POST',body:{token,widgetKey:customer.widgetKey},ip:f.rateLimitIdentity+'-verify'});
    assert.equal(verified.status,200);const widget=await verified.json<{token:string}>();
    assert.equal((await f.request('/api/v1/customer/auth/me',{token:widget.token})).status,200);
    await f.revokePrincipalSessions('customerA');
    assert.equal((await f.request('/api/v1/customer/auth/me',{token:widget.token})).status,401);
    for(const page of ['0','-1','1.2','2x','1001','NaN']) assert.equal((await f.request('/api/tickets?page='+page,{token:staff.token})).status,400,page);
    assert.equal((await f.request('/api/tickets',{method:'POST',token:staff.token,body:[]})).status,400);
    assert.equal((await f.request('/api/tickets',{method:'POST',token:staff.token,rawBody:'{'})).status,400);
    assert.equal((await f.request('/api/tickets',{method:'POST',token:staff.token,body:{body:'x'.repeat(65536)}})).status,413);
    await f.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    const stoppedWorkspaceWrite=await f.request('/api/workspace/state',{method:'PUT',token:staff.token,body:{
      expectedRevision:currentState.revision,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId:null,panel:'conversation',
    }});
    assert.equal(stoppedWorkspaceWrite.status,503);assert.equal((await stoppedWorkspaceWrite.json<{code:string}>()).code,'beta_intake_stopped');
    assert.equal(await mutations(),4,'a stopped workspace write rolls back without charging capacity');
    assert.deepEqual(await f.db.prepare('SELECT revision FROM operator_workspace_state WHERE tenant_id=? AND user_id=?').bind(f.principals.operatorA.tenantId,f.principals.operatorA.localId).first(),{revision:currentState.revision});
    f.restartLocalRuntime();
    assert.deepEqual(await (await f.request('/__local/auth-capture/messages')).json(),[]);
    const admission=new LocalBetaAdmissionRepository(f.db as unknown as CloudflareD1,createVerifiedTenantScope(customer.tenantId,customer.localId,['customer'],1),{kind:'customer',id:customer.localId});
    await assert.rejects(admission.authorize('create'),{code:'beta_intake_stopped'});
    assert.equal((await f.request('/api/v1/tickets/fixture-ticket',{apiKey:key.apiKey})).status,200,'Stopped conversations remain available');
    t.diagnostic(JSON.stringify({mode:'real-miniflare',principals:4,tenants:2,disabledOptionalRoutes:14,optionalProviderCalls:0,captureResetOnRestart:true}));
  });
});

test('guarded local profile classifies only the approved workspace method and path inventory',()=>{
  for (const [method,path,route] of [
    ['GET','/api/workspace/state','conversation-read'],['PUT','/api/workspace/state','conversation-write'],
    ['GET','/api/workspace/drafts','conversation-read'],['GET','/api/workspace/drafts/ticket-1','conversation-read'],
    ['PUT','/api/workspace/drafts/ticket-1','conversation-write'],['DELETE','/api/workspace/drafts/ticket-1','conversation-write'],
    ['POST','/api/workspace/state','disabled'],['PATCH','/api/workspace/state','disabled'],['DELETE','/api/workspace/state','disabled'],
    ['POST','/api/workspace/drafts','disabled'],['PATCH','/api/workspace/drafts/ticket-1','disabled'],['GET','/api/workspace/drafts/ticket-1/extra','disabled'],
  ] as const) assert.equal(localBetaRoute(method,path),route,`${method} ${path}`);
});

test('guarded OTP verification keeps durable guesses while enforcing challenge and current invitation', async t=>{
  await withTwoTenantFixture(async f=>{
    f.enableLocalBeta();
    await initialize(f);
    const a=f.principals.customerA,b=f.principals.customerB;
    const requestOtp=async(customer:typeof a,ip:string)=>{
      const response=await f.request('/api/v1/customer/auth/request',{method:'POST',body:{email:customer.email,type:'otp',widgetKey:customer.widgetKey},ip});
      assert.equal(response.status,200);
      const body=await response.json<{challengeId:string}>();
      assert.match(body.challengeId,/^[0-9a-f-]{36}$/);
      const messages=await (await f.request('/__local/auth-capture/messages')).json<{to:string;text:string}[]>();
      const text=messages.find(message=>message.to===customer.email)?.text ?? '';
      const code=text.match(/\b\d{6}\b/)?.[0];
      assert.ok(code,'The local capture must contain the issued OTP without reporting it');
      return {challengeId:body.challengeId,code};
    };
    const aOtp=await requestOtp(a,f.rateLimitIdentity+'-otp-a');
    const bOtp=await requestOtp(b,f.rateLimitIdentity+'-otp-b');
    const wrongA=differentOtp(aOtp.code);
    const wrongB=differentOtp(bOtp.code);
    for(let attempt=0;attempt<5;attempt++) {
      const denied=await f.request('/api/v1/customer/auth/verify',{method:'POST',body:{token:wrongA,challengeId:aOtp.challengeId,widgetKey:a.widgetKey},ip:f.rateLimitIdentity+'-wrong-'+attempt});
      assert.equal(denied.status,401);
    }
    assert.deepEqual(await f.db.prepare('SELECT attempts,used_at FROM customer_auth_tokens WHERE tenant_id=? AND id=?').bind(a.tenantId,aOtp.challengeId).first(),{attempts:5,used_at:null});
    assert.equal((await f.request('/api/v1/customer/auth/verify',{method:'POST',body:{token:aOtp.code,challengeId:aOtp.challengeId,widgetKey:a.widgetKey},ip:f.rateLimitIdentity+'-exhausted'})).status,401);
    assert.equal((await f.request('/api/v1/customer/auth/verify',{method:'POST',body:{token:bOtp.code,challengeId:bOtp.challengeId,widgetKey:a.widgetKey},ip:f.rateLimitIdentity+'-foreign'})).status,401);
    assert.deepEqual(await f.db.prepare('SELECT attempts,used_at FROM customer_auth_tokens WHERE tenant_id=? AND id=?').bind(b.tenantId,bOtp.challengeId).first(),{attempts:0,used_at:null});
    assert.equal((await f.request('/api/v1/customer/auth/verify',{method:'POST',body:{token:wrongB,challengeId:bOtp.challengeId,widgetKey:b.widgetKey},ip:f.rateLimitIdentity+'-mismatched'})).status,401);
    assert.deepEqual(await f.db.prepare('SELECT attempts,used_at FROM customer_auth_tokens WHERE tenant_id=? AND id=?').bind(b.tenantId,bOtp.challengeId).first(),{attempts:1,used_at:null});
    await f.db.prepare("DELETE FROM local_beta_invitations WHERE tenant_id=? AND principal_kind='customer' AND principal_id=?").bind(b.tenantId,b.localId).run();
    assert.equal((await f.request('/api/v1/customer/auth/verify',{method:'POST',body:{token:bOtp.code,challengeId:bOtp.challengeId,widgetKey:b.widgetKey},ip:f.rateLimitIdentity+'-revoked'})).status,401);
    assert.deepEqual(await f.db.prepare('SELECT attempts,used_at FROM customer_auth_tokens WHERE tenant_id=? AND id=?').bind(b.tenantId,bOtp.challengeId).first(),{attempts:1,used_at:null});
  });
});

test('bounded detail: stable tied-date pages, SQL visibility/ownership, fixed query count and explicit oversized legacy errors',async t=>{
  await withTwoTenantFixture(async f=>{
    const a=f.principals.customerA,b=f.principals.customerB;
    const statements=[];
    for(const tenant of [a.tenantId,b.tenantId])for(let i=0;i<55;i++){
      const id='bounded-'+String(i).padStart(3,'0');
      statements.push(f.db.prepare("INSERT INTO articles(tenant_id,id,ticket_id,sender_type,body,is_internal,created_at) VALUES (?,?,'fixture-ticket','customer',?,?, '2026-09-09 00:00:00')").bind(tenant,id,tenant+' body '+i,i%3===0?1:0));
      statements.push(f.db.prepare("INSERT INTO attachments(tenant_id,id,article_id,file_name,file_size,content_type,r2_key) VALUES (?,?,?,'safe.txt',1,'text/plain',?)").bind(tenant,'attachment-'+id,id,tenant+'/key/'+id));
    }
    await f.db.batch(statements);
    let queries=0;
    const db=new Proxy(f.db,{get(target,p){const v=Reflect.get(target,p);if(p==='prepare')return (sql:string)=>{queries++;return target.prepare(sql);};return typeof v==='function'?v.bind(target):v;}}) as unknown as CloudflareD1;
    const repo=new BoundedConversationReadRepository(db,createVerifiedTenantScope(a.tenantId,a.localId,['customer'],1));
    queries=0;const first=await repo.page('fixture-ticket',{customerEmail:a.email,limit:'1'});assert.equal(queries,4);assert.equal(first.articles.length,1);assert.equal(first.articles[0].id,'bounded-001');
    queries=0;const rest=await repo.page('fixture-ticket',{customerEmail:a.email,limit:'50',cursor:first.pagination.next_cursor!});assert.equal(queries,4);
    assert.equal(rest.articles.length,35);assert.equal(rest.pagination.has_more,false);
    for(const article of [...first.articles,...rest.articles]) {assert.equal((article as typeof article & {tenant_id:string}).tenant_id,a.tenantId);assert.equal(article.is_internal,false);assert.equal(article.attachments.length,1);assert.equal((article.attachments[0] as typeof article.attachments[0] & {tenant_id:string}).tenant_id,a.tenantId);}
    assert.equal((await repo.page('fixture-ticket',{customerEmail:b.email})).articles.length,0);
    const staff=await repo.page('fixture-ticket',{limit:'50'});assert.equal(staff.articles.length,50);assert.equal(staff.pagination.has_more,true);
    assert.equal(staff.articles.find(article=>article.id==='bounded-000')?.is_internal,true);
    assert.ok(staff.articles.every(article=>typeof article.is_internal==='boolean'));
    await f.db.prepare("UPDATE articles SET body=? WHERE tenant_id=? AND id='bounded-001'").bind('x'.repeat(300000),a.tenantId).run();
    await assert.rejects(repo.page('fixture-ticket',{customerEmail:a.email}),{code:'conversation_page_too_large'});
    await f.db.prepare("UPDATE articles SET body='small',body_r2_key='legacy-never-read' WHERE tenant_id=? AND id='bounded-001'").bind(a.tenantId).run();
    const r2=f.r2.operationCounts();await assert.rejects(repo.page('fixture-ticket',{customerEmail:a.email}),{code:'conversation_page_too_large'});assert.deepEqual(f.r2.operationCounts(),r2);
    t.diagnostic(JSON.stringify({pageSizes:[1,50],queriesEach:4,foreignOrInternalLeaks:0,legacyR2Reads:0}));
  });
});

test('bounded diagnostics retain only fixed metadata and prune on access; pagination rejects ambiguous values',()=>{
  let now=0;const ring=new LocalBetaDiagnostics(()=>now);
  for(let i=0;i<2000;i++)ring.record('conversation-write','accepted',1);
  assert.equal(ring.list().length,1000);assert.ok(new TextEncoder().encode(JSON.stringify(ring.list())).byteLength<1024*1000);
  ring.record('credentials' as never,'synthetic-secret-marker' as never,1);assert.equal(ring.list().length,1000);
  now=24*60*60*1000+1;assert.equal(ring.list().length,0);
  for(const page of ['-1','0','1.0','1x','','NaN','1001']) assert.throws(()=>parseListPage({page}));
  assert.deepEqual(parseListPage({}),{page:1,limit:50});assert.throws(()=>decodeArticleCursor('secret-like-sentinel'));
});
