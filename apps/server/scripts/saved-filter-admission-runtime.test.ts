import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {SignJWT} from 'jose';
import {splitSql} from './split-sql';

const root=resolve(import.meta.dirname,'..'),now=Date.now(),tenant='runtime-tenant',other='runtime-other',limited='runtime-limited';
const secret='saved-filter-runtime-secret-at-least-32-characters';
async function apply(db:any){for(const file of readdirSync(join(root,'migrations')).filter(file=>file.endsWith('.sql')).sort())
  await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));}
function ownerPolicy(limit=10_000_000){const limits={workerRequests:limit,d1RowsRead:limit,d1RowsWritten:limit,doRequests:limit,doRowsRead:limit,doRowsWritten:limit,logEvents:limit};
  return{schemaVersion:1,policyId:'filter-policy',revision:1,deploymentId:'filter-deployment',mode:'conservative',catalogueVersion:'synthetic-2026-09',maxGrantLifetimeMs:60_000,
    budgets:Object.entries(limits).map(([dimension,value])=>({dimension,limit:value,allocationId:`filter-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',
      window:{kind:'interval',id:'filter-window',startsAt:now-60_000,endsAt:now+3_600_000}}))};}
async function token(id:string,role:'admin'|'agent',version=1,tenantId=tenant){return new SignJWT({sub:id,role,tenant_id:tenantId,session_version:version,mfa_verified:true})
  .setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));}

test('native Worker/D1/DO saved-filter admission is current, replayable and population-bounded',async()=>{
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/saved-filter-admission-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'saved-filter-admission',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',DISABLE_RATE_LIMIT:'true',ENVIRONMENT:'local',JWT_SECRET:secret},d1Databases:{DB:'saved-filter-d1'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  try{
    const db=await mf.getD1Database('DB');await apply(db);const owner=ownerPolicy(),limits=Object.fromEntries(owner.budgets.map((item:any)=>[item.dimension,item.limit]));
    const allocation=(tenantId:string,tenantLimits=limits)=>JSON.stringify({schemaVersion:1,tenantId,ownerPolicyId:owner.policyId,ownerPolicyRevision:1,revision:1,mode:'conservative',limits:tenantLimits,disabledFeatures:[]});
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES('filter-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies(deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES('filter-deployment','filter-policy',1,1,'filter-coordinator',64,60000,?)`).bind(JSON.stringify(owner)),
      ...[tenant,other].flatMap(t=>[
        db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin',?,'admin',1,1)").bind(t,`admin-${t}@example.test`),
        db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'agent',?,'agent',1,1)").bind(t,`agent-${t}@example.test`),
        db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES('filter-deployment',?,'filter-policy',1,1,?,?,'active')`).bind(t,`filter-${t}`,allocation(t)),
        db.prepare("INSERT INTO tenant_role_capability_policies(tenant_id,role,capability,enabled,revision) VALUES(?,'agent','filters.manage',1,1)").bind(t),
      ]),
      db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin','limited@example.test','admin',1,1)").bind(limited),
      db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES('filter-deployment',?,'filter-policy',1,1,?,?, 'active')`).bind(limited,`filter-${limited}`,allocation(limited,{...limits,d1RowsRead:1})),
      db.prepare("INSERT INTO ticket_filters(tenant_id,id,name,conditions,is_system) VALUES(?,'filter_system','System','[]',1)").bind(tenant),
      db.prepare("INSERT INTO ticket_filters(tenant_id,id,name,conditions,is_system) VALUES(?,'filter_mutable','Mutable','[]',0)").bind(tenant),
      db.prepare("INSERT INTO ticket_filters(tenant_id,id,name,conditions,is_system) VALUES(?,'filter_other','Other tenant','[]',0)").bind(other),
    ]);
    let admin=await token('admin','admin'),agent=await token('agent','agent');
    const request=(path:string,method:string,bearer:string,body?:unknown,key?:string)=>mf.dispatchFetch(`http://runtime.test${path}`,{method,headers:{authorization:`Bearer ${bearer}`,
      ...(body===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const createBody={name:'Priority owned',conditions:[{field:'priority',operator:'in',value:['high','urgent']}]};
    const created=await request('/api/settings/filters','POST',admin,createBody,'create-key');assert.equal(created.status,201,await created.clone().text());const createdBody=await created.json() as any;
    assert.equal(createdBody.name,'Priority owned');assert.equal(createdBody.tenant_id,tenant);
    const replay=await request('/api/settings/filters','POST',admin,createBody,'create-key');assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');
    assert.equal((await replay.json() as any).id,createdBody.id);
    const collision=await request('/api/settings/filters','POST',admin,{...createBody,name:'Collision'},'create-key');assert.equal(collision.status,409);await collision.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) n FROM saved_filter_mutation_receipts WHERE tenant_id=? AND operation='dashboard.filter.create'").bind(tenant).first<any>()).n,1);

    const list=await request('/api/settings/filters','GET',agent);assert.equal(list.status,200);const listed=await list.json() as any[];
    assert.ok(listed.some(row=>row.id===createdBody.id));assert.ok(!listed.some(row=>row.id==='filter_other'));
    const foreign=await request('/api/settings/filters/filter_other','GET',agent);assert.equal(foreign.status,404);await foreign.body?.cancel();
    const foreignWrite=await request('/api/settings/filters/filter_other','PUT',admin,{name:'Cross tenant write',conditions:[]},'cross-tenant');assert.equal(foreignWrite.status,404);await foreignWrite.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM ticket_filters WHERE tenant_id=? AND id='filter_other'").bind(other).first<any>()).name,'Other tenant');
    const limitedRead=await request('/api/settings/filters','GET',await token('admin','admin',1,limited));assert.equal(limitedRead.status,429);await limitedRead.body?.cancel();
    const oversized=await request('/api/settings/filters','POST',admin,{name:'Oversized',conditions:[{field:'subject',operator:'contains',value:'x'.repeat(70_000)}]},'oversized');
    assert.ok(oversized.status===400||oversized.status===413);await oversized.body?.cancel();
    const systemUpdate=await request('/api/settings/filters/filter_system','PUT',agent,{name:'Changed',conditions:[]},'system-update');assert.equal(systemUpdate.status,403);await systemUpdate.body?.cancel();
    const systemDelete=await request('/api/settings/filters/filter_system','DELETE',admin,undefined,'system-delete');assert.equal(systemDelete.status,403);await systemDelete.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) n FROM saved_filter_mutation_receipts WHERE tenant_id=? AND operation IN ('dashboard.filter.update','dashboard.filter.delete')").bind(tenant).first<any>()).n,0);

    const update=await request('/api/settings/filters/filter_mutable','PUT',agent,{name:'Agent edit',conditions:[{field:'status',operator:'eq',value:'open'}]},'agent-update');
    assert.equal(update.status,200,await update.clone().text());assert.equal((await update.json() as any).name,'Agent edit');
    await db.prepare("UPDATE tenant_role_capability_policies SET revision=revision+1,enabled=0 WHERE tenant_id=? AND role='agent' AND capability='filters.manage'").bind(tenant).run();
    const denied=await request('/api/settings/filters/filter_mutable','PUT',agent,{name:'Denied',conditions:[]},'denied');assert.equal(denied.status,403);await denied.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM ticket_filters WHERE tenant_id=? AND id='filter_mutable'").bind(tenant).first<any>()).name,'Agent edit');
    await db.prepare("UPDATE tenant_role_capability_policies SET enabled=1 WHERE tenant_id=? AND role='agent' AND capability='filters.manage'").bind(tenant).run();
    await mf.dispatchFetch('http://runtime.test/__filter-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({beforeCanonical:'capability'})});
    const revokedCapability=await request('/api/settings/filters/filter_mutable','PUT',agent,{name:'Capability race',conditions:[]},'capability-race');
    assert.equal(revokedCapability.status,503);await revokedCapability.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM ticket_filters WHERE tenant_id=? AND id='filter_mutable'").bind(tenant).first<any>()).name,'Agent edit');
    await db.prepare("UPDATE deployment_capability_ceiling SET enabled=1 WHERE capability='filters.manage'").run();

    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<80)
      INSERT INTO saved_filter_mutation_receipts(tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot,created_at,expires_at)
      SELECT tenant_id,principal_id,'dashboard.filter.update',printf('%064x',5000+x),payload_hash,200,'{"success":true}',unixepoch()-100,unixepoch()-1
      FROM saved_filter_mutation_receipts,n WHERE tenant_id=? AND operation='dashboard.filter.create' LIMIT 80`).bind(tenant).run();
    const cleanupWrite=await request('/api/settings/filters/filter_mutable','PUT',admin,{name:'Cleanup proof',conditions:[{field:'status',operator:'not_in',value:['closed']}]},'cleanup-proof');
    assert.equal(cleanupWrite.status,200,await cleanupWrite.clone().text());await cleanupWrite.body?.cancel();
    assert.equal((await db.prepare('SELECT count(*) n FROM saved_filter_mutation_receipts WHERE tenant_id=? AND expires_at<=unixepoch()').bind(tenant).first<any>()).n,48);
    const cleanupControl=await (await mf.dispatchFetch('http://runtime.test/__filter-control')).json() as any,cleanupMetric=cleanupControl.attempts.at(-1);
    const cleanupGrant=await db.prepare(`SELECT o.operation_envelope_json FROM budget_grant_operations o JOIN saved_filter_mutation_receipts r
      ON r.tenant_id=o.tenant_id AND r.key_hash=o.operation_id WHERE r.tenant_id=? AND r.operation='dashboard.filter.update'
      AND r.response_snapshot LIKE '%Cleanup proof%' LIMIT 1`).bind(tenant).first<any>();
    const cleanupReserved=JSON.parse(cleanupGrant.operation_envelope_json);assert.ok(cleanupMetric.d1RowsRead<=cleanupReserved.d1RowsRead);
    assert.ok(cleanupMetric.d1RowsWritten<=cleanupReserved.d1RowsWritten);assert.ok(cleanupMetric.d1RowsWritten>=35);
    console.log(JSON.stringify({fixture:'saved-filter-update-with-80-expired-receipts',measured:cleanupMetric,reserved:cleanupReserved}));

    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<320)
      INSERT INTO ticket_filters(tenant_id,id,name,conditions,is_system)
      SELECT ?,printf('large_%04d',x),printf('Large %04d',x),json_array(json_object('field','subject','operator','contains','value',printf('%.*c',2048,120))),0 FROM n`).bind(tenant).run();
    const counter=await db.prepare('SELECT filter_rows,condition_bytes,revision FROM saved_filter_population WHERE tenant_id=?').bind(tenant).first<any>();
    assert.equal(counter.filter_rows,323);assert.ok(counter.condition_bytes>650_000);
    const large=await request('/api/settings/filters','GET',admin);assert.equal(large.status,200,await large.clone().text());assert.equal((await large.json() as any[]).length,323);
    const control=await (await mf.dispatchFetch('http://runtime.test/__filter-control')).json() as any;
    const largeMetric=control.attempts.at(-1);assert.equal(largeMetric.path,'/api/settings/filters');
    const listGrant=await db.prepare(`SELECT operation_envelope_json FROM budget_grant_operations WHERE tenant_id=? AND operation_envelope_json LIKE '%d1RowsRead%'
      ORDER BY rowid DESC LIMIT 1`).bind(tenant).first<any>();const listReserved=JSON.parse(listGrant.operation_envelope_json);
    assert.ok(largeMetric.d1RowsRead<=listReserved.d1RowsRead);assert.ok(largeMetric.d1RowsWritten<=listReserved.d1RowsWritten);
    console.log(JSON.stringify({fixture:'saved-filter-323-rows-655kb',measured:largeMetric,reserved:listReserved}));

    await mf.dispatchFetch('http://runtime.test/__filter-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({beforeCanonical:'population-growth'})});
    const growth=await request('/api/settings/filters','GET',admin);assert.equal(growth.status,503);await growth.body?.cancel();
    await mf.dispatchFetch('http://runtime.test/__filter-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({beforeCanonical:'target-update'})});
    const raced=await request('/api/settings/filters/filter_mutable','PUT',admin,{name:'Must not win',conditions:[]},'race-update');assert.equal(raced.status,503,await raced.clone().text());await raced.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM ticket_filters WHERE tenant_id=? AND id='filter_mutable'").bind(tenant).first<any>()).name,'Concurrent edit');

    await mf.dispatchFetch('http://runtime.test/__filter-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({beforeCanonical:'session'})});
    const revoked=await request(`/api/settings/filters/${createdBody.id}`,'DELETE',admin,undefined,'revoked-delete');assert.equal(revoked.status,503);await revoked.body?.cancel();
    assert.ok(await db.prepare('SELECT 1 FROM ticket_filters WHERE tenant_id=? AND id=?').bind(tenant,createdBody.id).first());admin=await token('admin','admin',2);
    await mf.dispatchFetch('http://runtime.test/__filter-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({discard:true,beforeCanonical:'authority'})});
    const authority=await request(`/api/settings/filters/${createdBody.id}`,'DELETE',admin,undefined,'authority-delete');assert.equal(authority.status,503);await authority.body?.cancel();
    assert.ok(await db.prepare('SELECT 1 FROM ticket_filters WHERE tenant_id=? AND id=?').bind(tenant,createdBody.id).first());
    assert.equal((await db.prepare("SELECT count(*) n FROM saved_filter_mutation_receipts WHERE tenant_id=? AND operation='dashboard.filter.delete'").bind(tenant).first<any>()).n,0);
    assert.equal((await db.prepare('SELECT count(*) n FROM saved_filter_mutation_receipts WHERE tenant_id=? AND expires_at<=unixepoch()').bind(tenant).first<any>()).n,48);
  }finally{await mf.dispose();}
});

test('explicit off policy retains the legacy full filter contract',async()=>{
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/saved-filter-admission-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'saved-filter-off',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'off',DISABLE_RATE_LIMIT:'true',ENVIRONMENT:'local',JWT_SECRET:secret},d1Databases:{DB:'saved-filter-off-d1'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  try{
    const db=await mf.getD1Database('DB');await apply(db);const offTenant='off-tenant';
    await db.batch([db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin','off@example.test','admin',1,1)").bind(offTenant),
      db.prepare("INSERT INTO ticket_filters(tenant_id,id,name,conditions,is_system) VALUES(?,'legacy','Legacy full','[]',0)").bind(offTenant)]);
    const bearer=await token('admin','admin',1,offTenant),headers={authorization:`Bearer ${bearer}`,'content-type':'application/json'};
    const created=await mf.dispatchFetch('http://runtime.test/api/settings/filters',{method:'POST',headers,body:JSON.stringify({name:'Legacy create',conditions:[{field:'status',operator:'eq',value:'open'}]})});
    assert.equal(created.status,201,await created.clone().text());await created.body?.cancel();
    const listed=await mf.dispatchFetch('http://runtime.test/api/settings/filters',{headers:{authorization:`Bearer ${bearer}`}});
    assert.equal(listed.status,200);assert.equal((await listed.json() as any[]).length,2);
    assert.equal((await db.prepare('SELECT count(*) n FROM saved_filter_mutation_receipts WHERE tenant_id=?').bind(offTenant).first<any>()).n,0);
  }finally{await mf.dispose();}
});
