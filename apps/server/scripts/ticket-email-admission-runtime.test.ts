import assert from 'node:assert/strict';
import test from 'node:test';
import { SignJWT } from 'jose';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { isolateWarmReservedEnvelope } from '../src/budgets/isolate-grant-holder';
import { STAFF_TICKET_ENVELOPES } from '../src/middleware/budget-admission.middleware';
import { TICKET_EMAIL_DELIVERY_ENVELOPE, ticketEmailDeliveryEnvelope } from '../src/services/email/ticket-email-admission.service';

import { TICKET_EMAIL_ATTACHMENT_MANIFEST_SQL } from '../src/repositories/ticket-email-admission.repository';

const root=resolve(import.meta.dirname,'..');
const jwtSecret='synthetic-ticket-email-runtime-secret-32-chars';
const tenant='runtime-tenant',staff='runtime-staff',ticket='ticket';
const otherTenant='runtime-tenant-b';
type Metric={path:string;method:string;d1RowsRead:number;d1RowsWritten:number;d1Calls:number;r2Gets:number};

async function applyMigrations(db:D1Database){for(const file of readdirSync(join(root,'migrations')).filter(file=>file.endsWith('.sql')).sort())
  await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));}
function policy(){const dimensions=['workerRequests','d1RowsRead','d1RowsWritten','r2ClassBOperations','doRequests','doRowsRead','doRowsWritten','logEvents'] as const;
  return {schemaVersion:1,policyId:'runtime-policy',revision:1,deploymentId:'runtime-deployment',mode:'conservative',catalogueVersion:'runtime',maxGrantLifetimeMs:60_000,
    budgets:dimensions.map(dimension=>({dimension,allocationId:`runtime-${dimension}`,window:{kind:'interval',id:'runtime-window',startsAt:Date.now()-1_000,endsAt:Date.now()+60_000},
      limit:200_000_000,recoveryPercent:20,provenance:'owner-allocation'}))};}
async function seed(db:D1Database,history:number){const owner=policy();const restriction={schemaVersion:1,tenantId:tenant,ownerPolicyId:owner.policyId,ownerPolicyRevision:1,revision:1,
  mode:'conservative',limits:Object.fromEntries(owner.budgets.map(item=>[item.dimension,item.limit])),disabledFeatures:[]};
  await db.batch([
    db.prepare("INSERT INTO budget_deployment_authority(deployment_id,authority_revision,state,updated_at) VALUES('runtime-deployment',1,'active',?)").bind(Date.now()),
    db.prepare(`INSERT INTO budget_owner_policies(deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES('runtime-deployment','runtime-policy',1,1,'runtime-coordinator',64,60000,?)`).bind(JSON.stringify(owner)),
    db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES('runtime-deployment',?,'runtime-policy',1,1,'runtime-namespace',?,'active')`).bind(tenant,JSON.stringify(restriction)),
    db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES('runtime-deployment',?,'runtime-policy',1,1,'runtime-namespace-b',?,'active')`).bind(otherTenant,JSON.stringify({...restriction,tenantId:otherTenant})),
    db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,?,'staff@example.test','agent',1,1)").bind(tenant,staff),
    db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'customer','tocyn-auth-test-a@example.invalid','customer',1,0)").bind(tenant),
    db.prepare(`INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,source,group_id)
      VALUES(?,?,'Admission ticket','customer','tocyn-auth-test-a@example.invalid','dashboard',NULL)`).bind(tenant,ticket),
    db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,?,'staff-b@example.test','agent',1,1)").bind(otherTenant,staff),
    db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'customer','tocyn-auth-test-b@example.invalid','customer',1,0)").bind(otherTenant),
    db.prepare(`INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,source,group_id)
      VALUES(?,?,'Admission ticket B','customer','tocyn-auth-test-b@example.invalid','dashboard',NULL)`).bind(otherTenant,ticket),
    db.prepare(`INSERT INTO articles(tenant_id,id,ticket_id,sender_type,body,body_format,is_internal)
      VALUES(?,'historical-article',?,'agent','history','plain',1)`).bind(tenant,ticket),
  ]);
  for(let offset=0;offset<history;offset+=100)await db.batch(Array.from({length:Math.min(100,history-offset)},(_,index)=>{const id=offset+index;
    return db.prepare(`INSERT INTO attachments(tenant_id,id,article_id,file_name,file_size,content_type,r2_key)
      VALUES(?,?,?,'history.txt',1,'text/plain',?)`).bind(tenant,`history-${id}`,'historical-article',`history/${id}`);}));
}
async function runtime(history=3_000){const bundled=await build({entryPoints:[resolve(import.meta.dirname,'ticket-email-admission-runtime-entry.ts')],bundle:true,format:'esm',platform:'neutral',
  external:['cloudflare:workers','node:crypto','node:async_hooks'],write:false});const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'ticket-email-admission',modules:true,
    compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundled.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',DISABLE_RATE_LIMIT:'true',ENVIRONMENT:'local',JWT_SECRET:jwtSecret,APP_MASTER_KEY:'synthetic-master-key-32-characters'},
    d1Databases:{DB:'ticket-email-admission-d1'},r2Buckets:{ATTACHMENTS_BUCKET:'ticket-email-admission-r2'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  const db=await mf.getD1Database('DB');await applyMigrations(db);await seed(db,history);const bucket=await mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket;
  const token=await new SignJWT({sub:staff,role:'agent',tenant_id:tenant,session_version:1,mfa_verified:true}).setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(jwtSecret));
  const otherToken=await new SignJWT({sub:staff,role:'agent',tenant_id:otherTenant,session_version:1,mfa_verified:true}).setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(jwtSecret));
  const control=async(input?:object)=>(await (await mf.dispatchFetch('http://runtime.test/__ticket-email-control',input?{method:'POST',body:JSON.stringify(input)}:undefined)).json()) as {attempts:Metric[];messages:{to:string;subject:string}[];cache:unknown;deliverySettlements:string[]};
  const requestReply=(bearer:string,key:string,body:string,isInternal=false,attachments:unknown[]=[])=>(mf.dispatchFetch(`http://runtime.test/api/tickets/${ticket}/articles`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bearer}`,'idempotency-key':key},
    body:JSON.stringify({body,body_format:'plain',is_internal:isInternal,attachments})}));
  const reply=(key:string,body:string,isInternal=false,attachments:unknown[]=[])=>requestReply(token,key,body,isInternal,attachments);
  const replyOther=(key:string,body:string)=>requestReply(otherToken,key,body,false,[]);
  const replyTarget=(id:string,key:string,attachments:unknown[]=[])=>mf.dispatchFetch(`http://runtime.test/api/tickets/${id}/articles`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'idempotency-key':key},body:JSON.stringify({body:'Synthetic distinct delivery',body_format:'plain',is_internal:false,attachments})});
  const createTarget=(index:number)=>mf.dispatchFetch('http://runtime.test/api/tickets',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'idempotency-key':`email-create-${index}`},body:JSON.stringify({subject:`Synthetic delivery ${index}`,customer_email:'tocyn-auth-test-a@example.invalid',body:'Synthetic delivery',status:'open',priority:'normal'})});
  return{mf,db,bucket,control,reply,replyOther,replyTarget,createTarget};}
