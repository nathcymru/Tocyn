import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {SignJWT} from 'jose';
import {splitSql} from './split-sql';

const root=resolve(import.meta.dirname,'..'),now=Date.now(),tenant='runtime-tenant',other='runtime-other',limited='runtime-limited';
const secret='configuration-runtime-secret-at-least-32-characters';
async function apply(db:any){for(const file of readdirSync(join(root,'migrations')).filter(file=>file.endsWith('.sql')).sort())
  await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));}
function ownerPolicy(limit=10_000_000){const limits={workerRequests:limit,d1RowsRead:limit,d1RowsWritten:limit,doRequests:limit,doRowsRead:limit,doRowsWritten:limit,logEvents:limit};
  return{schemaVersion:1,policyId:'configuration-policy',revision:1,deploymentId:'configuration-deployment',mode:'conservative',catalogueVersion:'synthetic-2026-09',maxGrantLifetimeMs:60_000,
    budgets:Object.entries(limits).map(([dimension,value])=>({dimension,limit:value,allocationId:`configuration-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',
      window:{kind:'interval',id:'configuration-window',startsAt:now-60_000,endsAt:now+3_600_000}}))};}
async function token(id:string,role:'admin'|'agent',version=1,tenantId=tenant){return new SignJWT({sub:id,role,tenant_id:tenantId,session_version:version,mfa_verified:true})
  .setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));}

test('native configuration admission is current, atomic, replayable and population bounded',async()=>{
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/configuration-admission-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'configuration-admission',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',DISABLE_RATE_LIMIT:'true',ENVIRONMENT:'local',JWT_SECRET:secret},d1Databases:{DB:'configuration-d1'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  try{
    const db=await mf.getD1Database('DB');await apply(db);const owner=ownerPolicy(),limits=Object.fromEntries(owner.budgets.map((item:any)=>[item.dimension,item.limit]));
    const allocation=(tenantId:string,tenantLimits=limits)=>JSON.stringify({schemaVersion:1,tenantId,ownerPolicyId:owner.policyId,ownerPolicyRevision:1,revision:1,mode:'conservative',limits:tenantLimits,disabledFeatures:[]});
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES('configuration-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies(deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES('configuration-deployment','configuration-policy',1,1,'configuration-coordinator',64,60000,?)`).bind(JSON.stringify(owner)),
      ...[tenant,other].flatMap(t=>[
        db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin',?,'admin',1,1)").bind(t,`admin-${t}@example.test`),
        db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'agent',?,'agent',1,1)").bind(t,`agent-${t}@example.test`),
        db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES('configuration-deployment',?,'configuration-policy',1,1,?,?,'active')`).bind(t,`configuration-${t}`,allocation(t)),
        db.prepare("INSERT INTO tenant_role_capability_policies(tenant_id,role,capability,enabled,revision) VALUES(?,'agent','ticket-fields.manage',1,1)").bind(t),
        db.prepare("INSERT INTO tenant_role_capability_policies(tenant_id,role,capability,enabled,revision) VALUES(?,'agent','automations.manage',1,1)").bind(t),
      ]),
      db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin','limited@example.test','admin',1,1)").bind(limited),
      db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES('configuration-deployment',?,'configuration-policy',1,1,?,?, 'active')`).bind(limited,`configuration-${limited}`,allocation(limited,{...limits,d1RowsRead:1})),
      db.prepare("INSERT INTO ticket_fields(tenant_id,id,name,label,field_type,options,is_active) VALUES(?,'field_base','base','Base','text',NULL,1)").bind(tenant),
      db.prepare("INSERT INTO ticket_fields(tenant_id,id,name,label,field_type,options,is_active) VALUES(?,'field_other','foreign','Foreign','text',NULL,1)").bind(other),
      db.prepare("INSERT INTO automation_rules(tenant_id,id,name,event_type,conditions,action_type,action_config,is_active) VALUES(?,'automation_mutable','Mutable','ticket.created','[]','webhook','{\"url\":\"https://example.test\"}',1)").bind(tenant),
      db.prepare("INSERT INTO automation_rules(tenant_id,id,name,event_type,conditions,action_type,action_config,is_active) VALUES(?,'automation_other','Other tenant','ticket.created','[]','webhook','{}',1)").bind(other),
    ]);
    let admin=await token('admin','admin'),agent=await token('agent','agent');
    const request=(path:string,method:string,bearer:string,body?:unknown,key?:string)=>mf.dispatchFetch(`http://runtime.test${path}`,{method,headers:{authorization:`Bearer ${bearer}`,
      ...(body===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const control=async(value:Record<string,unknown>={})=>await (await mf.dispatchFetch('http://runtime.test/__configuration-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})).json() as any;

    const fieldBody={name:'customer_tier',label:'Customer tier',field_type:'select',options:'["standard","premium"]',is_active:true};
    const createdField=await request('/api/ticket-fields','POST',agent,fieldBody,'field-create');assert.equal(createdField.status,201,await createdField.clone().text());
    const createdFieldBody=await createdField.json() as any;assert.equal(createdFieldBody.name,'customer_tier');assert.equal(createdFieldBody.tenant_id,tenant);
    const fieldReplay=await request('/api/ticket-fields','POST',agent,fieldBody,'field-create');assert.equal(fieldReplay.status,201);assert.equal(fieldReplay.headers.get('Idempotency-Replayed'),'true');
    assert.equal((await fieldReplay.json() as any).id,createdFieldBody.id);
    const fieldCollision=await request('/api/ticket-fields','POST',agent,{...fieldBody,label:'Collision'},'field-create');assert.equal(fieldCollision.status,409);await fieldCollision.body?.cancel();
    const duplicate=await request('/api/ticket-fields','POST',agent,{...fieldBody,label:'Duplicate'},'field-duplicate');assert.equal(duplicate.status,409);assert.equal((await duplicate.json() as any).error,'Ticket field with this name already exists');
    const fieldList=await request('/api/ticket-fields','GET',admin);assert.equal(fieldList.status,200);const fields=await fieldList.json() as any[];
    assert.ok(fields.some(row=>row.id===createdFieldBody.id));assert.ok(!fields.some(row=>row.id==='field_other'));

    const createAutomation={name:'Notify owned',event_type:'ticket.created',conditions:'[{"field":"ticket.priority","operator":"equals","value":"urgent"}]',
      action_type:'webhook',action_config:'{"url":"https://example.test/hook","method":"POST"}',is_active:true};
    const created=await request('/api/automations','POST',admin,createAutomation,'automation-create');assert.equal(created.status,201,await created.clone().text());const createdBody=await created.json() as any;
    assert.equal(createdBody.name,'Notify owned');assert.equal(createdBody.tenant_id,tenant);assert.equal(createdBody.conditions,createAutomation.conditions);
    const replay=await request('/api/automations','POST',admin,createAutomation,'automation-create');assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');
    assert.equal((await replay.json() as any).id,createdBody.id);
    const collision=await request('/api/automations','POST',admin,{...createAutomation,name:'Collision'},'automation-create');assert.equal(collision.status,409);await collision.body?.cancel();
    const createdAt=(await db.prepare('SELECT created_at FROM automation_rules WHERE tenant_id=? AND id=?').bind(tenant,createdBody.id).first<any>()).created_at;
    const partial=await request(`/api/automations/${createdBody.id}`,'PATCH',agent,{name:'Notify urgent'},'automation-update');assert.equal(partial.status,200,await partial.clone().text());
    const partialBody=await partial.json() as any;assert.equal(partialBody.name,'Notify urgent');assert.equal(partialBody.action_config,createAutomation.action_config);assert.equal(partialBody.created_at,createdAt);
    await db.prepare("UPDATE tenant_role_capability_policies SET enabled=0,revision=revision+1 WHERE tenant_id=? AND role='agent' AND capability='automations.manage'").bind(tenant).run();
    const policyDenied=await request(`/api/automations/${createdBody.id}`,'PATCH',agent,{name:'Policy denied'},'policy-denied');assert.equal(policyDenied.status,403);await policyDenied.body?.cancel();
    assert.equal((await db.prepare('SELECT name FROM automation_rules WHERE tenant_id=? AND id=?').bind(tenant,createdBody.id).first<any>()).name,'Notify urgent');
    await db.prepare("UPDATE tenant_role_capability_policies SET enabled=1,revision=revision+1 WHERE tenant_id=? AND role='agent' AND capability='automations.manage'").bind(tenant).run();
    const missingUpdate=await request('/api/automations/missing','PATCH',admin,{name:'Missing'},'automation-missing-update');assert.equal(missingUpdate.status,200);assert.equal(await missingUpdate.json(),null);
    const missingDelete=await request('/api/automations/missing','DELETE',admin,undefined,'automation-missing-delete');assert.equal(missingDelete.status,200);assert.deepEqual(await missingDelete.json(),{success:true});
    const automations=await request('/api/automations','GET',agent);assert.equal(automations.status,200);const listed=await automations.json() as any[];
    assert.ok(listed.some(row=>row.id===createdBody.id));assert.ok(!listed.some(row=>row.id==='automation_other'));
    const foreignUpdate=await request('/api/automations/automation_other','PATCH',admin,{name:'Cross tenant write'},'foreign-update');assert.equal(foreignUpdate.status,200);assert.equal(await foreignUpdate.json(),null);
    assert.equal((await db.prepare("SELECT name FROM automation_rules WHERE tenant_id=? AND id='automation_other'").bind(other).first<any>()).name,'Other tenant');

    const historicalConditions='h'.repeat(220_000),historicalConfig='c'.repeat(220_000);
    await db.prepare("INSERT INTO automation_rules(tenant_id,id,name,event_type,conditions,action_type,action_config,is_active) VALUES(?,'automation_historical','Historical large','ticket.created',?,'webhook',?,1)")
      .bind(tenant,historicalConditions,historicalConfig).run();
    const historical=await request('/api/automations/automation_historical','PATCH',admin,{name:'Historical retained'},'historical-update');assert.equal(historical.status,200,await historical.clone().text());
    const historicalBody=await historical.json() as any;assert.equal(historicalBody.conditions.length,historicalConditions.length);assert.equal(historicalBody.action_config.length,historicalConfig.length);
    const historicalMetric=(await control()).attempts.at(-1),historicalGrant=await db.prepare(`SELECT o.operation_envelope_json FROM budget_grant_operations o JOIN configuration_mutation_receipts r
      ON r.tenant_id=o.tenant_id AND r.key_hash=o.operation_id WHERE r.tenant_id=? AND r.operation='dashboard.automation.update'
      AND r.response_snapshot LIKE '%Historical retained%' LIMIT 1`).bind(tenant).first<any>(),historicalReserved=JSON.parse(historicalGrant.operation_envelope_json);
    assert.equal(historicalMetric.preAdmissionBodyLoads,0);assert.ok(historicalMetric.d1RowsRead<=historicalReserved.d1RowsRead);assert.ok(historicalMetric.d1RowsWritten<=historicalReserved.d1RowsWritten);
    const historicalReplay=await request('/api/automations/automation_historical','PATCH',admin,{name:'Historical retained'},'historical-update');assert.equal(historicalReplay.status,200);assert.equal(historicalReplay.headers.get('Idempotency-Replayed'),'true');
    assert.equal(((await historicalReplay.json()) as any).action_config.length,historicalConfig.length);
    const historicalReplayMetric=(await control()).attempts.at(-1);assert.equal(historicalReplayMetric.preAdmissionBodyLoads,0);
    assert.ok(historicalReplayMetric.d1RowsRead<=historicalReserved.d1RowsRead);assert.ok(historicalReplayMetric.d1RowsWritten<=historicalReserved.d1RowsWritten);
    console.log(JSON.stringify({fixture:'configuration-historical-440kb-update-and-replay',measured:historicalMetric,replayMeasured:historicalReplayMetric,reserved:historicalReserved}));
    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<260)
      INSERT INTO automation_rules(tenant_id,id,name,event_type,conditions,action_type,action_config,is_active)
      SELECT ?,printf('automation_large_%04d',x),printf('Large automation %04d',x),'ticket.created',printf('%.*c',1024,120),'webhook','{}',1 FROM n`).bind(tenant).run();
    const largeAutomationList=await request('/api/automations','GET',admin);assert.equal(largeAutomationList.status,200,await largeAutomationList.clone().text());assert.equal((await largeAutomationList.json() as any[]).length,263);
    const automationListMetric=(await control()).attempts.at(-1),automationListGrant=await db.prepare(`SELECT operation_envelope_json FROM budget_grant_operations WHERE tenant_id=? ORDER BY rowid DESC LIMIT 1`).bind(tenant).first<any>(),automationListReserved=JSON.parse(automationListGrant.operation_envelope_json);
    assert.ok(automationListMetric.d1RowsRead<=automationListReserved.d1RowsRead);assert.ok(automationListMetric.d1RowsWritten<=automationListReserved.d1RowsWritten);
    console.log(JSON.stringify({fixture:'configuration-automations-263-rows-700kb',measured:automationListMetric,reserved:automationListReserved}));

    const largeConditions='x'.repeat(450_000),largeConfig='y'.repeat(450_000);
    await db.prepare("INSERT INTO automation_rules(tenant_id,id,name,event_type,conditions,action_type,action_config,is_active) VALUES(?,'limited-large','Denied large','ticket.created',?,'webhook',?,1)")
      .bind(limited,largeConditions,largeConfig).run();
    const limitedAdmin=await token('admin','admin',1,limited),deniedLarge=await request('/api/automations/limited-large','PATCH',limitedAdmin,{name:'Must stay denied'},'large-denied');
    assert.equal(deniedLarge.status,429);await deniedLarge.body?.cancel();const deniedMetric=(await control()).attempts.at(-1);
    assert.equal(deniedMetric.preAdmissionBodyLoads,0,'Denied update must not load conditions or action configuration');assert.ok(deniedMetric.d1RowsRead<100);
    assert.equal((await db.prepare("SELECT name FROM automation_rules WHERE tenant_id=? AND id='limited-large'").bind(limited).first<any>()).name,'Denied large');

    await control({beforeCanonical:'population-growth'});const growth=await request('/api/automations','GET',admin);assert.equal(growth.status,503);await growth.body?.cancel();
    await control({beforeCanonical:'target-update'});const raced=await request('/api/automations/automation_mutable','PATCH',admin,{name:'Must not win'},'target-race');assert.equal(raced.status,503);await raced.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM automation_rules WHERE tenant_id=? AND id='automation_mutable'").bind(tenant).first<any>()).name,'Concurrent edit');

    await control({beforeCanonical:'capability'});const capability=await request('/api/automations/automation_mutable','PATCH',admin,{name:'Capability race'},'capability-race');assert.equal(capability.status,503,await capability.clone().text());await capability.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM automation_rules WHERE tenant_id=? AND id='automation_mutable'").bind(tenant).first<any>()).name,'Concurrent edit');
    await db.prepare("UPDATE deployment_capability_ceiling SET enabled=1 WHERE capability='automations.manage'").run();
    await control({beforeCanonical:'mfa'});const mfa=await request('/api/automations/automation_mutable','PATCH',admin,{name:'MFA race'},'mfa-race');assert.equal(mfa.status,503,await mfa.clone().text());await mfa.body?.cancel();
    await db.prepare("UPDATE users SET mfa_enabled=1 WHERE tenant_id=? AND id='admin'").bind(tenant).run();
    await control({beforeCanonical:'session'});const session=await request('/api/automations/automation_mutable','PATCH',admin,{name:'Session race'},'session-race');assert.equal(session.status,401,await session.clone().text());await session.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM automation_rules WHERE tenant_id=? AND id='automation_mutable'").bind(tenant).first<any>()).name,'Concurrent edit');
    const currentSession=(await db.prepare("SELECT session_version FROM users WHERE tenant_id=? AND id='admin'").bind(tenant).first<any>()).session_version;
    admin=await token('admin','admin',currentSession);
    await control({discard:true,beforeCanonical:'grant-collision'});const exactGrant=await request('/api/automations/automation_mutable','PATCH',admin,{name:'Wrong exact grant'},'grant-collision');assert.equal(exactGrant.status,503,await exactGrant.clone().text());await exactGrant.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM automation_rules WHERE tenant_id=? AND id='automation_mutable'").bind(tenant).first<any>()).name,'Concurrent edit');
    await control({discard:true,beforeCanonical:'closure'});const closure=await request('/api/automations/automation_mutable','PATCH',admin,{name:'Closed grant'},'closure-race');assert.equal(closure.status,503,`${await closure.clone().text()} closures=${(await db.prepare('SELECT count(*) n FROM budget_grant_closures').first<any>()).n}`);await closure.body?.cancel();
    assert.equal((await db.prepare("SELECT name FROM automation_rules WHERE tenant_id=? AND id='automation_mutable'").bind(tenant).first<any>()).name,'Concurrent edit');
    assert.ok((await db.prepare('SELECT count(*) n FROM budget_grant_closures').first<any>()).n>0);
    await control({discard:true,failCanonicalAck:true});const recovered=await request('/api/automations/automation_mutable','PATCH',admin,{name:'Recovered update'},'lost-ack');
    assert.equal(recovered.status,200,await recovered.clone().text());assert.equal(recovered.headers.get('Idempotency-Replayed'),'true');assert.equal((await recovered.json() as any).name,'Recovered update');
    const recoveredRetry=await request('/api/automations/automation_mutable','PATCH',admin,{name:'Recovered update'},'lost-ack');assert.equal(recoveredRetry.status,200);assert.equal(recoveredRetry.headers.get('Idempotency-Replayed'),'true');await recoveredRetry.body?.cancel();

    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<80)
      INSERT INTO configuration_mutation_receipts(tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_bytes,reserved_d1_rows_read,response_snapshot,created_at,expires_at)
      SELECT tenant_id,principal_id,'dashboard.automation.update',printf('%064x',7000+x),payload_hash,200,length(CAST('{"success":true}' AS BLOB)),
        reserved_d1_rows_read,'{"success":true}',unixepoch()-100,unixepoch()-1
      FROM configuration_mutation_receipts,n WHERE tenant_id=? AND operation='dashboard.automation.create' LIMIT 80`).bind(tenant).run();
    const cleanup=await request('/api/automations/automation_mutable','PATCH',admin,{name:'Cleanup proof'},'cleanup-proof');assert.equal(cleanup.status,200,await cleanup.clone().text());await cleanup.body?.cancel();
    assert.equal((await db.prepare('SELECT count(*) n FROM configuration_mutation_receipts WHERE tenant_id=? AND expires_at<=unixepoch()').bind(tenant).first<any>()).n,64);
    const cleanupMetric=(await control()).attempts.at(-1),cleanupGrant=await db.prepare(`SELECT o.operation_envelope_json FROM budget_grant_operations o JOIN configuration_mutation_receipts r
      ON r.tenant_id=o.tenant_id AND r.key_hash=o.operation_id WHERE r.tenant_id=? AND r.operation='dashboard.automation.update'
      AND r.response_snapshot LIKE '%Cleanup proof%' LIMIT 1`).bind(tenant).first<any>(),cleanupReserved=JSON.parse(cleanupGrant.operation_envelope_json);
    assert.ok(cleanupMetric.d1RowsRead<=cleanupReserved.d1RowsRead);assert.ok(cleanupMetric.d1RowsWritten<=cleanupReserved.d1RowsWritten);assert.ok(cleanupMetric.d1RowsWritten>=20);
    console.log(JSON.stringify({fixture:'configuration-update-with-80-expired-receipts',measured:cleanupMetric,reserved:cleanupReserved}));

    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<300)
      INSERT INTO ticket_fields(tenant_id,id,name,label,field_type,options,is_active)
      SELECT ?,printf('field_large_%04d',x),printf('large_%04d',x),printf('Large %04d',x),'select',printf('["%.*c"]',2048,120),1 FROM n`).bind(tenant).run();
    const largeFields=await request('/api/ticket-fields','GET',admin);assert.equal(largeFields.status,200,await largeFields.clone().text());assert.equal((await largeFields.json() as any[]).length,302);
    const listMetric=(await control()).attempts.at(-1),listGrant=await db.prepare(`SELECT operation_envelope_json FROM budget_grant_operations WHERE tenant_id=? ORDER BY rowid DESC LIMIT 1`).bind(tenant).first<any>(),listReserved=JSON.parse(listGrant.operation_envelope_json);
    assert.ok(listMetric.d1RowsRead<=listReserved.d1RowsRead);assert.ok(listMetric.d1RowsWritten<=listReserved.d1RowsWritten);
    console.log(JSON.stringify({fixture:'configuration-ticket-fields-302-rows-615kb',measured:listMetric,reserved:listReserved}));

    const deleteReceiptsBefore=(await db.prepare("SELECT count(*) n FROM configuration_mutation_receipts WHERE tenant_id=? AND operation='dashboard.automation.delete'").bind(tenant).first<any>()).n;
    await control({discard:true,beforeCanonical:'authority'});const authority=await request('/api/automations/automation_mutable','DELETE',admin,undefined,'authority-delete');assert.equal(authority.status,503,await authority.clone().text());await authority.body?.cancel();
    assert.ok(await db.prepare("SELECT 1 FROM automation_rules WHERE tenant_id=? AND id='automation_mutable'").bind(tenant).first());
    assert.equal((await db.prepare("SELECT count(*) n FROM configuration_mutation_receipts WHERE tenant_id=? AND operation='dashboard.automation.delete'").bind(tenant).first<any>()).n,deleteReceiptsBefore);
  }finally{await mf.dispose();}
});

test('explicit off policy preserves legacy configuration lists and writes with trigger costs',async()=>{
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/configuration-admission-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'configuration-off',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'off',DISABLE_RATE_LIMIT:'true',ENVIRONMENT:'local',JWT_SECRET:secret},d1Databases:{DB:'configuration-off-d1'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  try{
    const db=await mf.getD1Database('DB');await apply(db);const off='configuration-off';
    await db.batch([db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin','off@example.test','admin',1,1)").bind(off),
      db.prepare("INSERT INTO automation_rules(tenant_id,id,name,event_type,conditions,action_type,action_config,is_active) VALUES(?,'legacy','Legacy','ticket.created','[]','webhook','{}',1)").bind(off)]);
    const bearer=await token('admin','admin',1,off),headers={authorization:`Bearer ${bearer}`,'content-type':'application/json'};
    const created=await mf.dispatchFetch('http://runtime.test/api/automations',{method:'POST',headers,body:JSON.stringify({name:'Legacy create',event_type:'ticket.created',conditions:'[]',action_type:'webhook',action_config:'{}',is_active:true})});
    assert.equal(created.status,201,await created.clone().text());const row=await created.json() as any;
    const updated=await mf.dispatchFetch(`http://runtime.test/api/automations/${row.id}`,{method:'PATCH',headers,body:JSON.stringify({name:'Legacy updated'})});assert.equal(updated.status,200);await updated.body?.cancel();
    const listed=await mf.dispatchFetch('http://runtime.test/api/automations',{headers:{authorization:`Bearer ${bearer}`}});assert.equal(listed.status,200);assert.equal((await listed.json() as any[]).length,2);
    const deleted=await mf.dispatchFetch(`http://runtime.test/api/automations/${row.id}`,{method:'DELETE',headers:{authorization:`Bearer ${bearer}`}});assert.equal(deleted.status,200);await deleted.body?.cancel();
    const population=await db.prepare("SELECT row_count,content_bytes FROM configuration_admission_population WHERE tenant_id=? AND family='automation'").bind(off).first<any>();
    assert.equal(population.row_count,1);assert.ok(population.content_bytes>0);
    const control=await (await mf.dispatchFetch('http://runtime.test/__configuration-control')).json() as any;
    const writes=control.attempts.filter((attempt:any)=>attempt.path.startsWith('/api/automations')&&attempt.method!=='GET').map((attempt:any)=>attempt.d1RowsWritten);
    assert.ok(writes.every((value:number)=>value>0));
    assert.equal((await db.prepare('SELECT count(*) n FROM configuration_mutation_receipts WHERE tenant_id=?').bind(off).first<any>()).n,0);
    console.log(JSON.stringify({fixture:'legacy-automation-trigger-path',measuredWrites:writes}));
  }finally{await mf.dispose();}
});
