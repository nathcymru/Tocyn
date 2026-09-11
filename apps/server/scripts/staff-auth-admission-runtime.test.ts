import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {SignJWT} from 'jose';
import * as OTPAuth from 'otpauth';
import {RESOURCE_DIMENSIONS,STOCK_DIMENSIONS,type ResourceAmounts} from '@luminatick/shared';
import {splitSql} from './split-sql';
import {mfaService} from '../src/services/auth/mfa.service';
import {isolateWarmReservedEnvelope} from '../src/budgets/isolate-grant-holder';
import {staffAuthEnvelope,type StaffAuthOperation} from '../src/budgets/staff-auth-admission.service';

const root=resolve(import.meta.dirname,'..');
const now=Math.floor(Date.now()/1000)*1000;
const jwtSecret='synthetic-staff-auth-secret-at-least-32-characters';
const encryptionKey='synthetic-staff-auth-encryption-key';
const mfaSecrets={admin:'JBSWY3DPEHPK3PXP',enroll:'KRSXG5DSNFXGOIDB'};

async function fixture(){
  const bundled=await build({entryPoints:[resolve(import.meta.dirname,'staff-auth-admission-runtime-entry.ts')],bundle:true,
    format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto'],write:false});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'staff-auth-proof',modules:true,compatibilityDate:'2024-04-03',
    compatibilityFlags:['nodejs_compat'],script:bundled.outputFiles[0].text,bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',
      JWT_SECRET:jwtSecret,MFA_ENCRYPTION_KEY:encryptionKey,DISABLE_RATE_LIMIT:'true'},d1Databases:{DB:'staff-auth-d1'},
    r2Buckets:{ATTACHMENTS_BUCKET:'staff-auth-r2'},durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',
      BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  try{
    const db=await mf.getD1Database('DB');
    for(const migration of readdirSync(join(root,'migrations')).filter(name=>name.endsWith('.sql')).sort())
      await db.batch(splitSql(readFileSync(join(root,'migrations',migration),'utf8')).map(sql=>db.prepare(sql)));
    const high=Object.fromEntries(RESOURCE_DIMENSIONS.map(dimension=>[dimension,50_000_000])) as ResourceAmounts;
    const owner={schemaVersion:1,policyId:'staff-policy',revision:1,deploymentId:'staff-deployment',mode:'conservative',
      catalogueVersion:'synthetic-2026-09',maxGrantLifetimeMs:60_000,budgets:RESOURCE_DIMENSIONS.map(dimension=>({dimension,
        limit:high[dimension],allocationId:`staff-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',
        window:STOCK_DIMENSIONS.includes(dimension)?{kind:'stock',id:`staff-${dimension}-stock`}
          :{kind:'interval',id:'staff-window',startsAt:now-1,endsAt:now+3_600_000}}))};
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('staff-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('staff-deployment','staff-policy',1,1,'staff-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
    ]);
    for(const tenantId of ['staff-a','staff-b','staff-low','staff-zero']){
      const limits=tenantId==='staff-low'?Object.fromEntries(RESOURCE_DIMENSIONS.map(dimension=>[dimension,1])):
        {...high,...(tenantId==='staff-zero'?{d1StorageBytes:0}:{})};
      const restriction={schemaVersion:1,tenantId,ownerPolicyId:'staff-policy',ownerPolicyRevision:1,revision:1,
        mode:'conservative',limits,disabledFeatures:[]};
      await db.prepare(`INSERT INTO budget_tenant_allocations
        (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES ('staff-deployment',?,'staff-policy',1,1,?,?,'active')`)
        .bind(tenantId,`staff-${tenantId}`,JSON.stringify(restriction)).run();
    }
    const encryptedAdmin=await mfaService.encryptSecret(mfaSecrets.admin,encryptionKey);
    const encryptedPending=await mfaService.encryptSecret(mfaSecrets.enroll,encryptionKey);
    await db.batch(['staff-a','staff-b','staff-low','staff-zero'].map(tenantId=>db.prepare(`INSERT INTO users
        (tenant_id,id,email,full_name,role,mfa_secret,mfa_enabled,session_version) VALUES (?,'staff-admin',?,?,'admin',?,1,1)`)
      .bind(tenantId,`${tenantId}@example.test`,tenantId,encryptedAdmin)));
    await db.batch([
      db.prepare(`INSERT INTO users (tenant_id,id,email,full_name,role,mfa_enabled,session_version)
        VALUES ('staff-a','staff-enroll','enroll-a@example.test','Enroll A','agent',0,1)`),
      db.prepare(`INSERT INTO users (tenant_id,id,email,full_name,role,mfa_secret,mfa_enabled,session_version)
        VALUES ('staff-zero','staff-enroll','enroll-zero@example.test','Enroll Zero','agent',?,0,1)`).bind(encryptedPending),
      db.prepare(`INSERT INTO users (tenant_id,id,email,full_name,role,mfa_enabled,session_version)
        VALUES ('staff-zero','staff-new','new-zero@example.test','New Zero','agent',0,1)`),
    ]);
    const token=async(input:{tenantId:string;actorId:string;role?:'admin'|'agent';audience:'app'|'mfa-challenge';mfaVerified:boolean;sessionVersion?:number})=>
      new SignJWT({tenant_id:input.tenantId,role:input.role??'admin',mfa_verified:input.mfaVerified,
        session_version:input.sessionVersion??1,email:`${input.actorId}@example.test`}).setProtectedHeader({alg:'HS256'})
        .setSubject(input.actorId).setAudience(input.audience).setIssuedAt(Math.floor(now/1000))
        .setExpirationTime(Math.floor(now/1000)+3600).sign(new TextEncoder().encode(jwtSecret));
    return{mf,db,token};
  }catch(error){await mf.dispose();throw error;}
}

async function request(f:Awaited<ReturnType<typeof fixture>>,path:string,token:string,body?:unknown){
  return f.mf.dispatchFetch(`http://runtime.test/api/auth${path}`,{method:body===undefined&&path==='/me'?'GET':'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function control(f:Awaited<ReturnType<typeof fixture>>,value?:Record<string,unknown>){
  const response=await f.mf.dispatchFetch('http://runtime.test/__staff-auth-control',value
    ?{method:'POST',body:JSON.stringify(value)}:undefined);
  return response.json() as Promise<{fullUserReads:number;fullUserRows:number;staffRowsRead:number;staffRowsWritten:number}>;
}
function code(secret:string){return new OTPAuth.TOTP({issuer:'Luminatick',algorithm:'SHA1',digits:6,period:30,
  secret:OTPAuth.Secret.fromBase32(secret)}).generate();}
async function operations(f:Awaited<ReturnType<typeof fixture>>,tenantId:string){
  return (await f.db.prepare(`SELECT operation_envelope_json FROM budget_grant_operations WHERE tenant_id=? ORDER BY rowid`).bind(tenantId)
    .all<{operation_envelope_json:string}>()).results.map((row:{operation_envelope_json:string})=>JSON.parse(row.operation_envelope_json) as ResourceAmounts);
}
function expected(operation:StaffAuthOperation,snapshot:{mfaEnabled:boolean;pendingSecret:boolean}){
  return isolateWarmReservedEnvelope(staffAuthEnvelope(operation,snapshot));
}
function assertWithin(measured:Awaited<ReturnType<typeof control>>,operation:StaffAuthOperation,
  snapshot:{mfaEnabled:boolean;pendingSecret:boolean}){
  const envelope=staffAuthEnvelope(operation,snapshot);
  assert.ok(measured.staffRowsRead<=(envelope.d1RowsRead??0),`${measured.staffRowsRead} <= ${envelope.d1RowsRead}`);
  assert.ok(measured.staffRowsWritten<=(envelope.d1RowsWritten??0),`${measured.staffRowsWritten} <= ${envelope.d1RowsWritten}`);
}

test('native MFA verify and current-user read preserve the response, tenant boundary, and exact admitted links',async t=>{
  const f=await fixture();try{
    const challenge=await f.token({tenantId:'staff-a',actorId:'staff-admin',audience:'mfa-challenge',mfaVerified:false});
    await control(f,{reset:true});
    const verified=await request(f,'/mfa/verify',challenge,{code:code(mfaSecrets.admin)});
    assert.equal(verified.status,200,await verified.clone().text());
    const session=(await verified.json() as {token:string;user:Record<string,unknown>});
    assert.equal(session.user.tenant_id,'staff-a');assert.equal('mfa_secret' in session.user,false);
    const verifyMeasured=await control(f);assertWithin(verifyMeasured,'staff.auth.mfa.verify',{mfaEnabled:true,pendingSecret:true});
    await control(f,{reset:true});
    const me=await request(f,'/me',session.token);assert.equal(me.status,200,await me.clone().text());
    assert.equal((await me.json() as {user:{email:string}}).user.email,'staff-a@example.test');
    const meMeasured=await control(f);assertWithin(meMeasured,'staff.auth.me',{mfaEnabled:true,pendingSecret:true});
    const tenantB=await f.token({tenantId:'staff-b',actorId:'staff-admin',audience:'app',mfaVerified:true});
    const other=await request(f,'/me',tenantB);assert.equal(other.status,200);
    assert.equal((await other.json() as {user:{email:string}}).user.email,'staff-b@example.test');
    const links=await operations(f,'staff-a');assert.equal(links.length,2);
    assert.deepEqual(links,[expected('staff.auth.mfa.verify',{mfaEnabled:true,pendingSecret:true}),
      expected('staff.auth.me',{mfaEnabled:true,pendingSecret:true})]);
    t.diagnostic(`native exact D1 metadata verify rows_read=${verifyMeasured.staffRowsRead}, rows_written=${verifyMeasured.staffRowsWritten}; me rows_read=${meMeasured.staffRowsRead}, rows_written=${meMeasured.staffRowsWritten}`);
  }finally{await f.mf.dispose();}
});

test('strict exhaustion and incomplete MFA fail before the full user read or side effects',async()=>{
  const f=await fixture();try{
    const low=await f.token({tenantId:'staff-low',actorId:'staff-admin',audience:'app',mfaVerified:true});
    await control(f,{reset:true});const exhausted=await request(f,'/me',low);assert.equal(exhausted.status,429,await exhausted.clone().text());
    assert.deepEqual(await control(f),{fullUserReads:0,fullUserRows:0,staffRowsRead:0,staffRowsWritten:0});
    const incomplete=await f.token({tenantId:'staff-a',actorId:'staff-admin',audience:'app',mfaVerified:false});
    const denied=await request(f,'/me',incomplete);assert.equal(denied.status,503,await denied.clone().text());
    assert.equal((await control(f)).fullUserReads,0);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM budget_grant_operations').first<{count:number}>())?.count,0);
  }finally{await f.mf.dispose();}
});

for(const action of ['session','role','policy'] as const)test(`post-reservation ${action} change fails the exact native staff read fence`,async()=>{
  const f=await fixture();try{
    const session=await f.token({tenantId:'staff-a',actorId:'staff-admin',audience:'app',mfaVerified:true});
    await control(f,{beforeFence:action,reset:true});const response=await request(f,'/me',session);
    assert.equal(response.status,503,await response.clone().text());
    const measured=await control(f);assert.equal(measured.fullUserRows,0);
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM budget_grant_operations WHERE tenant_id='staff-a'").first<{count:number}>())?.count,0);
  }finally{await f.mf.dispose();}
});

test('lost enrollment acknowledgement retains one secret and retry needs no new stored-byte allocation',async t=>{
  const f=await fixture();try{
    const enrollment=await f.token({tenantId:'staff-a',actorId:'staff-enroll',role:'agent',audience:'mfa-challenge',mfaVerified:false});
    await control(f,{loseEnrollmentAcknowledgement:true,reset:true});
    const lost=await request(f,'/mfa/setup',enrollment);assert.equal(lost.status,503,await lost.clone().text());
    assertWithin(await control(f),'staff.auth.mfa.setup',{mfaEnabled:false,pendingSecret:false});
    const stored=await f.db.prepare("SELECT mfa_secret FROM users WHERE tenant_id='staff-a' AND id='staff-enroll'").first<{mfa_secret:string}>();
    assert.ok(stored?.mfa_secret);const retained=await mfaService.decryptSecret(stored.mfa_secret,encryptionKey);
    await control(f,{reset:true});const retry=await request(f,'/mfa/setup',enrollment);assert.equal(retry.status,200,await retry.clone().text());
    assertWithin(await control(f),'staff.auth.mfa.setup',{mfaEnabled:false,pendingSecret:true});
    assert.equal((await retry.json() as {provisioning_uri:string}).provisioning_uri,mfaService.getProvisioningUri('enroll-a@example.test',retained));
    const links=await operations(f,'staff-a');assert.equal(links.length,2);
    assert.deepEqual(links[0],expected('staff.auth.mfa.setup',{mfaEnabled:false,pendingSecret:false}));
    assert.deepEqual(links[1],expected('staff.auth.mfa.setup',{mfaEnabled:false,pendingSecret:true}));
    assert.equal(links[1].d1StorageBytes??0,0);
    t.diagnostic(`native uncertain setup retained secret; retry exact envelope stored bytes=${links[1].d1StorageBytes??0}`);
  }finally{await f.mf.dispose();}
});

test('zero stock permits pending setup recovery but rejects a new enrollment without mutation',async()=>{
  const f=await fixture();try{
    const pending=await f.token({tenantId:'staff-zero',actorId:'staff-enroll',role:'agent',audience:'mfa-challenge',mfaVerified:false});
    const retry=await request(f,'/mfa/setup',pending);assert.equal(retry.status,200,await retry.clone().text());
    const fresh=await f.token({tenantId:'staff-zero',actorId:'staff-new',role:'agent',audience:'mfa-challenge',mfaVerified:false});
    const denied=await request(f,'/mfa/setup',fresh);assert.equal(denied.status,429,await denied.clone().text());
    assert.equal((await f.db.prepare("SELECT mfa_secret FROM users WHERE tenant_id='staff-zero' AND id='staff-new'").first<{mfa_secret:string|null}>())?.mfa_secret,null);
    const links=await operations(f,'staff-zero');assert.equal(links.length,1);assert.equal(links[0].d1StorageBytes??0,0);
  }finally{await f.mf.dispose();}
});

test('MFA confirmation and logout commit once, revoke old credentials, and leave another tenant active',async()=>{
  const f=await fixture();try{
    const enrollment=await f.token({tenantId:'staff-a',actorId:'staff-enroll',role:'agent',audience:'mfa-challenge',mfaVerified:false});
    const setup=await request(f,'/mfa/setup',enrollment);assert.equal(setup.status,200);
    const uri=(await setup.json() as {provisioning_uri:string}).provisioning_uri;
    const confirmation=await request(f,'/mfa/confirm',enrollment,{code:'invalid'});
    // A malformed code is a settled denial and leaves enrollment pending.
    assert.equal(confirmation.status,400);
    await control(f,{reset:true});const valid=await request(f,'/mfa/confirm',enrollment,{code:code(new URL(uri).searchParams.get('secret')!)});
    assert.equal(valid.status,200,await valid.clone().text());const session=(await valid.json() as {token:string}).token;
    assertWithin(await control(f),'staff.auth.mfa.confirm',{mfaEnabled:false,pendingSecret:true});
    assert.equal((await request(f,'/mfa/confirm',enrollment,{code:'000000'})).status,401);
    assert.equal((await request(f,'/me',session)).status,200);
    const tenantB=await f.token({tenantId:'staff-b',actorId:'staff-admin',audience:'app',mfaVerified:true});
    await control(f,{reset:true});assert.equal((await request(f,'/logout',session)).status,200);
    assertWithin(await control(f),'staff.auth.logout',{mfaEnabled:true,pendingSecret:true});
    assert.equal((await request(f,'/me',session)).status,401);
    assert.equal((await request(f,'/me',tenantB)).status,200);
    const current=await f.db.prepare("SELECT mfa_enabled,session_version FROM users WHERE tenant_id='staff-a' AND id='staff-enroll'")
      .first<{mfa_enabled:number;session_version:number}>();assert.deepEqual(current,{mfa_enabled:1,session_version:3});
  }finally{await f.mf.dispose();}
});

test('MFA state changed after reservation blocks enrollment mutation and token issuance',async()=>{
  const f=await fixture();try{
    const enrollment=await f.token({tenantId:'staff-a',actorId:'staff-enroll',role:'agent',audience:'mfa-challenge',mfaVerified:false});
    await control(f,{beforeFence:'mfa',reset:true});const response=await request(f,'/mfa/setup',enrollment);
    assert.equal(response.status,503,await response.clone().text());
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM budget_grant_operations WHERE tenant_id='staff-a'").first<{count:number}>())?.count,0);
  }finally{await f.mf.dispose();}
});
