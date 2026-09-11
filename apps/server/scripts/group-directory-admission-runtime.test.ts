import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { readFileSync,readdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { groupDirectoryEnvelope } from '../src/budgets/group-directory-admission.service';

const root=resolve(import.meta.dirname,'..');
const now=Date.now();
const secret='synthetic-group-directory-admission-secret-32';
const actor='00000000-0000-4000-8000-000000000001';
const largeGroup='00000000-0000-4000-8000-000000000010';
const deleteGroup='00000000-0000-4000-8000-000000000011';
const dimensions=['workerRequests','d1RowsRead','d1RowsWritten','doRequests','doRowsRead','doRowsWritten','logEvents'] as const;

async function token(){return new SignJWT({sub:actor,role:'agent',tenant_id:'directory-tenant',session_version:1,mfa_verified:true})
  .setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));}

async function fixture(population=0,limit=10_000_000){
  const bundled=await build({entryPoints:[resolve(import.meta.dirname,'group-directory-admission-runtime-entry.ts')],bundle:true,
    format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto'],write:false});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'group-directory-proof',modules:true,
    compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundled.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',DISABLE_RATE_LIMIT:'true',JWT_SECRET:secret},
    d1Databases:{DB:'group-directory-d1'},r2Buckets:{ATTACHMENTS_BUCKET:'group-directory-r2'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},
    unsafeEphemeralDurableObjects:true}]}));
  try{
    const db=await mf.getD1Database('DB');
    for(const migration of readdirSync(join(root,'migrations')).filter(file=>file.endsWith('.sql')).sort()){
      await db.batch(splitSql(readFileSync(join(root,'migrations',migration),'utf8')).map(sql=>db.prepare(sql)));
    }
    const limits=Object.fromEntries(dimensions.map(dimension=>[dimension,limit]));
    const owner={schemaVersion:1,policyId:'directory-policy',revision:1,deploymentId:'directory-deployment',mode:'conservative',
      catalogueVersion:'synthetic-2026-09',maxGrantLifetimeMs:60_000,budgets:dimensions.map(dimension=>({dimension,limit,
        allocationId:`directory-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',window:{kind:'interval',id:'directory-window',startsAt:now-1_000,endsAt:now+3_600_000}}))};
    const restriction={schemaVersion:1,tenantId:'directory-tenant',ownerPolicyId:owner.policyId,ownerPolicyRevision:1,revision:1,
      mode:'conservative',limits,disabledFeatures:[]};
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES('directory-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies(deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES('directory-deployment','directory-policy',1,1,'directory-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
      db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES('directory-deployment','directory-tenant','directory-policy',1,1,'directory-tenant',?,'active')`).bind(JSON.stringify(restriction)),
      db.prepare("INSERT INTO users(tenant_id,id,email,full_name,role,session_version,mfa_enabled) VALUES('directory-tenant',?,'operator@example.test','Operator','agent',1,1)").bind(actor),
      db.prepare("INSERT INTO tenant_role_capability_policies(tenant_id,role,capability,enabled) VALUES('directory-tenant','agent','groups.manage',1)"),
      db.prepare("INSERT INTO tenant_role_capability_policies(tenant_id,role,capability,enabled) VALUES('directory-tenant','agent','users.manage',1)"),
      db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES('directory-tenant',?,'Large members')").bind(largeGroup),
      db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES('directory-tenant',?,'Delete members')").bind(deleteGroup),
      db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES('foreign-tenant','foreign-group','Foreign')"),
    ]);
    if(population>0)await db.batch([
      db.prepare(`WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i+1<?)
        INSERT INTO users(tenant_id,id,email,full_name,role,session_version,mfa_enabled,created_at)
        SELECT 'directory-tenant',printf('10000000-0000-4000-8000-%012d',i),'agent-'||i||'@example.test','Agent '||i,'agent',0,0,datetime(1767225600+i,'unixepoch') FROM seq`).bind(population),
      db.prepare(`WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i+1<?)
        INSERT INTO groups(tenant_id,id,name,created_at)
        SELECT 'directory-tenant',printf('20000000-0000-4000-8000-%012d',i),'Group '||i,datetime(1767225600+i,'unixepoch') FROM seq`).bind(population),
    ]);
    if(population>0)await db.batch([
      db.prepare(`INSERT INTO user_groups(tenant_id,user_id,group_id)
        SELECT tenant_id,id,? FROM users WHERE tenant_id='directory-tenant' AND id LIKE '10000000-%'`).bind(largeGroup),
      db.prepare(`INSERT INTO user_groups(tenant_id,user_id,group_id)
        SELECT tenant_id,id,? FROM users WHERE tenant_id='directory-tenant' AND id LIKE '10000000-%'`).bind(deleteGroup),
    ]);
    // Foreign history is deliberately substantial but never enters a tenant result or counter reservation.
    if(population>0)await db.prepare(`WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i+1<?)
      INSERT INTO users(tenant_id,id,email,role) SELECT 'foreign-tenant',printf('30000000-0000-4000-8000-%012d',i),'foreign-'||i||'@example.test','agent' FROM seq`)
      .bind(Math.min(population,400)).run();
    return{mf,db};
  }catch(error){await mf.dispose();throw error;}
}

