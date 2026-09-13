import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { RESOURCE_DIMENSIONS,STOCK_DIMENSIONS } from '@luminatick/shared';
import { splitSql } from './split-sql';
const root=resolve(import.meta.dirname,'..');
const readIntent=(purpose:'new-work'|'recovery'='new-work')=>({family:'read',input:{readId:crypto.randomUUID(),purpose}});
async function send(mf:Miniflare,input:unknown){const response=await mf.dispatchFetch('http://due.test/run',{method:'POST',body:JSON.stringify(input)});const text=await response.text();try{return{status:response.status,body:JSON.parse(text) as any};}catch{throw new Error(text);}}
test('funded due checkpoint uses real policy, atomic guards and conservative restart replay',async()=>{
 const bundle=await build({entryPoints:[join(root,'scripts/snooze-due-runtime-entry.ts')],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto'],write:false});
 const worker={name:'due-proof',modules:true as const,script:bundle.outputFiles[0].text,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],
   bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1'},d1Databases:{DB:'due-proof-db'},
   durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO'}};
 const options=convertV4MiniflareOptions({workers:[worker]});const mf=new Miniflare(options);
 try{
  let db=await mf.getD1Database('DB');
  for(const file of readdirSync(join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort())await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));
  const now=Date.now(),limits=Object.fromEntries(RESOURCE_DIMENSIONS.map(d=>[d,1000000000]));
  const policy={schemaVersion:1,policyId:'due-policy',revision:1,deploymentId:'due-deployment',mode:'conservative',catalogueVersion:'synthetic-due',maxGrantLifetimeMs:60000,
    budgets:RESOURCE_DIMENSIONS.map(d=>({dimension:d,allocationId:`due-${d}`,limit:limits[d],recoveryPercent:20,provenance:'owner-allocation',
      window:STOCK_DIMENSIONS.includes(d)?{kind:'stock',id:`due-stock-${d}`}:{kind:'interval',id:'due-window',startsAt:now-1000,endsAt:now+3600000}}))};
  await db.batch([db.prepare("INSERT INTO budget_deployment_authority VALUES('due-deployment',1,'active',?)").bind(now),
    db.prepare("INSERT INTO budget_owner_policies VALUES('due-deployment','due-policy',1,1,'due-coordinator',64,60000,?)").bind(JSON.stringify(policy))]);
  for(const tenant of ['due-a','due-b']){
    const restriction={schemaVersion:1,tenantId:tenant,ownerPolicyId:'due-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]};
    await db.batch([db.prepare("INSERT INTO budget_tenant_allocations VALUES('due-deployment',?,'due-policy',1,1,?,?,'active')").bind(tenant,tenant,JSON.stringify(restriction)),
      db.prepare('INSERT INTO groups(tenant_id,id,name) VALUES(?,?,?)').bind(tenant,'group','Synthetic')]);
    for(let i=0;i<(tenant==='due-a'?37:1);i++)await db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,group_id,source) VALUES(?,?,?,?,?,'dashboard')").bind(tenant,`ticket-${i}`,'Due proof','customer@example.test','group').run();
    await db.prepare("UPDATE ticket_support_state SET snoozed_until='2026-09-01T00:00:00.000Z' WHERE tenant_id=?").bind(tenant).run();
  }
  const snapshot=await send(mf,{tenant:'due-a',intent:readIntent()});assert.equal(snapshot.status,200,JSON.stringify(snapshot.body));assert.equal(snapshot.body.result.activeSnoozes,37);
  assert.ok(snapshot.body.reads<=snapshot.body.grant.operationEnvelope.d1RowsRead);assert.ok(snapshot.body.writes<=snapshot.body.grant.operationEnvelope.d1RowsWritten);
  const advance={family:'advance',input:{expectedGeneration:0,stepId:crypto.randomUUID(),dueThrough:new Date().toISOString(),activeSnoozeSnapshot:37}};
  const completed=await send(mf,{tenant:'due-a',intent:advance});assert.equal(completed.status,200,JSON.stringify(completed.body));assert.equal(completed.body.result.outcome,'resurfaced');
  assert.ok(completed.body.reads<=completed.body.grant.operationEnvelope.d1RowsRead);assert.ok(completed.body.writes<=completed.body.grant.operationEnvelope.d1RowsWritten);
  assert.equal((await db.prepare("SELECT active_snoozes AS n FROM snooze_scheduler_tenants WHERE tenant_id='due-b'").first<{n:number}>())?.n,1);
  const stale=await send(mf,{tenant:'due-a',intent:{...advance,input:{...advance.input,stepId:crypto.randomUUID(),activeSnoozeSnapshot:36}}});assert.equal(stale.status,409);
  const growth=await send(mf,{tenant:'due-a',intent:{...advance,input:{...advance.input,expectedGeneration:1,stepId:crypto.randomUUID(),activeSnoozeSnapshot:37}}});assert.equal(growth.status,409);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='due-a'").first<{n:number}>())?.n,1);
  const lostIntent={...advance,input:{...advance.input,expectedGeneration:1,stepId:crypto.randomUUID(),activeSnoozeSnapshot:36}};
  const lost=await send(mf,{tenant:'due-a',intent:lostIntent,fault:'lost'});assert.equal(lost.status,503,JSON.stringify(lost.body));
  // Reload resets isolate/cache but retains same D1 and durable coordinator store.
  await mf.setOptions(convertV4MiniflareOptions({workers:[{...worker,script:worker.script+'\n// fresh isolate'}]}));
  db=await mf.getD1Database('DB');
  const replay=await send(mf,{tenant:'due-a',intent:readIntent('recovery')});assert.equal(replay.status,200,JSON.stringify(replay.body));
  assert.equal(replay.body.result.checkpoint.step_id,lostIntent.input.stepId);assert.equal(replay.body.purpose,'recovery');
  assert.notEqual(replay.body.grant.reservationId,lost.body.grant.reservationId);
  const central=(await send(mf,{action:'inspect'})).body;
  const original=central.tenantStates.flatMap((state:any)=>state.grants).find((grant:any)=>grant.reservationId===lost.body.grant.reservationId);
  assert.ok(original,'original reservation persists after restart');assert.deepEqual(original.accounted,original.envelope);assert.equal(original.reconciliation,undefined);assert.notEqual(original.status,'reconciled');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='due-a'").first<{n:number}>())?.n,2);
  const revoked=await send(mf,{tenant:'due-b',intent:readIntent(),fault:'policy'});assert.equal(revoked.status,409);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM budget_grant_operations WHERE tenant_id='due-b'").first<{n:number}>())?.n,0);
  console.log(JSON.stringify({read:{rowsRead:snapshot.body.reads,rowsWritten:snapshot.body.writes},advanceN37:{rowsRead:completed.body.reads,rowsWritten:completed.body.writes},recoveryRead:{rowsRead:replay.body.reads,rowsWritten:replay.body.writes},storageBytes:'unmeasured: D1 rejects page_count diagnostic; no storage clearance'}));
 }finally{await mf.dispose();}
});
