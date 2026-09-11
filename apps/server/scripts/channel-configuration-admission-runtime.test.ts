import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {SignJWT} from 'jose';
import {splitSql} from './split-sql';

const root=resolve(import.meta.dirname,'..'),now=Date.now(),tenant='runtime-tenant',other='runtime-other',limited='runtime-limited';
const mutable='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
const group='33333333-3333-4333-8333-333333333333',raceGroup='44444444-4444-4444-8444-444444444444';
const secret='channel-configuration-runtime-secret-32-chars';
async function apply(db:any){for(const file of readdirSync(join(root,'migrations')).filter(file=>file.endsWith('.sql')).sort())
  await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));}
function ownerPolicy(limit=10_000_000){const limits={workerRequests:limit,d1RowsRead:limit,d1RowsWritten:limit,doRequests:limit,doRowsRead:limit,doRowsWritten:limit,logEvents:limit};
  return{schemaVersion:1,policyId:'channel-policy',revision:1,deploymentId:'channel-deployment',mode:'conservative',catalogueVersion:'synthetic-2026-09',maxGrantLifetimeMs:60_000,
    budgets:Object.entries(limits).map(([dimension,value])=>({dimension,limit:value,allocationId:`channel-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',
      window:{kind:'interval',id:'channel-window',startsAt:now-60_000,endsAt:now+3_600_000}}))};}
async function token(id:string,role:'admin'|'agent',version=1,tenantId=tenant){return new SignJWT({sub:id,role,tenant_id:tenantId,session_version:version,mfa_verified:true})
  .setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));}

test('native email-channel admission preserves configuration semantics and bounded resources',async()=>{
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/channel-configuration-admission-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'channel-configuration',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',DISABLE_RATE_LIMIT:'true',ENVIRONMENT:'local',JWT_SECRET:secret},d1Databases:{DB:'channel-configuration-d1'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  try{
    const db=await mf.getD1Database('DB');await apply(db);const owner=ownerPolicy(),limits=Object.fromEntries(owner.budgets.map((item:any)=>[item.dimension,item.limit]));
    const allocation=(tenantId:string,tenantLimits=limits)=>JSON.stringify({schemaVersion:1,tenantId,ownerPolicyId:owner.policyId,ownerPolicyRevision:1,revision:1,mode:'conservative',limits:tenantLimits,disabledFeatures:[]});
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES('channel-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies(deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES('channel-deployment','channel-policy',1,1,'channel-coordinator',64,60000,?)`).bind(JSON.stringify(owner)),
      ...[tenant,other].flatMap(t=>[
        db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin',?,'admin',1,1)").bind(t,`admin-${t}@example.test`),
        db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'agent',?,'agent',1,1)").bind(t,`agent-${t}@example.test`),
        db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES('channel-deployment',?,'channel-policy',1,1,?,?,'active')`).bind(t,`channel-${t}`,allocation(t)),
        db.prepare("INSERT INTO tenant_role_capability_policies(tenant_id,role,capability,enabled,revision) VALUES(?,'agent','channels.email.manage',1,1)").bind(t),
      ]),
      db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin','limited@example.test','admin',1,1)").bind(limited),
      db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES('channel-deployment',?,'channel-policy',1,1,?,?, 'active')`).bind(limited,`channel-${limited}`,allocation(limited,{...limits,d1RowsRead:1})),
      db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES(?,?,'Owned group')").bind(tenant,group),
      db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES(?,?,'Race group')").bind(tenant,raceGroup),
      db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES(?,'55555555-5555-4555-8555-555555555555','Foreign group')").bind(other),
      db.prepare("INSERT INTO support_emails(tenant_id,id,email_address,normalized_email,name,is_default) VALUES(?,?,'mutable@example.test','mutable@example.test','Mutable',1)").bind(tenant,mutable),
      db.prepare("INSERT INTO support_emails(tenant_id,id,email_address,normalized_email,name,is_default) VALUES(?,?,'foreign@example.test','foreign@example.test','Foreign',1)").bind(other,foreign),
    ]);
    let admin=await token('admin','admin'),agent=await token('agent','agent');
    const request=(path:string,method:string,bearer:string,body?:unknown,key?:string)=>mf.dispatchFetch(`http://runtime.test${path}`,{method,headers:{authorization:`Bearer ${bearer}`,
      ...(body===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const control=async(value:Record<string,unknown>={})=>await(await mf.dispatchFetch('http://runtime.test/__channel-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})).json() as any;

    const createdInput={email_address:'owned@example.test',name:'Owned support',group_id:group,is_default:true};
    const created=await request('/api/channels/emails','POST',agent,createdInput,'channel-create');assert.equal(created.status,201,await created.clone().text());const createdBody=await created.json() as any;
    assert.equal(createdBody.normalized_email,'owned@example.test');assert.equal(createdBody.group_id,group);assert.equal(createdBody.is_default,1);
    assert.equal((await db.prepare('SELECT is_default FROM support_emails WHERE tenant_id=? AND id=?').bind(tenant,mutable).first<any>()).is_default,0);
    const replay=await request('/api/channels/emails','POST',agent,createdInput,'channel-create');assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.equal((await replay.json() as any).id,createdBody.id);
    const collision=await request('/api/channels/emails','POST',agent,{...createdInput,name:'Collision'},'channel-create');assert.equal(collision.status,409);await collision.body?.cancel();
    const duplicateDefault=await request('/api/channels/emails','POST',agent,{...createdInput,name:'Duplicate'},'channel-duplicate');assert.equal(duplicateDefault.status,409);assert.equal((await duplicateDefault.json() as any).error,'Email address already exists');
    assert.equal((await db.prepare('SELECT is_default FROM support_emails WHERE tenant_id=? AND id=?').bind(tenant,createdBody.id).first<any>()).is_default,1,'duplicate batch must not clear the current default');
    await db.prepare('DELETE FROM groups WHERE tenant_id=? AND id=?').bind(tenant,group).run();
    const replayAfterGroupDelete=await request('/api/channels/emails','POST',agent,createdInput,'channel-create');assert.equal(replayAfterGroupDelete.status,201);assert.equal(replayAfterGroupDelete.headers.get('Idempotency-Replayed'),'true');await replayAfterGroupDelete.body?.cancel();
    const missingGroup=await request('/api/channels/emails','POST',agent,{email_address:'missing-group@example.test',group_id:'55555555-5555-4555-8555-555555555555',is_default:false},'missing-group');
    assert.equal(missingGroup.status,400);assert.equal((await missingGroup.json() as any).error,'Group not found in this tenant');

    const list=await request('/api/channels/emails','GET',admin);assert.equal(list.status,200);const listed=await list.json() as any[];
    assert.ok(listed.some(row=>row.id===createdBody.id));assert.ok(!listed.some(row=>row.id===foreign));
    const foreignDelete=await request(`/api/channels/emails/${foreign}`,'DELETE',admin,undefined,'foreign-delete');assert.equal(foreignDelete.status,403);await foreignDelete.body?.cancel();
    assert.ok(await db.prepare('SELECT 1 FROM support_emails WHERE tenant_id=? AND id=?').bind(other,foreign).first());
    const missingDelete=await request('/api/channels/emails/66666666-6666-4666-8666-666666666666','DELETE',admin,undefined,'missing-delete');assert.equal(missingDelete.status,403);await missingDelete.body?.cancel();

    await db.prepare("UPDATE tenant_role_capability_policies SET enabled=0,revision=revision+1 WHERE tenant_id=? AND role='agent' AND capability='channels.email.manage'").bind(tenant).run();
    const policyDenied=await request('/api/channels/emails','POST',agent,{email_address:'denied@example.test',is_default:false},'policy-denied');assert.equal(policyDenied.status,403);await policyDenied.body?.cancel();
    await db.prepare("UPDATE tenant_role_capability_policies SET enabled=1,revision=revision+1 WHERE tenant_id=? AND role='agent' AND capability='channels.email.manage'").bind(tenant).run();

    await control({beforeCanonical:'group-delete'});const groupRace=await request('/api/channels/emails','POST',admin,{email_address:'group-race@example.test',group_id:raceGroup,is_default:true},'group-race');
    assert.equal(groupRace.status,503);await groupRace.body?.cancel();assert.equal((await db.prepare("SELECT count(*) n FROM support_emails WHERE tenant_id=? AND is_default<>0").bind(tenant).first<any>()).n,1);
    assert.equal((await db.prepare("SELECT count(*) n FROM support_emails WHERE tenant_id=? AND normalized_email='group-race@example.test'").bind(tenant).first<any>()).n,0);

    const largeName='x'.repeat(900_000);await db.prepare("INSERT INTO support_emails(tenant_id,id,email_address,normalized_email,name,is_default) VALUES(?,'77777777-7777-4777-8777-777777777777','large@limited.test','large@limited.test',?,0)").bind(limited,largeName).run();
    const limitedAdmin=await token('admin','admin',1,limited),largeDenied=await request('/api/channels/emails','GET',limitedAdmin);assert.equal(largeDenied.status,429);await largeDenied.body?.cancel();
    const deniedMetric=(await control()).attempts.at(-1);assert.equal(deniedMetric.preAdmissionBodyLoads,0);assert.ok(deniedMetric.d1RowsRead<100);
    const deleteDenied=await request('/api/channels/emails/77777777-7777-4777-8777-777777777777','DELETE',limitedAdmin,undefined,'large-delete');assert.equal(deleteDenied.status,429);await deleteDenied.body?.cancel();
    assert.equal((await control()).attempts.at(-1).preAdmissionBodyLoads,0);assert.ok(await db.prepare("SELECT 1 FROM support_emails WHERE tenant_id=? AND id='77777777-7777-4777-8777-777777777777'").bind(limited).first());

    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<240)
      INSERT INTO support_emails(tenant_id,id,email_address,normalized_email,name,is_default)
      SELECT ?,printf('80000000-0000-4000-8000-%012d',x),printf('large-%04d@example.test',x),printf('large-%04d@example.test',x),printf('%.*c',2048,120),1 FROM n`).bind(tenant).run();
    const largeList=await request('/api/channels/emails','GET',admin);assert.equal(largeList.status,200,await largeList.clone().text());assert.equal((await largeList.json() as any[]).length,242);
    const listMetric=(await control()).attempts.at(-1),listGrant=await db.prepare('SELECT operation_envelope_json FROM budget_grant_operations WHERE tenant_id=? ORDER BY rowid DESC LIMIT 1').bind(tenant).first<any>(),listReserved=JSON.parse(listGrant.operation_envelope_json);
    assert.ok(listMetric.d1RowsRead<=listReserved.d1RowsRead);assert.ok(listMetric.d1RowsWritten<=listReserved.d1RowsWritten);
    console.log(JSON.stringify({fixture:'channel-list-242-rows-500kb',measured:listMetric,reserved:listReserved}));
    await control({beforeCanonical:'population-growth'});const defaultRace=await request('/api/channels/emails','POST',admin,{email_address:'raced-default@example.test',is_default:true},'default-race');assert.equal(defaultRace.status,503);await defaultRace.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) n FROM support_emails WHERE tenant_id=? AND is_default<>0").bind(tenant).first<any>()).n,241);
    assert.equal((await db.prepare("SELECT count(*) n FROM support_emails WHERE tenant_id=? AND normalized_email='raced-default@example.test'").bind(tenant).first<any>()).n,0);
    const switchDefault=await request('/api/channels/emails','POST',admin,{email_address:'new-default@example.test',name:'New default',is_default:true},'default-population');assert.equal(switchDefault.status,201,await switchDefault.clone().text());const switched=await switchDefault.json() as any;
    assert.equal((await db.prepare("SELECT count(*) n FROM support_emails WHERE tenant_id=? AND is_default<>0").bind(tenant).first<any>()).n,1);assert.equal((await db.prepare('SELECT is_default FROM support_emails WHERE tenant_id=? AND id=?').bind(tenant,switched.id).first<any>()).is_default,1);
    assert.equal((await db.prepare("SELECT email_address FROM support_emails WHERE tenant_id=? AND is_default=1 ORDER BY created_at ASC,id ASC LIMIT 1").bind(tenant).first<any>()).email_address,'new-default@example.test');
    const defaultMetric=(await control()).attempts.at(-1),defaultGrant=await db.prepare(`SELECT o.operation_envelope_json FROM budget_grant_operations o JOIN channel_configuration_mutation_receipts r
      ON r.tenant_id=o.tenant_id AND r.key_hash=o.operation_id WHERE r.tenant_id=? AND r.operation='dashboard.channel.email.create' AND r.response_snapshot LIKE '%new-default@example.test%' LIMIT 1`).bind(tenant).first<any>(),defaultReserved=JSON.parse(defaultGrant.operation_envelope_json);
    assert.ok(defaultMetric.d1RowsRead<=defaultReserved.d1RowsRead);assert.ok(defaultMetric.d1RowsWritten<=defaultReserved.d1RowsWritten);assert.ok(defaultMetric.d1RowsWritten>500);
    console.log(JSON.stringify({fixture:'channel-default-switch-241-existing-defaults',measured:defaultMetric,reserved:defaultReserved}));

    await control({beforeCanonical:'population-growth'});const growth=await request('/api/channels/emails','GET',admin);assert.equal(growth.status,503);await growth.body?.cancel();
    await control({beforeCanonical:'target-update'});const targetRace=await request(`/api/channels/emails/${mutable}`,'DELETE',admin,undefined,'target-race');assert.equal(targetRace.status,503);await targetRace.body?.cancel();
    assert.ok(await db.prepare('SELECT 1 FROM support_emails WHERE tenant_id=? AND id=?').bind(tenant,mutable).first());
    await control({beforeCanonical:'capability'});const capability=await request('/api/channels/emails','POST',admin,{email_address:'capability@example.test',is_default:false},'capability-race');assert.equal(capability.status,503);await capability.body?.cancel();
    await db.prepare("UPDATE deployment_capability_ceiling SET enabled=1 WHERE capability='channels.email.manage'").run();
    await control({beforeCanonical:'mfa'});const mfa=await request('/api/channels/emails','POST',admin,{email_address:'mfa@example.test',is_default:false},'mfa-race');assert.equal(mfa.status,503);await mfa.body?.cancel();
    await db.prepare("UPDATE users SET mfa_enabled=1 WHERE tenant_id=? AND id='admin'").bind(tenant).run();
    await control({beforeCanonical:'session'});const session=await request('/api/channels/emails','POST',admin,{email_address:'session@example.test',is_default:false},'session-race');assert.equal(session.status,401);await session.body?.cancel();
    const currentSession=(await db.prepare("SELECT session_version FROM users WHERE tenant_id=? AND id='admin'").bind(tenant).first<any>()).session_version;admin=await token('admin','admin',currentSession);
    await control({discard:true,beforeCanonical:'grant-collision'});const grantCollision=await request('/api/channels/emails','POST',admin,{email_address:'grant@example.test',is_default:false},'grant-race');assert.equal(grantCollision.status,503);await grantCollision.body?.cancel();
    await control({discard:true,beforeCanonical:'closure'});const closure=await request('/api/channels/emails','POST',admin,{email_address:'closure@example.test',is_default:false},'closure-race');assert.equal(closure.status,503);await closure.body?.cancel();
    assert.ok((await db.prepare('SELECT count(*) n FROM budget_grant_closures').first<any>()).n>0);

    await control({discard:true,failCanonicalAck:true});const recovered=await request('/api/channels/emails','POST',admin,{email_address:'recovered@example.test',is_default:false},'lost-ack');assert.equal(recovered.status,201,await recovered.clone().text());
    assert.equal(recovered.headers.get('Idempotency-Replayed'),'true');const recoveredBody=await recovered.json() as any;
    const recoveredRetry=await request('/api/channels/emails','POST',admin,{email_address:'recovered@example.test',is_default:false},'lost-ack');assert.equal(recoveredRetry.status,201);assert.equal(recoveredRetry.headers.get('Idempotency-Replayed'),'true');assert.equal((await recoveredRetry.json() as any).id,recoveredBody.id);
    const deleted=await request(`/api/channels/emails/${recoveredBody.id}`,'DELETE',admin,undefined,'delete-success');assert.equal(deleted.status,200);assert.deepEqual(await deleted.json(),{success:true});
    const deleteReplay=await request(`/api/channels/emails/${recoveredBody.id}`,'DELETE',admin,undefined,'delete-success');assert.equal(deleteReplay.status,200);assert.equal(deleteReplay.headers.get('Idempotency-Replayed'),'true');await deleteReplay.body?.cancel();
    const deleteCollision=await request(`/api/channels/emails/${mutable}`,'DELETE',admin,undefined,'delete-success');assert.equal(deleteCollision.status,409);await deleteCollision.body?.cancel();
    assert.ok(await db.prepare('SELECT 1 FROM support_emails WHERE tenant_id=? AND id=?').bind(tenant,mutable).first());

    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<80)
      INSERT INTO channel_configuration_mutation_receipts(tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_bytes,reserved_d1_rows_read,reserved_d1_rows_written,response_snapshot,created_at,expires_at)
      SELECT tenant_id,principal_id,'dashboard.channel.email.create',printf('%064x',9000+x),payload_hash,201,response_bytes,reserved_d1_rows_read,reserved_d1_rows_written,response_snapshot,unixepoch()-100,unixepoch()-1
      FROM channel_configuration_mutation_receipts,n WHERE tenant_id=? AND operation='dashboard.channel.email.create' LIMIT 80`).bind(tenant).run();
    const cleanup=await request('/api/channels/emails','POST',admin,{email_address:'cleanup@example.test',is_default:false},'cleanup-proof');assert.equal(cleanup.status,201,await cleanup.clone().text());await cleanup.body?.cancel();
    assert.equal((await db.prepare('SELECT count(*) n FROM channel_configuration_mutation_receipts WHERE tenant_id=? AND expires_at<=unixepoch()').bind(tenant).first<any>()).n,64);
    const cleanupMetric=(await control()).attempts.at(-1),cleanupGrant=await db.prepare(`SELECT o.operation_envelope_json FROM budget_grant_operations o JOIN channel_configuration_mutation_receipts r
      ON r.tenant_id=o.tenant_id AND r.key_hash=o.operation_id WHERE r.tenant_id=? AND r.response_snapshot LIKE '%cleanup@example.test%' LIMIT 1`).bind(tenant).first<any>(),cleanupReserved=JSON.parse(cleanupGrant.operation_envelope_json);
    assert.ok(cleanupMetric.d1RowsRead<=cleanupReserved.d1RowsRead);assert.ok(cleanupMetric.d1RowsWritten<=cleanupReserved.d1RowsWritten);
    console.log(JSON.stringify({fixture:'channel-create-with-80-expired-receipts',measured:cleanupMetric,reserved:cleanupReserved}));

    const receiptsBefore=(await db.prepare("SELECT count(*) n FROM channel_configuration_mutation_receipts WHERE tenant_id=? AND operation='dashboard.channel.email.delete'").bind(tenant).first<any>()).n;
    await control({discard:true,beforeCanonical:'authority'});const authority=await request(`/api/channels/emails/${mutable}`,'DELETE',admin,undefined,'authority-delete');assert.equal(authority.status,503);await authority.body?.cancel();
    assert.ok(await db.prepare('SELECT 1 FROM support_emails WHERE tenant_id=? AND id=?').bind(tenant,mutable).first());assert.equal((await db.prepare("SELECT count(*) n FROM channel_configuration_mutation_receipts WHERE tenant_id=? AND operation='dashboard.channel.email.delete'").bind(tenant).first<any>()).n,receiptsBefore);
  }finally{await mf.dispose();}
});

test('explicit off policy preserves legacy support-email behavior and metadata triggers',async()=>{
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/channel-configuration-admission-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'channel-off',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'off',DISABLE_RATE_LIMIT:'true',ENVIRONMENT:'local',JWT_SECRET:secret},d1Databases:{DB:'channel-off-d1'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  try{const db=await mf.getD1Database('DB');await apply(db);const off='channel-off';
    await db.batch([db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'admin','off@example.test','admin',1,1)").bind(off),
      db.prepare("INSERT INTO support_emails(tenant_id,id,email_address,normalized_email,name,is_default) VALUES(?,'99999999-9999-4999-8999-999999999999','old@off.test','old@off.test','Old',1)").bind(off)]);
    const bearer=await token('admin','admin',1,off),headers={authorization:`Bearer ${bearer}`,'content-type':'application/json'};
    const created=await mf.dispatchFetch('http://runtime.test/api/channels/emails',{method:'POST',headers,body:JSON.stringify({email_address:'new@off.test',name:'New',is_default:true})});assert.equal(created.status,201,await created.clone().text());const row=await created.json() as any;
    assert.equal((await db.prepare("SELECT count(*) n FROM support_emails WHERE tenant_id=? AND is_default<>0").bind(off).first<any>()).n,1);
    const listed=await mf.dispatchFetch('http://runtime.test/api/channels/emails',{headers:{authorization:`Bearer ${bearer}`}});assert.equal(listed.status,200);assert.equal((await listed.json() as any[]).length,2);
    const deleted=await mf.dispatchFetch(`http://runtime.test/api/channels/emails/${row.id}`,{method:'DELETE',headers:{authorization:`Bearer ${bearer}`}});assert.equal(deleted.status,200);await deleted.body?.cancel();
    assert.equal((await db.prepare('SELECT count(*) n FROM channel_configuration_mutation_receipts WHERE tenant_id=?').bind(off).first<any>()).n,0);
    const population=await db.prepare('SELECT row_count,default_rows,content_bytes FROM channel_configuration_population WHERE tenant_id=?').bind(off).first<any>();assert.deepEqual([population.row_count,population.default_rows],[1,0]);assert.ok(population.content_bytes>0);
    const measurements=await(await mf.dispatchFetch('http://runtime.test/__channel-control')).json() as any;
    console.log(JSON.stringify({fixture:'legacy-channel-trigger-path',measuredWrites:measurements.attempts.filter((item:any)=>item.path.startsWith('/api/channels')).map((item:any)=>item.d1RowsWritten)}));
  }finally{await mf.dispose();}
});
