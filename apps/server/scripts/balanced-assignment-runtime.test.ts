import assert from 'node:assert/strict';
import test from 'node:test';
import {SignJWT} from 'jose';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import type {D1Database,DurableObjectNamespace} from '@cloudflare/workers-types';
import {splitSql} from './split-sql';
import {createVerifiedTenantScope,createSystemTenantScope} from '../src/auth/scope';
import {BudgetAuthorityRepository} from '../src/repositories/budget-authority.repository';
import {SessionBudgetAdmissionService} from '../src/budgets/session-admission.service';
import {IsolateBudgetAdmissionCache} from '../src/budgets/isolate-admission.service';
import {BalancedAssignmentService,BALANCED_ASSIGNMENT_ENVELOPE} from '../src/services/balanced-assignment.service';
import {BalancedAssignmentRepository,BALANCED_ASSIGNMENT_DECISION_SQL} from '../src/repositories/balanced-assignment.repository';
import {OperatorActivityRepository} from '../src/repositories/operator-activity.repository';
import type {BalancedAssignmentCommit,BalancedAssignmentDecision} from '../src/types/balanced-assignment';
import {RetentionAdmissionRepository} from '../src/repositories/retention-admission.repository';
import {auditedTicketUpdateStatements} from '../src/repositories/conversation-audit.repository';
import type {Ticket} from '../src/types';
import type {BudgetCoordinatorDO} from '../src/durable_objects/BudgetCoordinatorDO';

