import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../src/types/tenant';
import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { initializeLocalBetaFixture } from './local-beta-fixture';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories';
import { OperatorActivityRepository } from '../src/repositories/operator-activity.repository';
import { TicketQueueCountsRepository,ticketQueueCountsSql } from '../src/repositories/ticket-queue-counts.repository';
import { TicketListScanRepository,TicketListScanError } from '../src/repositories/ticket-list-scan.repository';
import { ticketListEnvelope } from '../src/budgets/http-ticket-list-admission.service';
import type { TicketQueueCounts } from '../src/types/ticket-queue';

test('materialized standard counts reconcile with queues and own undismissed mentions remain after read',async t=>{
  await withTwoTenantFixture(async fixture=>{
    const tenantId=fixture.principals.operatorA.tenantId;
    const agent=await fixture.createAgentSession(tenantId),colleague=await fixture.createAgentSession(tenantId);
    const scope=createVerifiedTenantScope(tenantId,agent.id,['agent'],1);
    const credential={role:'agent' as const,sessionVersion:1,expiresAt:Math.floor(Date.now()/1000)+3600};
    const repos=createRepositories(scope,fixture.db),activities=new OperatorActivityRepository(scope,fixture.db);
    for(const id of ['mine','snoozed','resolved','hidden'])await fixture.db.prepare("INSERT INTO tickets(tenant_id,id,subject,status,customer_email,source,assigned_to) VALUES(?,?,?,'open','synthetic@example.invalid','fixture',?)")
      .bind(tenantId,id,`Synthetic ${id}`,id==='mine'?agent.id:null).run();
    const append=async(id:string,ticketId:string,recipientUserId=agent.id,kind:'mention'|'assignment'='mention')=>{
      const result=await activities.appendTrusted({id,ticketId,recipientUserId,kind,sourceId:`source-${id}`,producer:{kind:'system'},facts:{summary:'Synthetic'}});
      assert.ok(result);return result.activity;
    };
    const m1=await append('mention-one','mine'),m2=await append('mention-two','mine');
    await append('mention-snoozed','snoozed');await append('mention-resolved','resolved');await append('mention-hidden','hidden');
    await append('colleague-mention','fixture-ticket',colleague.id);await append('not-mention','fixture-ticket',agent.id,'assignment');
    await fixture.db.batch([
      fixture.db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES(?,'hidden-group','Hidden')").bind(tenantId),
      fixture.db.prepare("UPDATE tickets SET group_id='hidden-group' WHERE tenant_id=? AND id='hidden'").bind(tenantId),
      fixture.db.prepare("UPDATE tickets SET status='resolved' WHERE tenant_id=? AND id='resolved'").bind(tenantId),
      fixture.db.prepare("UPDATE ticket_support_state SET snoozed_until='2099-01-01T00:00:00.000Z' WHERE tenant_id=? AND ticket_id='snoozed'").bind(tenantId),
      fixture.db.prepare("INSERT INTO operator_drafts(tenant_id,user_id,ticket_id,generation,revision,mode,body,attachments,base_conversation_revision,updated_at,expires_at) VALUES(?,?,'mine',?,1,'internal','Synthetic draft','[]',0,'2026-09-13T00:00:00.000Z','2099-01-01T00:00:00.000Z')").bind(tenantId,agent.id,crypto.randomUUID()),
      fixture.db.prepare("INSERT INTO operator_drafts(tenant_id,user_id,ticket_id,generation,revision,mode,body,attachments,base_conversation_revision,updated_at,expires_at) VALUES(?,?,'resolved',?,1,'internal','Synthetic old draft','[]',0,'2000-01-01T00:00:00.000Z',NULL)").bind(tenantId,agent.id,crypto.randomUUID()),
    ]);
    const snapshot=await new TicketListScanRepository(fixture.db,scope).snapshot();
    const options={credential,snapshot,draftNotExpiredAt:'2026-09-13T12:00:00.000Z'};
    const reader=new TicketQueueCountsRepository(fixture.db,scope);
    assert.equal((await reader.counts({credential,snapshot})).counts.drafts,2,'no expiry is inferred without the explicit local policy cutoff');
    const counts=await reader.counts(options);
    assert.deepEqual(counts,{scope:'standard_queues',counts:{all:4,actionable:2,mine:1,unassigned:1,mentions:1,drafts:1,snoozed:1}});
    for(const queue of ['actionable','mine','unassigned','mentions','drafts','snoozed'] as const){
      const list=await repos.queues.list({queue,viewer:{role:'agent',actorId:agent.id},draftNotExpiredAt:options.draftNotExpiredAt});
      assert.equal(list.total,counts.counts[queue],queue);assert.ok(list.items.every(item=>!('facts' in item.ticket)));
    }
    const query=ticketQueueCountsSql(scope,options);
    const plan=await fixture.db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.values).all<{detail:string}>();
    const details=plan.results.map(row=>row.detail);
    assert.equal(details.filter(detail=>detail==='MATERIALIZE queue_flags').length,1);
    assert.equal(details.filter(detail=>detail==='SCAN queue_flags').length,1);
    assert.equal(details.filter(detail=>/SEARCH queue_state/.test(detail)).length,2);
    assert.equal(details.filter(detail=>/SEARCH queue_draft/.test(detail)).length,1);
    assert.equal(details.filter(detail=>/SEARCH queue_mention USING (?:COVERING )?INDEX idx_operator_activities_open_mention_ticket/.test(detail)).length,1);
    const result=await fixture.db.prepare(query.sql).bind(...query.values).all();
    const envelope=ticketListEnvelope(snapshot,{groupRestricted:true,aggregateCounts:true})!;
    assert.ok(result.meta.rows_read>0&&result.meta.rows_read<=envelope.d1RowsRead!);assert.equal(result.meta.rows_written,0,'classification SELECT has no durable writes');
    t.diagnostic(`MATERIALIZE queue_flags once, four flag subqueries once each per visible row; ${snapshot.ticketRows} candidates, ${result.meta.rows_read} SELECT rows, ${envelope.d1RowsRead} aggregate grant allowance including ledger overhead`);
    const presentation={...credential,mfaVerified:true as const};
    const read1=await activities.markRead(m1.id,m1.revision,presentation),read2=await activities.markRead(m2.id,m2.revision,presentation);
    assert.ok(read1&&read2);assert.equal((await reader.counts(options)).counts.mentions,1,'read alone does not complete mention work');
    await activities.dismiss(m1.id,read1.revision,presentation);
    assert.equal((await reader.counts(options)).counts.mentions,1,'another undismissed mention keeps ticket membership');
    await activities.dismiss(m2.id,read2.revision,presentation);
    assert.equal((await reader.counts(options)).counts.mentions,0);
    // Unrelated and dismissed history cannot enlarge the ticket/recipient existence probe.
    for(let offset=0;offset<512;offset+=64)await fixture.db.batch(Array.from({length:64},(_,i)=>{
      const n=offset+i,own=n%2===0;
      return fixture.db.prepare(`INSERT INTO operator_activities(tenant_id,id,ticket_id,recipient_user_id,kind,source_id,producer_kind,receipt_fingerprint,facts,dismissed_at)
        VALUES(?,?,'fixture-ticket',?,'mention',?,'system',?,'{}',?)`).bind(tenantId,`history-${n}`,own?agent.id:colleague.id,`history-source-${n}`,'0'.repeat(64),own?'2026-09-13T00:00:00Z':null);
    }));
    assert.equal((await reader.counts(options)).counts.mentions,0,'512 dismissed/foreign-recipient mentions remain outside own membership');
    const mentionsResponse=await fixture.request('/api/tickets?queue=mentions',{token:agent.token});
    assert.equal(mentionsResponse.status,200);assert.equal((await mentionsResponse.json<{meta:{total:number}}>()).meta.total,0);

    const foreignAgent=await fixture.createAgentSession(fixture.principals.operatorB.tenantId);
    const foreignScope=createVerifiedTenantScope(fixture.principals.operatorB.tenantId,foreignAgent.id,['agent'],1);
    const foreign=await new TicketQueueCountsRepository(fixture.db,foreignScope).counts({credential});
    assert.equal(foreign.counts.all,(await createRepositories(foreignScope,fixture.db).tickets.list({viewer:{role:'agent',actorId:foreignAgent.id}})).total);assert.equal(foreign.counts.mentions,0);
    await fixture.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,source) VALUES(?,'growth','Growth','synthetic@example.invalid','fixture')").bind(tenantId).run();
    await assert.rejects(reader.counts(options),(error:unknown)=>error instanceof TicketListScanError&&error.code==='authority_changed','growth after snapshot prevents an aggregate claim');
  });
});