async function request(mf:Miniflare,path:string,auth:string,init:{method?:string;body?:string;headers?:Record<string,string>}={}){
  const headers=new Headers(init.headers);headers.set('authorization',`Bearer ${auth}`);if(init.body)headers.set('content-type','application/json');
  return mf.dispatchFetch(`http://runtime.test${path}`,{...init,headers:Object.fromEntries(headers.entries())});
}
async function control(mf:Miniflare,body?:unknown){return(await(await mf.dispatchFetch('http://runtime.test/__group-directory-control',
  body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined)).json()) as any;}

test('dynamic reservations return complete 2,801-row directories and delete every admitted member',async t=>{
  const f=await fixture(2_801);
  try{
    const auth=await token();
    const agents=await request(f.mf,'/api/users/agents',auth);assert.equal(agents.status,200,await agents.clone().text());
    assert.equal((await agents.json() as unknown[]).length,2_802,'staff directory is not truncated at the legacy 100 rows');
    const groups=await request(f.mf,'/api/groups',auth);assert.equal(groups.status,200);
    assert.equal((await groups.json() as unknown[]).length,2_803,'complete same-tenant group directory is returned');
    const members=await request(f.mf,`/api/groups/${largeGroup}/members`,auth);assert.equal(members.status,200);
    assert.equal((await members.json() as unknown[]).length,2_801,'complete member list exceeds the old fixed read envelope');
    const foreign=await request(f.mf,'/api/groups/foreign-group/members',auth);assert.equal(foreign.status,404);await foreign.body?.cancel();

    await control(f.mf,{kind:'users-growth'});
    const userRace=await request(f.mf,'/api/users/agents',auth);assert.equal(userRace.status,503);await userRace.body?.cancel();
    const grownAgents=await request(f.mf,'/api/users/agents',auth);assert.equal(grownAgents.status,200);
    assert.equal((await grownAgents.json() as unknown[]).length,2_803);
    const lastUserPage=await request(f.mf,'/api/users?page=29&limit=100',auth);assert.equal(lastUserPage.status,200);
    assert.equal(((await lastUserPage.json() as {users:unknown[]}).users).length,3,'high pages remain accessible');
    await control(f.mf,{kind:'groups-growth'});
    const groupRace=await request(f.mf,'/api/groups',auth);assert.equal(groupRace.status,503);await groupRace.body?.cancel();
    const grownGroups=await request(f.mf,'/api/groups',auth);assert.equal(grownGroups.status,200);
    assert.equal((await grownGroups.json() as unknown[]).length,2_804);

    await control(f.mf,{kind:'members-growth',groupId:largeGroup});
    const raced=await request(f.mf,`/api/groups/${largeGroup}/members`,auth);
    assert.equal(raced.status,503,'post-admission growth is rejected by the same-batch population fence');await raced.body?.cancel();
    const retried=await request(f.mf,`/api/groups/${largeGroup}/members`,auth);assert.equal(retried.status,200);
    assert.equal((await retried.json() as unknown[]).length,2_802,'a fresh reservation admits the complete grown population');

    const deleted=await request(f.mf,`/api/groups/${deleteGroup}`,auth,{method:'DELETE'});
    assert.equal(deleted.status,200,await deleted.clone().text());
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM user_groups WHERE tenant_id='directory-tenant' AND group_id=?").bind(deleteGroup).first<{count:number}>())!.count,0);
    assert.equal(await f.db.prepare("SELECT member_count FROM group_directory_member_population WHERE tenant_id='directory-tenant' AND group_id=?").bind(deleteGroup).first(),null);

    const proof=await control(f.mf);const measured=proof.measurements as {path:string;rowsRead:number;rowsWritten:number}[];
    const memberEnvelope=groupDirectoryEnvelope('directory.group.members.list',{kind:'group-members',groupId:largeGroup,count:2_802})!;
    const memberAttempt=[...measured].reverse().find(item=>item.path.endsWith(`${largeGroup}/members`))!;
    assert.ok(memberAttempt.rowsRead<=(memberEnvelope.d1RowsRead??0),`${memberAttempt.rowsRead} native D1 reads fit ${memberEnvelope.d1RowsRead}`);
    const deleteEnvelope=groupDirectoryEnvelope('directory.group.delete',{kind:'group-members',groupId:deleteGroup,count:2_801})!;
    const deleteAttempt=measured.find(item=>item.path.endsWith(deleteGroup))!;
    assert.ok(deleteAttempt.rowsRead<=(deleteEnvelope.d1RowsRead??0));assert.ok(deleteAttempt.rowsWritten<=(deleteEnvelope.d1RowsWritten??0));
    t.diagnostic(`native member-list attempt: ${memberAttempt.rowsRead} D1 rows read / ${memberAttempt.rowsWritten} written; reserved ${memberEnvelope.d1RowsRead}/${memberEnvelope.d1RowsWritten}`);
    t.diagnostic(`native 2,801-member deletion attempt: ${deleteAttempt.rowsRead} D1 rows read / ${deleteAttempt.rowsWritten} written; reserved ${deleteEnvelope.d1RowsRead}/${deleteEnvelope.d1RowsWritten}`);
    const plan=await f.db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM tickets WHERE tenant_id=? AND group_id=? LIMIT 1").bind('directory-tenant',deleteGroup).all();
    assert.match(JSON.stringify(plan.results),/idx_tickets_tenant_group/);
  }finally{await f.mf.dispose();}
});