async function fixture(http=false){
 const root=resolve(import.meta.dirname,'..');
 const bundle=await build({absWorkingDir:root,entryPoints:[http?'scripts/budget-admission-runtime-entry.ts':'scripts/budget-coordinator-do-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'routing-proof',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
  bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',DISABLE_RATE_LIMIT:'true',JWT_SECRET:'synthetic-balanced-secret-at-least-32-characters'},
  d1Databases:{DB:'routing-proof'},durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO'},unsafeEphemeralDurableObjects:true}]}));
 try{
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync(join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort())await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));
 const now=Date.now(),limits={...Object.fromEntries(Object.keys(BALANCED_ASSIGNMENT_ENVELOPE).map(k=>[k,100_000_000])),workerRequests:10000,doRequests:10000,doRowsRead:10000,doRowsWritten:10000};
 const policy={schemaVersion:1,policyId:'routing-policy',revision:1,deploymentId:'routing-deployment',mode:'conservative',catalogueVersion:'synthetic',maxGrantLifetimeMs:60_000,
 budgets:Object.entries(limits).map(([dimension,limit])=>({dimension,limit,allocationId:`routing-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',window:dimension==='d1StorageBytes'?{kind:'stock',id:'routing-stock'}:{kind:'interval',id:'routing-window',startsAt:now-1,endsAt:now+3_600_000}}))};
 await db.batch([db.prepare("INSERT INTO budget_deployment_authority VALUES('routing-deployment',1,'active',?)").bind(now),db.prepare("INSERT INTO budget_owner_policies VALUES('routing-deployment','routing-policy',1,1,'routing-aggregate',128,30000,?)").bind(JSON.stringify(policy))]);
 for(const tenant of ['a','b'])await db.batch([
  db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'actor',?,'agent',1,1)").bind(tenant,`actor-${tenant}@example.test`),
  db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES(?,'group','Synthetic group')").bind(tenant),
  db.prepare("INSERT INTO user_groups(tenant_id,user_id,group_id) VALUES(?,'actor','group')").bind(tenant),
  db.prepare("INSERT INTO budget_tenant_allocations VALUES('routing-deployment',?,'routing-policy',1,1,?,?,'active')").bind(tenant,`routing-${tenant}`,JSON.stringify({schemaVersion:1,tenantId:tenant,ownerPolicyId:'routing-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]})),
 ]);
 const raw=await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
 const coordinator=raw.get(raw.idFromName('routing-aggregate')) as unknown as BudgetCoordinatorDO;
 const namespace={idFromName:(n:string)=>raw.idFromName(n),get:()=>({refreshFromTrustedAuthority:(x:Parameters<BudgetCoordinatorDO['refreshFromTrustedAuthority']>[0])=>coordinator.refreshFromTrustedAuthority(x),reserveFromTrustedAuthority:(x:Parameters<BudgetCoordinatorDO['reserveFromTrustedAuthority']>[0])=>coordinator.reserveFromTrustedAuthority(x)})} as unknown as DurableObjectNamespace;
 const admittedAuthorities:unknown[]=[];
 class Admission extends SessionBudgetAdmissionService{override async admit(input:Parameters<SessionBudgetAdmissionService['admit']>[0]){const result=await super.admit(input);if('commitAuthority' in result&&result.commitAuthority)admittedAuthorities.push(result.commitAuthority);return result;}}
 const cache=new IsolateBudgetAdmissionCache(),admission=new Admission(cache);
 const batches:{reads:number;writes:number}[]=[];
 const observed=new Proxy(db,{get(target,key){if(key==='batch')return async(statements:any[])=>{const r=await target.batch(statements);batches.push({reads:r.reduce((n,x)=>n+x.meta.rows_read,0),writes:r.reduce((n,x)=>n+x.meta.rows_written,0)});return r;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 let beforeCommit:((c:BalancedAssignmentCommit,d:BalancedAssignmentDecision)=>Promise<void>)|undefined;
 let loseCommittedResponse=false;
 class Repository extends BalancedAssignmentRepository{override async commit(c:BalancedAssignmentCommit,d:BalancedAssignmentDecision,at:string){const action=beforeCommit;beforeCommit=undefined;if(action)await action(c,d);const result=await super.commit(c,d,at);if(loseCommittedResponse){loseCommittedResponse=false;throw new Error("synthetic lost committed response");}return result;}}
 const settlements:{authority:unknown;state:string}[]=[];
 const service=(tenant='a')=>{const scope=createVerifiedTenantScope(tenant,'actor',['agent'],1);return new BalancedAssignmentService(observed,scope,{tenantId:tenant,actorId:'actor',role:'agent',sessionVersion:1,expiresAt:Math.floor(Date.now()/1000)+3600,mfaVerified:true},
  new Repository(observed,scope,new OperatorActivityRepository(scope,observed)),{service:admission,repository:new BudgetAuthorityRepository(db,scope),namespace,now:()=>Date.now(),settle:(authority,state,time)=>{settlements.push({authority,state});cache.settleOperation(authority,state,time);}});};
 const ticket=async(id:string,tenant='a',owner:string|null=null,status='open')=>{await db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,source,group_id,assigned_to,status) VALUES(?,?,?,'synthetic@example.test','dashboard','group',?,?)").bind(tenant,id,id,owner,status).run();};
 const candidate=async(id:string,load=0,ceiling=5,available=true,configured=true,sequence=0,tenant='a')=>{
  await db.prepare("INSERT OR IGNORE INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,?,?,'agent',1,1)").bind(tenant,id,`${id}-${tenant}@example.test`).run();
  await db.prepare("INSERT OR IGNORE INTO user_groups(tenant_id,user_id,group_id) VALUES(?,?,'group')").bind(tenant,id).run();
  if(configured)await db.prepare("INSERT INTO operator_capacity VALUES(?,?,1,?,?,?,'actor')").bind(tenant,id,available?'available':'unavailable',ceiling,new Date().toISOString()).run();
  if(sequence){await db.prepare('INSERT INTO operator_routing_sequence VALUES(?,?,?)').bind(tenant,id,sequence).run();await db.prepare('INSERT INTO tenant_routing_sequence VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET sequence=max(sequence,excluded.sequence)').bind(tenant,sequence).run();}
  for(let n=0;n<load;n++)await ticket(`work-${id}-${n}`,tenant,id,n%2?'pending':'open');
 };
 const execute=async(ticketId:string,key:string,tenant='a')=>{const current=service(tenant);try{const result=await current.execute(ticketId,key);current.finish(result);return result;}catch(error){current.finish();throw error;}};
 return {db,mf,batches,service,settlements,admittedAuthorities,execute,ticket,candidate,loseResponse:()=>{loseCommittedResponse=true;},before:(action:typeof beforeCommit)=>{beforeCommit=action;}};
 }catch(e){await mf.dispose();throw e;}
}

test('native balanced action ranks current work, persists canonical audit/activity and replays without another assignment',async()=>{
 const f=await fixture();try{
 await f.candidate('a',1,5,true,true,2);await f.candidate('b',2,5,true,true,1);await f.ticket('target');
 const result=await f.execute('target','rank');assert.equal(result.ownerId,'a');assert.equal(result.replayed,false);
 assert.equal((await f.execute('target','rank')).replayed,true);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='a' AND ticket_id='target' AND kind='ticket.assignment_changed'").first<{n:number}>())?.n,1);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_activities WHERE tenant_id='a' AND ticket_id='target' AND kind='assignment'").first<{n:number}>())?.n,1);
 assert.equal((await f.db.prepare("SELECT sequence FROM tenant_routing_sequence WHERE tenant_id='a'").first<{sequence:number}>())?.sequence,3);
 console.log('routing observed batches',JSON.stringify(f.batches));
 }finally{await f.mf.dispose();}
});

for(const [name,firstSeq,secondSeq,winner] of [['least-recent tie',2,1,'b'],['stable-ID tie',1,1,'a']] as const)test(`native fairness: ${name}`,async()=>{
 const f=await fixture();try{await f.candidate('a',1,5,true,true,firstSeq);await f.candidate('b',1,5,true,true,secondSeq);await f.ticket('target');
 assert.equal((await f.execute('target','tie')).ownerId,winner);
 }finally{await f.mf.dispose();}
});

test('native no-capacity outcome is durable, replay-safe and excludes absent, zero, full and unavailable policies',async()=>{
 const f=await fixture();try{
 await f.candidate('a',0,5,true,false);await f.candidate('b',0,0);await f.candidate('c',5,5);await f.candidate('d',0,5,false);await f.ticket('target');
 const r=await f.execute('target','empty');assert.equal(r.outcome,'no_capacity');assert.equal(r.ownerId,null);
 await f.db.prepare("UPDATE operator_capacity SET assignment_ceiling=10 WHERE tenant_id='a' AND user_id='b'").run();
 assert.equal((await f.execute('target','empty')).outcome,'no_capacity','same key replays original decision');
 assert.equal((await f.execute('target','explicit-new-action')).ownerId,'b');
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM balanced_assignment_receipts WHERE tenant_id='a'").first<{n:number}>())?.n,2);
 }finally{await f.mf.dispose();}
});

test('native concurrent last-slot assignments never exceed capacity; a stale ranking rolls back the cursor, event and receipt',async()=>{
 const f=await fixture();try{
 await f.candidate('a',0,1);await f.ticket('first');await f.ticket('second');
 const results=await Promise.allSettled([f.execute('first','one'),f.execute('second','two')]);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.outcome==='assigned').length,1);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM tickets WHERE tenant_id='a' AND assigned_to='a'").first<{n:number}>())?.n,1);
 assert.equal((await f.db.prepare("SELECT sequence FROM tenant_routing_sequence WHERE tenant_id='a'").first<{sequence:number}>())?.sequence,1);
 // Canonical action must reject a policy change occurring after its advisory decision.
 await f.db.prepare("UPDATE operator_capacity SET assignment_ceiling=3 WHERE tenant_id='a' AND user_id='a'").run();await f.ticket('stale');
 f.before(async()=>{await f.db.prepare("UPDATE operator_capacity SET availability='unavailable',revision=revision+1 WHERE tenant_id='a' AND user_id='a'").run();});
 await assert.rejects(f.execute('stale','stale'));
 assert.equal((await f.db.prepare("SELECT assigned_to FROM tickets WHERE tenant_id='a' AND id='stale'").first<{assigned_to:string|null}>())?.assigned_to,null);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM balanced_assignment_receipts WHERE tenant_id='a' AND ticket_id='stale'").first<{n:number}>())?.n,0);
 assert.equal((await f.db.prepare("SELECT sequence FROM tenant_routing_sequence WHERE tenant_id='a'").first<{sequence:number}>())?.sequence,1);
 }finally{await f.mf.dispose();}
});

test('native current group/session/tenant authority and actionable-owner fences match manual eligibility',async()=>{
 const f=await fixture();try{
 await f.candidate('a');await f.candidate('a',0,5,true,true,0,'b');await f.ticket('same');await f.ticket('same','b');await f.ticket('foreign','b');
 await assert.rejects(f.execute('foreign','foreign'));
 assert.equal((await f.execute('same','samekey','b')).ownerId,'a');
 assert.equal((await f.execute('same','samekey')).ownerId,'a');
 await f.ticket('snoozed');await f.db.prepare("UPDATE ticket_support_state SET snoozed_until='2099-01-01T00:00:00.000Z' WHERE tenant_id='a' AND ticket_id='snoozed'").run();
 await assert.rejects(f.execute('snoozed','snooze'));
 await f.ticket('session-revoked');f.before(async()=>{await f.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='a' AND id='actor'").run();});
 await assert.rejects(f.execute('session-revoked','session-revoke'));
 assert.equal((await f.db.prepare("SELECT assigned_to FROM tickets WHERE tenant_id='a' AND id='session-revoked'").first<{assigned_to:string|null}>())?.assigned_to,null);
 await f.db.prepare("UPDATE users SET session_version=1 WHERE tenant_id='a' AND id='actor'").run();
 await f.ticket('revoked');f.before(async()=>{await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='a' AND user_id='actor' AND group_id='group'").run();});
 await assert.rejects(f.execute('revoked','revoke'));
 assert.equal((await f.db.prepare("SELECT assigned_to FROM tickets WHERE tenant_id='a' AND id='revoked'").first<{assigned_to:string|null}>())?.assigned_to,null);
 }finally{await f.mf.dispose();}
});

test('native indexed pool sentinel rejects overflow before sampling candidates',async()=>{
 const f=await fixture();try{
 for(let n=0;n<65;n++)await f.candidate(`candidate-${String(n).padStart(2,'0')}`);
 await f.ticket('target');await assert.rejects(f.execute('target','overflow'),e=>e instanceof Error&&e.message==='routing_unavailable');
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM balanced_assignment_receipts WHERE tenant_id='a'").first<{n:number}>())?.n,0);
 const plan=await f.db.prepare('EXPLAIN QUERY PLAN '+BALANCED_ASSIGNMENT_DECISION_SQL).bind('a','target','a').all<{detail:string}>();
 const details=plan.results.map(r=>r.detail).join('\n');assert.match(details,/idx_operator_capacity_available.*tenant_id=.*availability=/);
 assert.match(details,/idx_tickets_capacity_load.*tenant_id=.*assigned_to=.*status=/);
 console.log('routing bounded plan',details);
 }finally{await f.mf.dispose();}
});

test('native full 64-policy workload probes remain inside the analytical envelope, independent of other tenants',async()=>{
 const f=await fixture();try{
 for(let n=0;n<64;n++)await f.candidate(`load-${String(n).padStart(2,'0')}`,0,1000);
 // Synthetic workload rows exercise the real covering index and canonical insert triggers.
 for(let start=0;start<64;start+=8)await f.db.batch(Array.from({length:8},(_,i)=>{
  const owner=`load-${String(start+i).padStart(2,'0')}`;
  return f.db.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1001)
   INSERT INTO tickets(tenant_id,id,subject,customer_email,source,group_id,assigned_to,status)
   SELECT 'a',?||'-'||x,'Synthetic','load@example.test','dashboard','group',?,CASE WHEN x%2=0 THEN 'pending' ELSE 'open' END FROM n`).bind(owner,owner);
 }));
 await f.candidate('foreign-available',0,5,true,true,0,'b');await f.ticket('target');f.batches.length=0;
 const r=await f.execute('target','max-work');assert.equal(r.outcome,'no_capacity');
 const reads=f.batches.reduce((n,b)=>n+b.reads,0),writes=f.batches.reduce((n,b)=>n+b.writes,0);
 assert.ok(reads<=BALANCED_ASSIGNMENT_ENVELOPE.d1RowsRead,`${reads}`);assert.ok(writes<=BALANCED_ASSIGNMENT_ENVELOPE.d1RowsWritten,`${writes}`);
 console.log('routing maximum workload',JSON.stringify({reads,writes,candidates:64,perCandidateRows:1001}));
 }finally{await f.mf.dispose();}
});