test('standard count HTTP completes a durable granted operation and rejects nonoperators and revoked sessions',async t=>{
  await withTwoTenantFixture(async fixture=>{
    const tenantId=fixture.principals.operatorA.tenantId,agent=await fixture.createAgentSession(tenantId);
    const read=()=>fixture.request('/api/tickets/queue-counts',{token:agent.token});
    assert.equal((await read()).status,200);
    const customerToken=(await(await fixture.login('customerA')).json<{token:string}>()).token;
    assert.equal((await fixture.request('/api/tickets/queue-counts',{token:customerToken})).status,403);
    const key=await fixture.createScopedApiKey('operatorA',['tickets:read']);
    for(const path of ['/api/tickets/queue-counts','/api/tickets?queue=mentions']){
      assert.notEqual((await fixture.request(path,{apiKey:key.apiKey})).status,200);
      assert.equal((await fixture.request(path,{token:customerToken})).status,403);
    }
    await initializeLocalBetaFixture(fixture,{runId:'queue-counts-admission',tenants:[tenantId,fixture.principals.operatorB.tenantId],
      invitations:[...Object.values(fixture.principals).map(p=>({tenantId:p.tenantId,id:p.localId,kind:p.role==='customer'?'customer' as const:'staff' as const})),{tenantId,id:agent.id,kind:'staff'}],
      limits:{ticketLimit:2,mutationLimit:8,recoveryReserve:2,uploadLimit:2}});
    await fixture.enableCombinedTicketAdmission();
    const before=await fixture.db.prepare('SELECT COUNT(*) AS total FROM budget_grant_operations WHERE tenant_id=?').bind(tenantId).first<{total:number}>();
    const originalCounts=TicketQueueCountsRepository.prototype.counts;let rowsRead=0,rowsWritten=0;
    TicketQueueCountsRepository.prototype.counts=async function(options){
      const context=this as unknown as {db:D1Database;scope:VerifiedTenantScope};
      const observed=new Proxy(context.db,{get(target,key){
        if(key==='batch')return async(statements:Parameters<D1Database['batch']>[0])=>{const results=await target.batch(statements);
          for(const result of results){rowsRead+=result.meta.rows_read??0;rowsWritten+=result.meta.rows_written??0;}return results;};
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});
      return originalCounts.call(new TicketQueueCountsRepository(observed,context.scope),options);
    };
    let response;
    try{response=await read();}finally{TicketQueueCountsRepository.prototype.counts=originalCounts;}
    assert.equal(response.status,200);
    const scope=createVerifiedTenantScope(tenantId,agent.id,['agent'],1);
    const snapshot=await new TicketListScanRepository(fixture.db,scope).snapshot();
    const envelope=ticketListEnvelope(snapshot,{groupRestricted:true,aggregateCounts:true})!;
    assert.ok(rowsRead>0&&rowsRead<=envelope.d1RowsRead!,`reads ${rowsRead}`);assert.ok(rowsWritten>0&&rowsWritten<=envelope.d1RowsWritten!,`writes ${rowsWritten}`);
    t.diagnostic(`aggregate fenced HTTP batches: ${rowsRead} reads/${rowsWritten} durable writes within ${envelope.d1RowsRead}/${envelope.d1RowsWritten}`);
    const body=await response.json<TicketQueueCounts>();assert.equal(body.scope,'standard_queues');assert.equal(body.counts.all,1);
    const after=await fixture.db.prepare('SELECT COUNT(*) AS total FROM budget_grant_operations WHERE tenant_id=?').bind(tenantId).first<{total:number}>();
    assert.equal(after!.total,before!.total+1,'a successful aggregate read records exact durable operation completion');
    let enteredAfterAdmission=false;
    TicketQueueCountsRepository.prototype.counts=async function(options){
      assert.ok(options.commit,'configured read retains exact spent authority');enteredAfterAdmission=true;
      await fixture.db.prepare('UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND id=?').bind(tenantId,agent.id).run();
      return originalCounts.call(this,options);
    };
    let rejected;
    try{rejected=await read();}finally{TicketQueueCountsRepository.prototype.counts=originalCounts;}
    assert.ok(enteredAfterAdmission);assert.equal(rejected.status,503,'revocation after grant spend fails the atomic read fence');
    const final=await fixture.db.prepare('SELECT COUNT(*) AS total FROM budget_grant_operations WHERE tenant_id=?').bind(tenantId).first<{total:number}>();
    assert.equal(final!.total,after!.total,'revoked request creates no phantom completed operation');
  });
});