async function expectCommitted(response:{status:number;json():Promise<unknown>}){assert.equal(response.status,201);return response.json() as Promise<{id:string}>;}

test('real handler claims one bounded ticket email and preserves canonical success across replay, failure and revocation',async t=>{const h=await runtime();try{
  assert.equal(ticketEmailDeliveryEnvelope(false).externalProviderUnits,undefined,'local capture reserves zero provider units');
  assert.equal(ticketEmailDeliveryEnvelope(true).externalProviderUnits,1,'a deployed transport reserves one controllable provider invocation');
  const references=[];for(let index=0;index<10;index++){const key=`agent-attachments/${staff}/${index}.txt`;await h.bucket.put(`${tenant}/${key}`,`file-${index}`,{httpMetadata:{contentType:'text/plain'}});
    references.push({storageKey:key,filename:`${index}.txt`});}
  await h.control({reset:true});const first=await h.reply('ten-attachments','public bounded delivery',false,references);await expectCommitted(first);
  let state=await h.control();assert.equal(state.messages.length,1,JSON.stringify(state));const measured=state.attempts.at(-1)!;
  const source=isolateWarmReservedEnvelope(STAFF_TICKET_ENVELOPES['dashboard.ticket.reply'])!;
  const delivery=isolateWarmReservedEnvelope(TICKET_EMAIL_DELIVERY_ENVELOPE)!;
  assert.equal(measured.r2Gets,20,'ten references are validated once and the same ten canonical rows are streamed once');
  assert.ok(measured.r2Gets<=(source.r2ClassBOperations??0)+(delivery.r2ClassBOperations??0));
  assert.ok(measured.d1RowsRead<=(source.d1RowsRead??0)+(delivery.d1RowsRead??0),`${measured.d1RowsRead} D1 reads fit the combined ${source.d1RowsRead!+delivery.d1RowsRead!}`);
  assert.ok(measured.d1RowsWritten<=(source.d1RowsWritten??0)+(delivery.d1RowsWritten??0),`${measured.d1RowsWritten} D1 writes fit the combined reservation`);
  const deliveryRows=(await h.db.prepare("SELECT operation_id,operation_envelope_json FROM budget_grant_operations WHERE tenant_id=? AND operation_id LIKE 'ticket-email:%'").bind(tenant).all<{operation_id:string;operation_envelope_json:string}>()).results;
  assert.equal(deliveryRows.length,1);assert.equal(JSON.parse(deliveryRows[0].operation_envelope_json).externalProviderUnits,undefined);
  const replay=await h.reply('ten-attachments','public bounded delivery',false,references);await expectCommitted(replay);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');
  assert.equal((await h.control()).messages.length,1,'receipt replay cannot obtain another delivery grant');
  await expectCommitted(await h.reply('internal-note','private',true,[]));assert.equal((await h.control()).messages.length,1,'internal notes never reserve or send mail');
  await h.control({failNext:1});const failed=await h.reply('failed-delivery','provider acknowledgement is irrelevant',false,[]);await expectCommitted(failed);
  assert.equal((await h.control()).messages.length,1,'a delivery failure does not retract the canonical response or retry');
  const claimsAfterFailure=(await h.db.prepare("SELECT count(*) AS n FROM budget_grant_operations WHERE tenant_id=? AND operation_id LIKE 'ticket-email:%'").bind(tenant).first<{n:number}>())!.n;
  assert.equal(claimsAfterFailure,2,'the failed one-shot invocation remains durably charged');
  assert.equal((await h.control()).deliverySettlements.at(-1),'unknown','an exception does not prove provider completion');
  await h.control({beforeDelivery:'ticket'});const changed=await h.reply('post-admission-ticket','post admission ticket',false,[]);
  assert.equal(changed.status,201,'canonical reply remains committed when its delivery snapshot changes');await changed.body?.cancel();
  assert.equal((await h.control()).messages.length,1,'a post-reservation canonical target change fails the atomic delivery claim');
  t.diagnostic(`native whole public attempt with 3,000 historical attachments: ${measured.d1RowsRead} D1 rows read / ${measured.d1RowsWritten} written / ${measured.r2Gets} R2 class-B; reservations ${source.d1RowsRead!+delivery.d1RowsRead!}/${source.d1RowsWritten!+delivery.d1RowsWritten!}/${(source.r2ClassBOperations??0)+(delivery.r2ClassBOperations??0)}`);
}finally{await h.mf.dispose();}});