test('native normal canonical assignment can win the last slot before balancing without exceeding capacity',async()=>{
 const f=await fixture();try{
 await f.candidate('a',0,1);await f.ticket('balanced');await f.ticket('manual');
 f.before(async()=>{const scope=createVerifiedTenantScope('a','actor',['agent'],1);
  await f.db.batch(auditedTicketUpdateStatements(f.db,scope,undefined,'manual',{assigned_to:'a'},{kind:'staff',id:'actor',source:'dashboard'},true,null).statements);});
 await assert.rejects(f.execute('balanced','manual-race'));
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM tickets WHERE tenant_id='a' AND assigned_to='a'").first<{n:number}>())?.n,1);
 assert.equal((await f.db.prepare("SELECT assigned_to FROM tickets WHERE tenant_id='a' AND id='balanced'").first<{assigned_to:string|null}>())?.assigned_to,null);
 }finally{await f.mf.dispose();}
});

function measuredD1(database:D1Database){
 const totals={reads:0,writes:0};const unwrap=new WeakMap<object,object>();
 const record=(r:any)=>{totals.reads+=r.meta?.rows_read??0;totals.writes+=r.meta?.rows_written??0;return r;};
 const statement=(source:any):any=>{const proxy=new Proxy(source,{get(target,key){const value=Reflect.get(target,key);
  if(key==='bind')return(...args:any[])=>statement(value.apply(target,args));
  if(key==='first')return async()=>record(await target.all()).results[0]??null;
  if(key==='run'||key==='all')return async()=>record(await value.call(target));
  return typeof value==='function'?value.bind(target):value;}});unwrap.set(proxy,source);return proxy;};
 const db=new Proxy(database,{get(target,key){if(key==='prepare')return(sql:string)=>statement(target.prepare(sql));
  if(key==='batch')return async(items:any[])=>{const results=await target.batch(items.map(i=>unwrap.get(i)??i) as any);results.forEach(record);return results;};
  const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 return {db,totals};
}

test('native retention redacts routing receipts one per gated step and preserves foreign-tenant history and gone replay',async()=>{
 const f=await fixture();try{
 await f.ticket('retained');await f.ticket('retained','b');
 assert.equal((await f.execute('retained','original')).outcome,'no_capacity');
 await f.db.prepare("UPDATE tickets SET status='closed',updated_at='2000-01-01T00:00:00.000Z' WHERE tenant_id='a' AND id='retained'").run();
 const action=JSON.stringify({days_to_keep:1,delete_attachments:true});
 await f.db.prepare("INSERT INTO automation_rules(tenant_id,id,name,event_type,action_type,action_config,is_active) VALUES('a','retention-rule','Synthetic','scheduled.retention','retention',?,1)").bind(action).run();
 for(const tenant of ['a','b'])await f.db.batch(Array.from({length:129},(_,n)=>f.db.prepare(`INSERT INTO balanced_assignment_receipts
  (tenant_id,actor_id,key_hash,ticket_id,payload_hash,outcome,owner_id,sequence,created_at,expires_at)
  VALUES(?,'actor',?,'retained',?,'no_capacity',NULL,0,'2026-09-13T00:00:00.000Z',9999999999)`).bind(tenant,`synthetic-${n}`,'f'.repeat(64))));
 const rule={id:'retention-rule',action_config:action};const scope=createSystemTenantScope({tenantId:'a',actor:'scheduled-retention'});
 const measured=measuredD1(f.db),repo=new RetentionAdmissionRepository(measured.db,scope);
 const source=await f.db.prepare("SELECT * FROM tickets WHERE tenant_id='a' AND id='retained'").first<Ticket>();assert.ok(source);
 const claim=await repo.claimEligible(source,'2026-09-10T00:00:00.000Z',rule);assert.ok(claim);
 await f.db.prepare("INSERT INTO retention_cleanup_work(tenant_id,ticket_id,claim_token,item_key,item_kind,state) VALUES('a','retained',?,'finalize','finalize','pending')").bind(claim.token).run();
 let turns=0,maxReads=0,maxWrites=0;
 while(await f.db.prepare("SELECT 1 FROM tickets WHERE tenant_id='a' AND id='retained'").first()){
  assert.ok(++turns<160);const before={...measured.totals};
  const item=await repo.claimNext('retained',claim.token,'2026-09-13T00:00:00.000Z','2099-01-01T00:00:00.000Z');assert.ok(item);
  assert.equal(await repo.recordAdmission('retained','finalize',claim.token,item.attemptToken,rule),true);
  const outcome=await repo.finalizeOne('retained',claim.token,item.attemptToken,rule);
  if(outcome==='more')assert.equal(await repo.continueItem('retained','finalize',claim.token,item.attemptToken),true);else assert.equal(outcome,'deleted');
  const writes=measured.totals.writes-before.writes,reads=measured.totals.reads-before.reads;
  assert.ok(writes<=128,`${writes}`);assert.ok(reads<=2560,`${reads}`);maxWrites=Math.max(maxWrites,writes);maxReads=Math.max(maxReads,reads);
 }
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM balanced_assignment_receipts WHERE tenant_id='a' AND lifecycle='gone' AND ticket_id IS NULL AND owner_id IS NULL AND outcome IS NULL").first<{n:number}>())?.n,130);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM balanced_assignment_receipts WHERE tenant_id='b' AND lifecycle='completed' AND ticket_id='retained'").first<{n:number}>())?.n,129);
 await f.ticket('retained');await assert.rejects(f.execute('retained','original'),e=>e instanceof Error&&e.message==='routing_result_gone');
 console.log('routing retention bound',JSON.stringify({turns,maxReads,maxWrites,receipts:130}));
 }finally{await f.mf.dispose();}
});

