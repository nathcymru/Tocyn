import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { RESOURCE_DIMENSIONS,STOCK_DIMENSIONS } from '@luminatick/shared';
import { splitSql } from './split-sql';
import { createLocalSnoozeController } from './local-snooze-controller';
import type { runFundedLocalSnoozeStep } from '../src/auth/automation-composition';
const root=resolve(import.meta.dirname,'..');
test('private RPC timer advances one due ticket after a future empty tick and stops on disposal',async()=>{
 const bundle=await build({entryPoints:[join(root,'scripts/snooze-due-local-entry.ts')],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto'],write:false});
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'due-timer',modules:true,script:bundle.outputFiles[0].text,
   compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],bindings:{ENVIRONMENT:'local',LOCAL_BETA_ENABLED:'true',BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',LOCAL_DUE_CATALOGUE:JSON.stringify(['due-a'])},
   d1Databases:{DB:'due-timer-db'},durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO'}}]}));
 const directory=await mkdtemp(join(tmpdir(),'due-timer-'));let controller:Awaited<ReturnType<typeof createLocalSnoozeController>>|undefined;
 try{
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort())await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));
  const now=Date.now(),limits=Object.fromEntries(RESOURCE_DIMENSIONS.map(d=>[d,1000000000]));
  const policy={schemaVersion:1,policyId:'due-policy',revision:1,deploymentId:'due-deployment',mode:'conservative',catalogueVersion:'synthetic-due',maxGrantLifetimeMs:60000,
    budgets:RESOURCE_DIMENSIONS.map(d=>({dimension:d,allocationId:`due-${d}`,limit:limits[d],recoveryPercent:20,provenance:'owner-allocation',
      window:STOCK_DIMENSIONS.includes(d)?{kind:'stock',id:`due-stock-${d}`}:{kind:'interval',id:'due-window',startsAt:now-1000,endsAt:now+3600000}}))};
  const restriction={schemaVersion:1,tenantId:'due-a',ownerPolicyId:'due-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]};
  await db.batch([db.prepare("INSERT INTO budget_deployment_authority VALUES('due-deployment',1,'active',?)").bind(now),
    db.prepare("INSERT INTO budget_owner_policies VALUES('due-deployment','due-policy',1,1,'due-coordinator',64,60000,?)").bind(JSON.stringify(policy)),
    db.prepare("INSERT INTO budget_tenant_allocations VALUES('due-deployment','due-a','due-policy',1,1,'due-a',?,'active')").bind(JSON.stringify(restriction)),
    db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES('due-a','group','Synthetic')")]);
  for(let i=0;i<2;i++)await db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,group_id,source) VALUES('due-a',?,'Due timer','customer@example.test','group','dashboard')").bind(`ticket-${i}`).run();
  const deadline=Date.now()+800;
  await db.prepare('UPDATE ticket_support_state SET snoozed_until=? WHERE tenant_id=?').bind(new Date(deadline).toISOString(),'due-a').run();
  assert.equal((await mf.dispatchFetch('http://private.test/anything')).status,404,'no HTTP route to trusted scheduler');
  const rpc=await mf.getWorker('due-timer') as unknown as {runDue:(tenant:string,purpose:'new-work'|'recovery')=>ReturnType<typeof runFundedLocalSnoozeStep>};
  await assert.rejects(async()=>rpc.runDue('outside-catalogue','new-work'));
  let callback:(()=>void)|undefined,calls=0;
  const delays:number[]=[];
  controller=await createLocalSnoozeController({tenantIds:['due-a'],markerPath:join(directory,'marker.json'),mode:'fresh',
    scheduler:{set:(fn,ms)=>{callback=fn;delays.push(ms);return fn;},clear:()=>{callback=undefined;}},
    invoke:async(tenant,purpose)=>{calls++;return rpc.runDue(tenant,purpose);}});
  await controller.start();assert.equal(controller.snapshot()[0].outcome,'empty');assert.deepEqual(delays,[60000]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='due-a'").first<{n:number}>())?.n,0);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-Date.now()+30)));
  const dueTick=callback!;dueTick();await controller.tick();assert.equal(controller.snapshot()[0].outcome,'resurfaced');assert.equal(calls,2);
  assert.equal((await db.prepare("SELECT active_snoozes AS n FROM snooze_scheduler_tenants WHERE tenant_id='due-a'").first<{n:number}>())?.n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='due-a'").first<{n:number}>())?.n,1);
  const cancelled=callback!;await controller.dispose();cancelled();await controller.tick();assert.equal(calls,2);
 }finally{await controller?.dispose();await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