test('the colliding ticket identifier delivers only the selected tenant message',async()=>{const h=await runtime(0);try{
  await h.control({reset:true});const other=await h.replyOther('tenant-b-same-ticket','isolated tenant delivery');
  assert.equal(other.status,201,JSON.stringify(await other.json()));const state=await h.control();assert.equal(state.messages.length,1);
  assert.equal(state.messages[0].to,'tocyn-auth-test-b@example.invalid');
  assert.equal((await h.db.prepare("SELECT count(*) AS n FROM articles WHERE tenant_id=? AND ticket_id=? AND body='isolated tenant delivery'").bind(tenant,ticket).first<{n:number}>())!.n,0);
}finally{await h.mf.dispose();}});

for(const action of ['session','mfa','role','policy','restriction','closure'] as const)test(`post-reservation ${action} revocation keeps the canonical response and sends no mail`,async()=>{const h=await runtime(0);try{
  await h.control({reset:true,beforeDelivery:action});const response=await h.reply(`post-admission-${action}`,`post admission ${action}`,false,[]);
  assert.equal(response.status,201);await response.body?.cancel();assert.equal((await h.control()).messages.length,0);
  assert.equal((await h.db.prepare("SELECT count(*) AS n FROM budget_grant_operations WHERE tenant_id=? AND operation_id LIKE 'ticket-email:%'").bind(tenant).first<{n:number}>())!.n,0,
    'a failed current-authority claim cannot create delivery authority');
}finally{await h.mf.dispose();}});


test('delivery manifest work stays bounded after same-article attachment growth',async()=>{const h=await runtime(6000);try{
  const result=await h.db.prepare(TICKET_EMAIL_ATTACHMENT_MANIFEST_SQL).bind(tenant,'historical-article').all();
  assert.ok(result.meta.rows_read<=32,`manifest read ${result.meta.rows_read} rows after growth`);
  const manifest=JSON.parse(Object.values(result.results[0])[0] as string);
  assert.equal(manifest.length,11,'one sentinel beyond the ten permitted attachments rejects growth');
}finally{await h.mf.dispose();}});