test('native storage inventory does not copy names, subject, custom fields or prior ticket snapshots into routing storage',async()=>{
 const f=await fixture();try{
 await f.candidate('a');await f.ticket('target');
 const marker='synthetic-private-'.repeat(2000);
 await f.db.prepare("UPDATE users SET full_name=? WHERE tenant_id='a' AND id='a'").bind(marker).run();
 await f.db.prepare("UPDATE tickets SET subject=?,custom_fields=? WHERE tenant_id='a' AND id='target'").bind(marker,JSON.stringify({private:marker})).run();
 assert.equal((await f.execute('target','bounded-storage')).outcome,'assigned');
 const receipt=await f.db.prepare("SELECT * FROM balanced_assignment_receipts WHERE tenant_id='a'").first();assert.ok(receipt);assert.ok(!JSON.stringify(receipt).includes('synthetic-private'));
 const events=await f.db.prepare("SELECT facts FROM conversation_events WHERE tenant_id='a' AND ticket_id='target' AND kind='ticket.assignment_changed'").all<{facts:string}>();assert.ok(events.results.every(r=>!r.facts.includes('synthetic-private')));
 const names=['balanced_assignment_receipts','tenant_routing_sequence','operator_routing_sequence','conversation_events','articles','operator_activities','budget_grant_operations','budget_mutation_assertion','operator_capacity','tickets'];
 const inventory:Record<string,unknown>={};
 for(const name of names){const indexes=await f.db.prepare(`PRAGMA index_list('${name}')`).all<{name:string}>();
  inventory[name]=await Promise.all(indexes.results.map(async(index)=>({name:index.name,columns:(await f.db.prepare(`PRAGMA index_info('${index.name}')`).all<{name:string}>()).results.map(r=>r.name)})));}
 const expectedIndexCounts:Record<string,number>={balanced_assignment_receipts:3,tenant_routing_sequence:1,operator_routing_sequence:1,
  conversation_events:7,articles:5,operator_activities:6,budget_grant_operations:1,budget_mutation_assertion:1,operator_capacity:2,tickets:8};
 for(const [name,count]of Object.entries(expectedIndexCounts))assert.equal((inventory[name] as unknown[]).length,count,`${name} index inventory changed`);
 const ticketIndexes=inventory.tickets as {columns:string[]}[];assert.equal(ticketIndexes.filter(i=>i.columns.includes('assigned_to')).length,2);
 // Logical encoded row/key payload allowance with record-header padding, not physical D1 page billing.
 // Detailed per-column/index assumptions are preserved in the evidence receipt.
 const stock={receipt:6144,tenantSequence:2304,operatorSequence:2560,event:14848,note:9728,activity:11264,grant:12288,assertion:4096,ticketGrowth:1024};
 const total=Object.values(stock).reduce((a,b)=>a+b,0);assert.equal(total,64256);assert.ok(total<=BALANCED_ASSIGNMENT_ENVELOPE.d1StorageBytes);
 console.log('routing stock index inventory',JSON.stringify(inventory));console.log('routing logical stock bound',JSON.stringify({stock,total}));
 }finally{await f.mf.dispose();}
});


