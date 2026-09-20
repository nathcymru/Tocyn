import { initializeLocalBetaFixture } from './local-beta-fixture';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import type { D1Database,DurableObjectNamespace } from '@cloudflare/workers-types';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import { SessionBudgetAdmissionService } from '../src/budgets/session-admission.service';
import { SlaPriorityQueueService,SlaQueueRestart,type PriorityQueueSort } from '../src/budgets/sla-priority-queue-admission.service';
import { SlaPriorityQueueRepository,SlaQueueUnavailable,type SlaQueueSelection } from '../src/repositories/sla-priority-queue.repository';
import { PriorityClockRepository } from '../src/repositories/priority-clock.repository';
import { TicketListScanRepository } from '../src/repositories/ticket-list-scan.repository';
import { ticketListEnvelope } from '../src/budgets/http-ticket-list-admission.service';
import { DEFAULT_SLA_CALENDAR,SlaEvaluationExhaustedError } from '../src/domain/sla-clock';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';

async function fixture(){
 const root=resolve(import.meta.dirname,'..');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/budget-coordinator-do-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'sla-queue-proof',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,d1Databases:{DB:'sla-queue-proof'},durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO'},unsafeEphemeralDurableObjects:true}]}));
 try{
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync(join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort())await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));
 const now=Date.now(),dimensions=['workerRequests','d1RowsRead','d1RowsWritten','doRequests','doRowsRead','doRowsWritten','logEvents'];
 const limits=Object.fromEntries(dimensions.map(k=>[k,1_000_000_000]));
 const policy={schemaVersion:1,policyId:'queue-policy',revision:1,deploymentId:'queue-deployment',mode:'conservative',catalogueVersion:'synthetic',maxGrantLifetimeMs:60000,
 budgets:dimensions.map(dimension=>({dimension,limit:limits[dimension],allocationId:dimension,recoveryPercent:20,provenance:'owner-allocation',window:{kind:'interval',id:'queue-window',startsAt:now-1000,endsAt:now+3600000}}))};
 await db.batch([db.prepare("INSERT INTO budget_deployment_authority VALUES('queue-deployment',1,'active',?)").bind(now),db.prepare("INSERT INTO budget_owner_policies VALUES('queue-deployment','queue-policy',1,1,'queue-aggregate',64,30000,?)").bind(JSON.stringify(policy))]);
 for(const tenant of ['a','b'])await db.batch([
 db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'actor',?,'agent',1,1)").bind(tenant,tenant+'@example.test'),
 db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES(?,'group','Synthetic')").bind(tenant),
 db.prepare("INSERT INTO user_groups VALUES(?,'actor','group')").bind(tenant),
 db.prepare("INSERT INTO budget_tenant_allocations VALUES('queue-deployment',?,'queue-policy',1,1,?,?,'active')").bind(tenant,tenant,JSON.stringify({schemaVersion:1,tenantId:tenant,ownerPolicyId:'queue-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]})),
 db.prepare("INSERT INTO sla_policies(tenant_id,calendar_json,response_target_ms,resolution_target_ms) VALUES(?,?,3600000,7200000)").bind(tenant,JSON.stringify(DEFAULT_SLA_CALENDAR)),
 ]);
 const scope=createVerifiedTenantScope('a','actor',['agent'],1),cache=new IsolateBudgetAdmissionCache(),admission=new SessionBudgetAdmissionService(cache);
 const raw=await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
 const coordinator=raw.get(raw.idFromName('queue-aggregate')) as unknown as BudgetCoordinatorDO;
 const calls={reserve:0,reconcile:0};const namespace={idFromName:(id:string)=>raw.idFromName(id),get:()=>({
 refreshFromTrustedAuthority:(v:Parameters<BudgetCoordinatorDO['refreshFromTrustedAuthority']>[0])=>coordinator.refreshFromTrustedAuthority(v),
 reserveFromTrustedAuthority:(v:Parameters<BudgetCoordinatorDO['reserveFromTrustedAuthority']>[0])=>{calls.reserve++;return coordinator.reserveFromTrustedAuthority(v);},
 reconcileFromTrustedAuthority:(v:Parameters<BudgetCoordinatorDO['reconcileFromTrustedAuthority']>[0])=>{calls.reconcile++;return coordinator.reconcileFromTrustedAuthority(v);}})} as unknown as DurableObjectNamespace;
 const batches:Array<{reads:number;writes:number}>=[];
 const observed=new Proxy(db,{get(target,key){if(key==='batch')return async(statements:any[])=>{const rows=await target.batch(statements);batches.push({reads:rows.reduce((n,r)=>n+r.meta.rows_read,0),writes:rows.reduce((n,r)=>n+r.meta.rows_written,0)});return rows;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 let clock=now;
 const service=(repo=new SlaPriorityQueueRepository(observed,scope))=>new SlaPriorityQueueService(observed,scope,{tenantId:'a',actorId:'actor',role:'agent',sessionVersion:1,expiresAt:Math.floor(now/1000)+3600,mfaVerified:true},
 {service:admission,repository:new BudgetAuthorityRepository(db,scope),namespace,secret:'synthetic-sla-queue-cursor-secret-at-least-32-characters',now:()=>clock,settle:(authority,outcome,at)=>cache.settleOperation(authority,outcome,at)},repo);
 const read=async(selection:SlaQueueSelection={},options:{limit?:number;cursor?:string;sort?:PriorityQueueSort}={})=>{const s=service();const result=await s.read(selection,options);s.finish(result);return result;};
 const ticket=async(id:string,target=3600000,priority='normal',tenant='a',created='2026-09-01T00:00:00Z',legacy=false)=>{
  await db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,group_id,source,priority,created_at) VALUES(?,?,?,'synthetic@example.test','group','dashboard',?,?)").bind(tenant,id,id,priority,created).run();
  await db.prepare(`INSERT INTO ticket_sla_clocks(tenant_id,ticket_id,response_started_at,resolution_started_at,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms)
   VALUES(?,?,'2026-09-13T00:00:00Z','2026-09-13T00:00:00Z',?,?,7200000)`).bind(tenant,id,legacy?null:JSON.stringify(DEFAULT_SLA_CALENDAR),target).run();
 };
 return{mf,db,observed,scope,read,service,ticket,batches,calls,clock:(at:number)=>{clock=at;},now};
 }catch(error){await mf.dispose();throw error;}
}

test('whole queue sorts beyond25 before pagination with priority then oldest then ID ties',async()=>{
 const f=await fixture();try{
 for(let i=0;i<30;i++)await f.ticket('ticket-'+String(i).padStart(2,'0'),3600000+i*60000);
 await f.ticket('outside-page',60000,'low');await f.ticket('tie-urgent',3600000,'urgent','a','2026-09-10T00:00:00Z');
 await f.ticket('tie-older',3600000,'normal','a','2026-08-01T00:00:00Z');await f.ticket('foreign',60000,'urgent','b');
 await f.db.prepare(`UPDATE tickets SET priority_category='security-privacy',priority_scope='systemic',
  priority_regulatory_officer_on_site=1,priority_vip_blocked=1,priority_hard_deadline=0,
  priority_score=40,contract_sla_tier='alpha',criticality_tier=4
  WHERE tenant_id='a' AND id='outside-page'`).run();
 const started=performance.now(),heap=process.memoryUsage().heapUsed;
 const first=await f.read({}, {limit:10});assert.equal(first.total,33);
 assert.deepEqual(first.data.slice(0,4).map(item=>item.ticket.id),['outside-page','tie-urgent','tie-older','ticket-00']);
 assert.deepEqual(first.data[0].ticket.priority_category,'security-privacy');
 assert.equal(first.data[0].ticket.priority_score,40);
 assert.equal(first.data[0].ticket.contract_sla_tier,'alpha');
 assert.equal(first.data[0].ticket.criticality_tier,4);
 const all=[...first.data];let cursor=first.next;
 while(cursor){const page=await f.read({}, {limit:10,cursor});all.push(...page.data);cursor=page.next;}
 assert.equal(new Set(all.map(item=>item.ticket.id)).size,33);assert.equal(all.some(item=>item.ticket.id==='foreign'),false);
 assert.ok(f.batches.every(batch=>batch.writes<=16));
 console.log(JSON.stringify({fixture:'whole-sla-queue33',wallMs:performance.now()-started,heapDeltaBytes:process.memoryUsage().heapUsed-heap,batches:f.batches,calls:f.calls,note:'Node process observations, not peak heap or provider CPU billing'}));
 await f.db.prepare("UPDATE tickets SET priority='urgent' WHERE tenant_id='a' AND id='ticket-01'").run();
 await assert.rejects(f.read({}, {limit:10,cursor:first.next!}),SlaQueueRestart);
 }finally{await f.mf.dispose();}
});

test('priority views sort the complete authorised clock snapshot before pagination and bind cursors to view',async()=>{
 const f=await fixture();try{
  const at=(hoursAgo:number)=>new Date(f.now-hoursAgo*3_600_000).toISOString();
  const rows:[string,number,'alpha'|'charlie'|'delta',1|2|4,boolean][]=[
   ['drift-fast',47.75,'delta',1,false],['a-high',0.5,'alpha',4,true],['a-low',0.5,'alpha',4,false],
   ['drift-one',47,'delta',1,false],['drift-four',44,'delta',1,false],['fresh-charlie',0,'charlie',2,false],
   ['waiting',0.75,'alpha',4,false],
  ];
  for(const [id,age,contract,criticality,vip] of rows){
   await f.ticket(id,3_600_000,'normal','a',at(age));
   await f.db.prepare(`UPDATE tickets SET priority_category='information-requests',priority_scope='isolated',
    priority_regulatory_officer_on_site=0,priority_vip_blocked=?,priority_hard_deadline=0,
    priority_score=?,contract_sla_tier=?,criticality_tier=? WHERE tenant_id='a' AND id=?`)
    .bind(Number(vip),vip?6:1,contract,criticality,id).run();
  }
  await f.db.prepare(`UPDATE ticket_support_state SET definition_id='legacy-pending',waiting_reason='awaiting customer',
   changed_at=?,revision=revision+1 WHERE tenant_id='a' AND ticket_id='waiting'`).bind(at(0.5)).run();
  const focus=await f.read({}, {sort:'priority_focus',limit:3});
  assert.equal(focus.total,7);
  assert.deepEqual(focus.data.map(item=>item.ticket.id),['drift-fast','a-high','a-low']);
  assert.equal(focus.data[0].priorityClock?.timeRemainingHours,0.25);
  assert.equal(focus.data[1].ticket.priority_score,6);
  assert.ok(focus.next);
  await assert.rejects(f.read({}, {sort:'priority_commitment',limit:3,cursor:focus.next!}),SlaQueueRestart);
  const focusNext=await f.read({}, {sort:'priority_focus',limit:3,cursor:focus.next!});
  assert.deepEqual(focusNext.data.map(item=>item.ticket.id),['drift-one','drift-four','fresh-charlie']);
  const focusLast=await f.read({}, {sort:'priority_focus',limit:3,cursor:focusNext.next!});
  assert.deepEqual(focusLast.data.map(item=>item.ticket.id),['waiting']);
  assert.equal(focusLast.data[0].priorityClock?.paused,true);
  const criticality=await f.read({}, {sort:'priority_criticality'});
  assert.deepEqual(criticality.data.map(item=>item.ticket.id),rows.map(row=>row[0]));
  const commitment=await f.read({}, {sort:'priority_commitment'});
  assert.deepEqual(commitment.data.map(item=>item.ticket.id),['a-high','a-low','drift-fast','drift-one','drift-four','fresh-charlie','waiting']);
  for(const [id,age] of [['overdue-one',2],['overdue-two',1.5]] as const){
   await f.ticket(id,3_600_000,'normal','a',at(age));
   await f.db.prepare(`UPDATE tickets SET priority_category='information-requests',priority_scope='isolated',
    priority_regulatory_officer_on_site=0,priority_vip_blocked=0,priority_hard_deadline=0,
    priority_score=1,contract_sla_tier='alpha',criticality_tier=4 WHERE tenant_id='a' AND id=?`).bind(id).run();
  }
  const overdue=await f.read({}, {sort:'priority_focus',limit:2});
  assert.equal(overdue.triageOverdueCount,2,'the banner count covers the complete selected queue before pagination');
  assert.deepEqual(overdue.data.map(item=>item.ticket.id),['overdue-one','overdue-two']);
 }finally{await f.mf.dispose();}
});

test('ordinary list clock projections are bounded to the selected page and current staff visibility',async()=>{
 const f=await fixture();try{
  await f.ticket('visible',3_600_000,'normal','a',new Date(f.now-1_800_000).toISOString());
  await f.ticket('other-tenant',3_600_000,'normal','b',new Date(f.now-1_800_000).toISOString());
  await f.db.prepare(`UPDATE tickets SET priority_category='information-requests',priority_scope='isolated',
    priority_regulatory_officer_on_site=0,priority_vip_blocked=0,priority_hard_deadline=0,
    priority_score=1,contract_sla_tier='alpha',criticality_tier=4 WHERE tenant_id='a' AND id='visible'`).run();
  const repo=new PriorityClockRepository(f.db,f.scope);
  const fence={tenantId:'a',actorId:'actor',role:'agent' as const,sessionVersion:1};
  const page=await repo.getPageForStaff(['visible','other-tenant'],fence,f.now);
  assert.equal(page.visible?.timeRemainingHours,0.5);
  assert.equal(page['other-tenant'],null);
  await f.db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES('a','restricted','Restricted')").run();
  await f.db.prepare("UPDATE tickets SET group_id='restricted' WHERE tenant_id='a' AND id='visible'").run();
  assert.equal((await repo.getPageForStaff(['visible'],fence,f.now)).visible,null);
  await f.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='a' AND id='actor'").run();
  assert.equal((await repo.getPageForStaff(['visible'],fence,f.now)).visible,null);
  await assert.rejects(repo.getPageForStaff(Array.from({length:101},(_,n)=>String(n)),fence,f.now),RangeError);
 }finally{await f.mf.dispose();}
});

test('a full 100-row group-restricted clock page stays within its admitted read margin',async()=>{
 const f=await fixture();try{
  const ids=Array.from({length:100},(_,index)=>`clock-${index}`);
  await f.db.batch(ids.map(id=>f.db.prepare(`INSERT INTO tickets
    (tenant_id,id,subject,customer_email,group_id,source,priority,created_at,
      priority_category,priority_scope,priority_regulatory_officer_on_site,priority_vip_blocked,
      priority_hard_deadline,priority_score,contract_sla_tier,criticality_tier)
    VALUES('a',?,?,'synthetic@example.test','group','dashboard','normal',?,
      'information-requests','isolated',0,0,0,1,'alpha',4)`)
    .bind(id,id,new Date(f.now-1_800_000).toISOString())));
  const scan=await new TicketListScanRepository(f.db,f.scope).snapshot();
  const base=ticketListEnvelope(scan,{groupRestricted:true});
  const withClocks=ticketListEnvelope(scan,{groupRestricted:true,includePriorityClocks:true});
  assert.ok(base?.d1RowsRead!==undefined&&withClocks?.d1RowsRead!==undefined);
  const clockReadMargin=withClocks.d1RowsRead-base.d1RowsRead;
  assert.equal(clockReadMargin,6*scan.ticketRows);
  const largePopulation={...scan,ticketRows:10_000};
  const largeBase=ticketListEnvelope(largePopulation,{groupRestricted:true})!;
  const largeWithClocks=ticketListEnvelope(largePopulation,{groupRestricted:true,includePriorityClocks:true})!;
  assert.equal(largeWithClocks.d1RowsRead!-largeBase.d1RowsRead!,600,
    'the clock reserve follows the bounded page rather than the whole tenant population');
  let measuredRowsRead=0;
  const meteredDb=new Proxy(f.db,{get(target,key){
    if(key==='prepare')return (sql:string)=>({bind:(...values:unknown[])=>({all:async()=>{
      const result=await target.prepare(sql).bind(...values).all();
      measuredRowsRead+=result.meta.rows_read;return result;
    }})});
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }}) as D1Database;
  const page=await new PriorityClockRepository(meteredDb,f.scope).getPageForStaff(ids,
    {tenantId:'a',actorId:'actor',role:'agent',sessionVersion:1},f.now);
  assert.equal(Object.keys(page).length,100);
  assert.ok(Object.values(page).every(clock=>clock?.timeRemainingHours===0.5));
  assert.ok(measuredRowsRead>0&&measuredRowsRead<=clockReadMargin,
    `Clock page read ${measuredRowsRead} D1 rows against ${clockReadMargin} reserved`);
 }finally{await f.mf.dispose();}
});

test('active other target, paused and completed fallback preserve full frozen and legacy clock semantics',async()=>{
 const f=await fixture();try{
 await f.ticket('other-target',3600000,'low');await f.ticket('frozen',3600000,'normal');await f.ticket('legacy',3600000,'normal','a','2026-09-01T00:00:00Z',true);
 await f.ticket('paused',60000,'urgent');await f.ticket('completed',60000,'high');
 await f.db.batch([
 f.db.prepare("UPDATE ticket_sla_clocks SET response_completed_at='2026-09-13T00:00:30Z',policy_resolution_target_ms=60000 WHERE ticket_id='other-target'"),
 f.db.prepare("UPDATE ticket_sla_clocks SET paused_at='2026-09-13T00:00:30Z',pause_reason='waiting' WHERE ticket_id='paused'"),
 f.db.prepare("UPDATE ticket_sla_clocks SET response_completed_at='2026-09-13T00:01:00Z',resolution_completed_at='2026-09-13T00:01:00Z' WHERE ticket_id='completed'"),
 f.db.prepare("UPDATE sla_policies SET response_target_ms=120000,revision=2 WHERE tenant_id='a'"),
 ]);
 const page=await f.read();assert.deepEqual(page.data.map(item=>item.ticket.id),['other-target','legacy','frozen','paused','completed']);
 assert.equal(page.data[0].sla?.response.phase,'completed');assert.equal(page.data[0].sla?.resolution.phase,'running');
 assert.equal(page.data[1].sla?.response.targetWorkingMilliseconds,120000);assert.equal(page.data[2].sla?.response.targetWorkingMilliseconds,3600000);
 assert.equal(page.data[3].deadline,null);assert.equal(page.data[4].deadline,null);
 }finally{await f.mf.dispose();}
});

test('saved filter revision restarts cursor even with identical rows and revoked visibility returns no page',async()=>{
 const f=await fixture();try{
 for(let i=0;i<3;i++)await f.ticket('ticket-'+i);
 await f.db.prepare("INSERT INTO ticket_filters(tenant_id,id,name,conditions) VALUES('a','saved','Synthetic','[]')").run();
 const first=await f.read({filterId:'saved'},{limit:1});
 await f.db.prepare("UPDATE ticket_filters SET conditions='[ ]' WHERE tenant_id='a' AND id='saved'").run();
 await assert.rejects(f.read({filterId:'saved'},{limit:1,cursor:first.next!}),SlaQueueRestart);
 const before=(await f.db.prepare("SELECT count(*) AS n FROM budget_grant_operations").first<{n:number}>())!.n;
 class LosingVisibility extends SlaPriorityQueueRepository{
  override async complete(...args:Parameters<SlaPriorityQueueRepository['complete']>){await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='a' AND user_id='actor'").run();return super.complete(...args);}
 }
 await assert.rejects(f.service(new LosingVisibility(f.observed,f.scope)).read({}));
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM budget_grant_operations").first<{n:number}>())?.n,before+1,'only completed metadata stage is journaled; no final snapshot completion after visibility loss');
 }finally{await f.mf.dispose();}
});

test('whole input overflow returns unavailable rather than a sampled partial queue',async()=>{
 const f=await fixture();try{
 await f.ticket('bounded');await f.ticket('oversized');
 await f.db.prepare("UPDATE tickets SET subject=? WHERE tenant_id='a' AND id='oversized'").bind('x'.repeat(710000)).run();
 await assert.rejects(f.read(),SlaQueueUnavailable);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n,1,'overflow is known only after paid metadata; no partial snapshot journal');
 }finally{await f.mf.dispose();}
});

test('one shared request meter exhausts across the complete legal calendar and pause workload',async()=>{
 const f=await fixture();try{
 await f.ticket('expensive');
 const weekly=Object.fromEntries(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day=>[day,Array.from({length:48},(_,i)=>({startMinute:i*30,endMinute:i*30+1}))]));
 const calendar={timeZone:'America/New_York',weekly,exceptions:[],dst:{ambiguousLocalTime:'both',nonexistentLocalTime:'next-valid'}};
 await f.db.prepare("UPDATE ticket_sla_clocks SET policy_calendar_json=?,policy_response_target_ms=7776000000,policy_resolution_target_ms=7776000000 WHERE ticket_id='expensive'").bind(JSON.stringify(calendar)).run();
 // Distinct bounded pauses force nested calendar/pause work without malformed or over-limit input.
 for(let start=0;start<4096;start+=64)await f.db.batch(Array.from({length:Math.min(64,4096-start)},(_,index)=>{
  const at=Date.UTC(2026,8,13)+(start+index)*1000;
  return f.db.prepare("INSERT INTO ticket_sla_pause_intervals VALUES('a','expensive',?,?,'waiting',0)").bind(new Date(at).toISOString(),new Date(at+500).toISOString());
 }));
 const started=performance.now();await assert.rejects(f.read(),SlaEvaluationExhaustedError);
 console.log(JSON.stringify({fixture:'whole-sla-meter-exhaustion',wallMs:performance.now()-started,note:'measured request wall time, not billed CPU'}));
 }finally{await f.mf.dispose();}
});


test('latest snippet is preserved and bounded independently of unrelated older article bodies',async()=>{
 const f=await fixture();try{
 await f.ticket('snippet');
 await f.db.batch([
 f.db.prepare("INSERT INTO articles(tenant_id,id,ticket_id,sender_type,body,snippet,created_at) VALUES('a','older','snippet','customer',?,'old','2026-09-01')").bind('h'.repeat(2_000_000)),
 f.db.prepare("INSERT INTO articles(tenant_id,id,ticket_id,sender_type,snippet,created_at) VALUES('a','latest','snippet','customer',?,'2026-09-02')").bind('最新'.repeat(16000)),
 ]);
 const page=await f.read();assert.equal(page.data[0].ticket.snippet,'最新'.repeat(16000));
 const plan=await f.db.prepare("EXPLAIN QUERY PLAN SELECT snippet FROM articles WHERE tenant_id='a' AND ticket_id='snippet' ORDER BY created_at DESC,id DESC LIMIT 1").all();
 assert.ok(JSON.stringify(plan.results).includes('idx_articles_tenant_ticket_recent'));
 await f.db.prepare("UPDATE articles SET snippet=? WHERE tenant_id='a' AND id='latest'").bind('x'.repeat(710000)).run();
 await assert.rejects(f.read(),SlaQueueUnavailable);
 console.log(JSON.stringify({fixture:'latest-snippet-byte-bound',batches:f.batches,plan:plan.results}));
 }finally{await f.mf.dispose();}
});

test('UTF8 clock bounds reject overlength before transfer and escaped pause bytes remain covered',async()=>{
 const f=await fixture();try{
 await f.ticket('bounds');
 let transferred=false;
 class Observed extends SlaPriorityQueueRepository{
  override async snapshot(...args:Parameters<SlaPriorityQueueRepository['snapshot']>){
   const rows=await super.snapshot(...args);transferred=true;
   const actual=rows.reduce((total,row)=>total+Buffer.byteLength(row.ticket_json)+Buffer.byteLength(row.clock_json??'')+Buffer.byteLength(row.pauses_json),0);
   assert.ok(actual<=args[0].metadata!.bytes,'metadata covers escaped transferred JSON');return rows;
  }
 }
 for(const bad of ['界'.repeat(22),'x'.repeat(65)]){
  await f.db.prepare("UPDATE ticket_sla_clocks SET response_started_at=? WHERE ticket_id='bounds'").bind(bad).run();
  await assert.rejects(f.service(new Observed(f.observed,f.scope)).read({}),SlaQueueUnavailable);assert.equal(transferred,false);
 }
 await f.db.prepare("UPDATE ticket_sla_clocks SET response_started_at=? WHERE ticket_id='bounds'").bind('\u0001'.repeat(64)).run();
 await f.db.prepare("INSERT INTO ticket_sla_pause_intervals VALUES('a','bounds',?,?,'waiting',0)").bind('\u0002'.repeat(64),'\u0003'.repeat(64)).run();
 await assert.rejects(f.service(new Observed(f.observed,f.scope)).read({}),SlaQueueUnavailable);assert.equal(transferred,true);
 await f.db.prepare("UPDATE ticket_sla_pause_intervals SET started_at=?,ended_at=NULL WHERE ticket_id='bounds'").bind('界'.repeat(22)).run();
 await assert.rejects(f.service(new Observed(f.observed,f.scope)).read({}),SlaQueueUnavailable);
 }finally{await f.mf.dispose();}
});


test('actual staff HTTP SLA contract preserves selectors and settles only completed responses',async()=>{
 await withTwoTenantFixture(async f=>{
  const tenant=f.principals.operatorA.tenantId,agent=await f.createAgentSession(tenant);
  const url='/api/tickets?sort=sla_priority&limit=1&search=needle&customer_email=match%40example.test';
  assert.equal((await f.request(url,{token:agent.token})).status,503,'no unbudgeted SLA fallback');
  await initializeLocalBetaFixture(f,{runId:'sla-priority-http',tenants:[tenant,f.principals.operatorB.tenantId],
    invitations:[...Object.values(f.principals).map(p=>({tenantId:p.tenantId,id:p.localId,kind:p.role==='customer'?'customer' as const:'staff' as const})),{tenantId:tenant,id:agent.id,kind:'staff'}],
    limits:{ticketLimit:20,mutationLimit:20,recoveryReserve:2,uploadLimit:2}});
  await f.enableCombinedTicketAdmission();
  for(const [id,email,priority] of [['sla-a','match@example.test','urgent'],['sla-b','match@example.test','normal'],['sla-other','other@example.test','urgent']]){
   await f.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,source,priority) VALUES(?,?,? ,?,'fixture',?)").bind(tenant,id,'needle '+id,email,priority).run();
  }
  await f.db.prepare(`UPDATE tickets SET priority_category='information-requests',priority_scope='isolated',
   priority_regulatory_officer_on_site=0,priority_vip_blocked=0,priority_hard_deadline=0,
   priority_score=1,contract_sla_tier='alpha',criticality_tier=4 WHERE tenant_id=? AND id='sla-a'`).bind(tenant).run();
  await f.db.prepare("INSERT INTO ticket_filters(tenant_id,id,name,conditions) VALUES(?,'sla-saved','Synthetic','[]')").bind(tenant).run();
  const outcomes:string[]=[],original=apiTicketBudgetCache.settleOperation.bind(apiTicketBudgetCache);
  apiTicketBudgetCache.settleOperation=(authority,outcome,now)=>{outcomes.push(outcome);original(authority,outcome,now);};
  try{
   const first=await f.request(url+'&filter_id=sla-saved',{token:agent.token});assert.equal(first.status,200,await first.clone().text());
   const body=await first.json<{data:Array<{id:string}>;meta:{total:number;page:number};sla:Record<string,unknown>;asOf:string;next:string}>();
   assert.equal(body.meta.total,2);assert.equal(body.meta.page,1);assert.equal(body.data[0].id,'sla-a');assert.ok('sla-a' in body.sla);assert.ok(body.next);assert.ok(Number.isFinite(Date.parse(body.asOf)));
   assert.deepEqual(outcomes,['committed','committed']);
   const matrix=await f.request('/api/tickets?sort=priority_focus&limit=1&search=needle&customer_email=match%40example.test',{token:agent.token});
   assert.equal(matrix.status,200,await matrix.clone().text());
   const matrixBody=await matrix.json<{data:Array<{id:string;priority_score:number}>;priorityClocks:Record<string,{remainingHours:number;paused:boolean;asOf:string}|null>;sla:Record<string,unknown>;next:string}>();
   assert.equal(matrixBody.data[0].id,'sla-a');assert.equal(matrixBody.data[0].priority_score,1);
   assert.equal(typeof matrixBody.priorityClocks['sla-a']?.remainingHours,'number');
   assert.equal(matrixBody.priorityClocks['sla-a']?.paused,false);
   assert.ok('sla-a' in matrixBody.sla);assert.ok(matrixBody.next);
   const next=await f.request(url+'&filter_id=sla-saved&cursor='+encodeURIComponent(body.next),{token:agent.token});assert.equal(next.status,200,await next.clone().text());
   const second=await next.json<{data:Array<{id:string}>;meta:{page:number};next:null}>();assert.equal(second.meta.page,2);assert.equal(second.data[0].id,'sla-b');assert.equal(second.next,null);
   assert.equal((await f.request(url+'&page=2',{token:agent.token})).status,409);
   assert.equal((await f.request(url+'&offset=0',{token:agent.token})).status,400,'offset is unsupported even when zero');
   assert.equal((await f.request(url+'&page=2&cursor='+encodeURIComponent(body.next),{token:agent.token})).status,409,'numbered pagination cannot contradict the signed cursor');
   const empty=await f.request('/api/tickets?sort=sla_priority&limit=20&customer_email=absent%40example.test',{token:agent.token});
   assert.equal(empty.status,200,await empty.clone().text());
   const emptyBody=await empty.json<{data:unknown[];meta:{total:number;total_pages:number;page:number};sla:Record<string,unknown>;next:null}>();
   assert.deepEqual(emptyBody.data,[]);assert.deepEqual(emptyBody.sla,{});assert.equal(emptyBody.meta.total,0);assert.equal(emptyBody.meta.total_pages,0);assert.equal(emptyBody.meta.page,1);assert.equal(emptyBody.next,null);

   await f.db.prepare("UPDATE ticket_filters SET conditions='[ ]' WHERE tenant_id=? AND id='sla-saved'").bind(tenant).run();
   const changed=await f.request(url+'&filter_id=sla-saved&cursor='+encodeURIComponent(body.next),{token:agent.token});assert.equal(changed.status,409);
   assert.equal(outcomes.at(-1),'unknown','changed input never settles final stage committed');
   await f.db.prepare('UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND id=?').bind(tenant,agent.id).run();
   assert.notEqual((await f.request(url,{token:agent.token})).status,200,'revoked credential gets no snapshot');
  }finally{apiTicketBudgetCache.settleOperation=original;}
 });
});