test('writes preserve statuses, fresh retries spend, and final fences reject changed authority',async()=>{
  const f=await fixture();
  try{
    const auth=await token();const group='00000000-0000-4000-8000-000000000020';const user='00000000-0000-4000-8000-000000000021';
    await f.db.batch([
      f.db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES('directory-tenant',?,'Status group')").bind(group),
      f.db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES('directory-tenant',?,'status-user@example.test','customer')").bind(user),
    ]);
    const createBody=JSON.stringify({name:'Created group',description:'proof'});
    assert.equal((await request(f.mf,'/api/groups',auth,{method:'POST',body:createBody})).status,201);
    assert.equal((await request(f.mf,'/api/groups',auth,{method:'POST',body:createBody})).status,409);
    const memberBody=JSON.stringify({userId:user});
    assert.equal((await request(f.mf,`/api/groups/${group}/members`,auth,{method:'POST',body:memberBody})).status,200);
    assert.equal((await request(f.mf,`/api/groups/${group}/members`,auth,{method:'POST',body:memberBody})).status,409);
    assert.equal((await request(f.mf,`/api/groups/${group}/members/${user}`,auth,{method:'DELETE'})).status,200);
    assert.equal((await request(f.mf,`/api/groups/${group}/members/${user}`,auth,{method:'DELETE'})).status,404);
    const spent=(await control(f.mf)).cache.operations;assert.equal(spent,6,'each semantic retry has a fresh immutable operation spend');

    await control(f.mf,{kind:'capability'});
    const capability=await request(f.mf,'/api/groups',auth,{method:'POST',body:JSON.stringify({name:'Denied'})});
    assert.equal(capability.status,503);assert.equal(await f.db.prepare("SELECT 1 FROM groups WHERE tenant_id='directory-tenant' AND name='Denied'").first(),null);
    await f.db.prepare("UPDATE deployment_capability_ceiling SET enabled=1,revision=1 WHERE capability='groups.manage'").run();
    await control(f.mf,{kind:'session'});
    const revoked=await request(f.mf,`/api/groups/${group}/members/${user}`,auth,{method:'DELETE'});assert.equal(revoked.status,503);
    await f.db.prepare("UPDATE users SET session_version=1 WHERE tenant_id='directory-tenant' AND id=?").bind(actor).run();
    await control(f.mf,{kind:'mfa'});
    const mfa=await request(f.mf,'/api/groups',auth);assert.equal(mfa.status,503);await mfa.body?.cancel();
    await f.db.batch([
      f.db.prepare("UPDATE users SET mfa_enabled=1 WHERE tenant_id='directory-tenant' AND id=?").bind(actor),
      f.db.prepare("UPDATE users SET session_version=1 WHERE tenant_id='directory-tenant' AND id=?").bind(actor),
    ]);
    await control(f.mf,{kind:'budget'});
    const policy=await request(f.mf,'/api/groups',auth);assert.equal(policy.status,503);await policy.body?.cancel();
  }finally{await f.mf.dispose();}
});