test('native route completion retains exact admission authority and settles acknowledged outcomes once only',async()=>{
 const f=await fixture();try{
 await f.candidate('a');await f.ticket('recovered');await f.ticket('confirmed');await f.ticket('response-failure');await f.ticket('uncertain');
 const confirmed=f.service(),result=await confirmed.execute('confirmed','confirmed');
 assert.equal(f.settlements.length,0,'canonical success does not settle before response construction');
 confirmed.finish(result);confirmed.finish();
 assert.equal(f.settlements.length,1);assert.equal(f.settlements[0].state,'committed');
 assert.strictEqual(f.settlements[0].authority,f.admittedAuthorities[0],'retain original authority reference');
 const responseFailure=f.service(),other=await responseFailure.execute('response-failure','response-failure');
 responseFailure.finish({...other});responseFailure.finish(other);
 assert.equal(f.settlements.length,2);assert.equal(f.settlements[1].state,'unknown','an unacknowledged result cannot promote settlement');
 assert.strictEqual(f.settlements[1].authority,f.admittedAuthorities[1]);
 f.before(async()=>{await f.db.prepare("UPDATE operator_capacity SET availability='unavailable',revision=revision+1 WHERE tenant_id='a' AND user_id='a'").run();});
 const uncertain=f.service();await assert.rejects(uncertain.execute('uncertain','uncertain'));
 assert.equal(f.settlements.length,2);uncertain.finish(result);uncertain.finish();
 assert.equal(f.settlements.length,3);assert.equal(f.settlements[2].state,'unknown');
 assert.strictEqual(f.settlements[2].authority,f.admittedAuthorities[2]);
 await f.db.prepare("UPDATE operator_capacity SET availability='available' WHERE tenant_id='a' AND user_id='a'").run();
 f.loseResponse();const recovered=f.service(),replay=await recovered.execute('recovered','recovered');
 assert.equal(replay.replayed,true);assert.equal(f.settlements.length,3);
 recovered.finish(replay);assert.equal(f.settlements[3].state,'committed');
 assert.strictEqual(f.settlements[3].authority,f.admittedAuthorities[3]);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='a' AND ticket_id='recovered' AND kind='ticket.assignment_changed'").first<{n:number}>())?.n,1);

 }finally{await f.mf.dispose();}
});