test('twenty distinct canonical email deliveries share one exact session accounting scope and recover full blocks', async () => {
 const h=await runtime(0);try{
  for(let index=0;index<20;index++){
    const response=await h.createTarget(index);assert.equal(response.status,201,`create ${index+1}: ${await response.clone().text()}; cache=${JSON.stringify((await h.control()).cache)}`);await response.body?.cancel();
  }
  const state=await h.control();assert.equal(state.messages.length,10,'capture intentionally retains only ten latest messages');assert.deepEqual(state.deliverySettlements,Array(20).fill('committed'));
  const rows=(await h.db.prepare("SELECT reservation_id,operation_id FROM budget_grant_operations WHERE operation_id LIKE 'ticket-email:%'").all<{reservation_id:string;operation_id:string}>()).results;
  assert.equal(rows.length,20);assert.equal(new Set(rows.map((row:{reservation_id:string})=>row.reservation_id)).size,3,'twenty deliveries use three prepaid blocks');
  const closures=(await h.db.prepare("SELECT c.operation_count FROM budget_grant_closures c WHERE EXISTS(SELECT 1 FROM budget_grant_operations o WHERE o.reservation_id=c.reservation_id AND o.operation_id LIKE 'ticket-email:%')").all<{operation_count:number}>()).results;
  assert.deepEqual(closures.map((row:{operation_count:number})=>row.operation_count),[8,8]);
 }finally{await h.mf.dispose();}
});


test('an unknown delivery poisons its shared block while later clean blocks remain recoverable', async () => {
 const h=await runtime(0);try{
  await h.control({failNext:1});
  for(let index=0;index<17;index++)await expectCommitted(await h.createTarget(index));
  const state=await h.control();assert.deepEqual(state.deliverySettlements,['unknown',...Array(16).fill('committed')]);
  const closures=(await h.db.prepare("SELECT c.operation_count FROM budget_grant_closures c WHERE EXISTS(SELECT 1 FROM budget_grant_operations o WHERE o.reservation_id=c.reservation_id AND o.operation_id LIKE 'ticket-email:%')").all<{operation_count:number}>()).results;
  assert.deepEqual(closures.map((row:{operation_count:number})=>row.operation_count),[8],'only the second all-committed block can close');
 }finally{await h.mf.dispose();}
});

test('stable binding preserves concurrent per-request metering and independent delivery claims', async () => {
 const h=await runtime(0);try{
  for(const id of ['metric-a','metric-b'])await h.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,source,group_id) VALUES(?,?,'Metric proof','customer','tocyn-auth-test-a@example.invalid','dashboard',NULL)").bind(tenant,id).run();
  const key=`agent-attachments/${staff}/metric.txt`;await h.bucket.put(`${tenant}/${key}`,'metric',{httpMetadata:{contentType:'text/plain'}});
  const responses=await Promise.all([h.replyTarget('metric-a','metric-a',[{storageKey:key,filename:'metric.txt'}]),h.replyTarget('metric-b','metric-b')]);
  for(const response of responses)await expectCommitted(response);
  const state=await h.control();const a=state.attempts.find(row=>row.path.includes('metric-a')),b=state.attempts.find(row=>row.path.includes('metric-b'));
  assert.equal(a?.r2Gets,2);assert.equal(b?.r2Gets,0);assert.ok(a!.d1Calls>0&&b!.d1Calls>0);
  assert.deepEqual(state.deliverySettlements,['committed','committed']);assert.equal(state.messages.length,2);
 }finally{await h.mf.dispose();}
});

test('twenty distinct reply targets retain separate single-operation write grants within unchanged liability limits', async t => {
 const h=await runtime(0);try{
  for(let index=0;index<20;index++)await h.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,source,group_id) VALUES(?,?,'Write allocation proof','customer','tocyn-auth-test-a@example.invalid','dashboard',NULL)").bind(tenant,`write-target-${index}`).run();
  let completed=0,rejected=0;
  for(let index=0;index<20;index++){
    const response=await h.replyTarget(`write-target-${index}`,`write-target-${index}`);
    if(response.status!==201){rejected=response.status;await response.body?.cancel();break;}
    completed++;await response.body?.cancel();
  }
  assert.equal(rejected,0);assert.equal(completed,20,'single-operation target write grants fit the unchanged 200M policy');
  const state=await h.control();
  t.diagnostic(JSON.stringify({policyLogLimit:200_000_000,newWorkLogLimit:160_000_000,completed,rejected,cache:state.cache,
    observedD1Reads:state.attempts.reduce((sum,row)=>sum+row.d1RowsRead,0),observedD1Writes:state.attempts.reduce((sum,row)=>sum+row.d1RowsWritten,0),observedR2Gets:state.attempts.reduce((sum,row)=>sum+row.r2Gets,0),measuredLogs:false}));
 }finally{await h.mf.dispose();}
});