test('ticket arrival blocks deletion and exhausted capacity never reaches the directory batch',async()=>{
  const f=await fixture();
  try{
    const auth=await token();await control(f.mf,{kind:'ticket',groupId:deleteGroup});
    const raced=await request(f.mf,`/api/groups/${deleteGroup}`,auth,{method:'DELETE'});assert.equal(raced.status,400);
    assert.ok(await f.db.prepare("SELECT 1 FROM groups WHERE tenant_id='directory-tenant' AND id=?").bind(deleteGroup).first());
  }finally{await f.mf.dispose();}
  const exhausted=await fixture(0,1);
  try{
    const response=await request(exhausted.mf,'/api/groups',await token());assert.equal(response.status,429);await response.body?.cancel();
    assert.equal((await control(exhausted.mf)).measurements[0].rowsWritten,0,'exhaustion performs no directory assertion or business write');
  }finally{await exhausted.mf.dispose();}
});

test('the 65th actor membership denies capability work through a bounded sentinel read',async()=>{
  const f=await fixture();
  try{
    await f.db.batch(Array.from({length:65},(_,index)=>f.db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES('directory-tenant',?,?)")
      .bind(`70000000-0000-4000-8000-${String(index).padStart(12,'0')}`,`Actor group ${index}`)));
    await f.db.batch(Array.from({length:65},(_,index)=>f.db.prepare("INSERT INTO user_groups(tenant_id,user_id,group_id) VALUES('directory-tenant',?,?)")
      .bind(actor,`70000000-0000-4000-8000-${String(index).padStart(12,'0')}`)));
    const response=await request(f.mf,'/api/users',await token());assert.equal(response.status,403);await response.body?.cancel();
    const measured=(await control(f.mf)).measurements[0] as {rowsRead:number;rowsWritten:number};
    assert.ok(measured.rowsRead<=3_072,`bounded capability sentinel read ${measured.rowsRead} rows`);assert.equal(measured.rowsWritten,0);
  }finally{await f.mf.dispose();}
});

test('a delayed read or mutation cannot cross a whole-grant closure and retains terminal evidence',async()=>{
  const read=await fixture();
  try{
    await control(read.mf,{kind:'closure'});
    const response=await request(read.mf,'/api/groups',await token());assert.equal(response.status,503);await response.body?.cancel();
    assert.equal((await read.db.prepare("SELECT count(*) AS count FROM budget_grant_operations").first<{count:number}>())!.count,1,
      'the exact operation row used by terminal evidence is retained');
    assert.equal((await read.db.prepare("SELECT count(*) AS count FROM budget_grant_closures").first<{count:number}>())!.count,1);
  }finally{await read.mf.dispose();}
  const mutation=await fixture();
  try{
    await control(mutation.mf,{kind:'closure'});
    const response=await request(mutation.mf,'/api/groups',await token(),{method:'POST',body:JSON.stringify({name:'After closure'})});
    assert.equal(response.status,503);await response.body?.cancel();
    assert.equal(await mutation.db.prepare("SELECT 1 FROM groups WHERE tenant_id='directory-tenant' AND name='After closure'").first(),null);
    assert.equal((await mutation.db.prepare("SELECT count(*) AS count FROM budget_grant_operations").first<{count:number}>())!.count,1);
    assert.equal((await mutation.db.prepare("SELECT count(*) AS count FROM budget_grant_closures").first<{count:number}>())!.count,1);
  }finally{await mutation.mf.dispose();}
});