test('native unsupported stored candidate identity fails the whole pool without sampling or truncation',async()=>{
 const f=await fixture();try{
 await f.candidate('valid');await f.candidate('x'.repeat(129));await f.ticket('target');
 await assert.rejects(f.execute('target','unsupported'),e=>e instanceof Error&&e.message==='routing_unavailable');
 assert.equal((await f.db.prepare("SELECT assigned_to FROM tickets WHERE tenant_id='a' AND id='target'").first<{assigned_to:string|null}>())?.assigned_to,null);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM balanced_assignment_receipts WHERE tenant_id='a'").first<{n:number}>())?.n,0);
 }finally{await f.mf.dispose();}
});


test('native mounted HTTP balance action enforces current authentication, bounded empty body and durable result responses',async()=>{
 const f=await fixture(true);try{
 const token=await new SignJWT({sub:'actor',tenant_id:'a',role:'agent',session_version:1,mfa_verified:true})
  .setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h')
  .sign(new TextEncoder().encode('synthetic-balanced-secret-at-least-32-characters'));
 const request=(key?:string,body?:string,auth=true)=>f.mf.dispatchFetch('http://local/api/tickets/target/balanced-assignment',{
  method:'POST',headers:{...(auth?{Authorization:`Bearer ${token}`} : {}),...(key?{'Idempotency-Key':key}:{}),'Content-Type':'application/json'},body});
 await f.ticket('target');
 assert.equal((await request('unauthorized',undefined,false)).status,401);
 assert.equal((await request()).status,400);
 assert.equal((await request('extra','{"ownerId":"a"}')).status,400);
 assert.equal((await request('large','x'.repeat(1025))).status,413);
 let response=await request('empty');assert.equal(response.status,200,await response.clone().text());
 assert.equal((await response.json() as any).outcome,'no_capacity');assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 await f.candidate('a');response=await request('assigned','{}');assert.equal(response.status,200,await response.clone().text());
 const assigned=await response.json() as any;assert.equal(assigned.ownerId,'a');assert.equal(assigned.outcome,'assigned');assert.equal('sequence' in assigned,false);
 response=await request('assigned');assert.equal(response.status,200);assert.equal(response.headers.get('Idempotency-Replayed'),'true');
 assert.equal((await response.json() as any).replayed,true);
 await f.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='a' AND id='actor'").run();
 assert.equal((await request('revoked')).status,401);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='a' AND ticket_id='target' AND kind='ticket.assignment_changed'").first<{n:number}>())?.n,1);
 }finally{await f.mf.dispose();}
});
