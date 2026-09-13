import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';

const root = resolve(import.meta.dirname, '..');
const now = Date.now();
const secret = 'synthetic-ticket-read-admission-secret-at-least-32-chars';
const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents'] as const;

async function staffToken() { return new SignJWT({ sub: 'reader-agent', role: 'agent', tenant_id: 'read-tenant', session_version: 1, mfa_verified: true })
  .setProtectedHeader({ alg: 'HS256' }).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)); }

async function fixture(limit = 2_000_000, grantLifetime = 60_000) {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'http-ticket-read-proof', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true', JWT_SECRET: secret },
    d1Databases: { DB: 'http-ticket-read-d1' }, r2Buckets: { ATTACHMENTS_BUCKET: 'http-ticket-read-r2' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
    unsafeEphemeralDurableObjects: true,
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
    }
    const limits = Object.fromEntries(dimensions.map(dimension => [dimension, limit]));
    const owner = { schemaVersion: 1, policyId: 'read-policy', revision: 1, deploymentId: 'read-deployment', mode: 'conservative',
      catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: grantLifetime,
      budgets: dimensions.map(dimension => ({ dimension, limit: limits[dimension], allocationId: `read-${dimension}`, recoveryPercent: 20,
        provenance: 'owner-allocation', window: { kind: 'interval', id: 'read-window', startsAt: now - 1_000, endsAt: now + 60_000 } })) };
    const restriction = { schemaVersion: 1, tenantId: 'read-tenant', ownerPolicyId: owner.policyId, ownerPolicyRevision: 1, revision: 1,
      mode: 'conservative', limits, disabledFeatures: [] };
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('read-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('read-deployment','read-policy',1,1,'read-coordinator',64,?,?)`).bind(Math.min(30_000,grantLifetime),JSON.stringify(owner)),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('read-tenant','reader-agent','agent@example.test','agent',1,1)"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('read-tenant','reader-customer','reader@example.test','customer',1,0)"),
      db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('read-tenant','reader-group','Reader group')"),
      db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('read-tenant','reader-agent','reader-group')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_id,customer_email,group_id,source) VALUES ('read-tenant','read-ticket','Read proof','reader-customer','reader@example.test','reader-group','dashboard')"),
      db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES ('read-deployment','read-tenant','read-policy',1,1,'read-tenant',?,'active')`).bind(JSON.stringify(restriction)),
      db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal,intake_source) VALUES ('read-tenant','public-article','read-ticket','customer','Public reply',0,'dashboard')"),
      db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal,intake_source) VALUES ('read-tenant','internal-article','read-ticket','agent','Internal note',1,'dashboard')"),
      db.prepare(`INSERT INTO conversation_events (tenant_id,id,ticket_id,article_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
        VALUES ('read-tenant','10000000-0000-4000-8000-000000000001','read-ticket','public-article',1,'message.reply','customer','reader-customer','authenticated-customer','dashboard','public','{}')`),
      db.prepare(`INSERT INTO conversation_events (tenant_id,id,ticket_id,article_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
        VALUES ('read-tenant','10000000-0000-4000-8000-000000000002','read-ticket','internal-article',2,'message.reply','staff','reader-agent','mfa-staff','dashboard','internal','{"private":true}')`),
    ]);
    return { mf, db };
  } catch (error) { await mf.dispose(); throw error; }
}

function request(mf: Miniflare, path: string, token: string) {
  return mf.dispatchFetch(`http://runtime.test${path}`, { headers: { authorization: `Bearer ${token}` } });
}

async function seedActivity(f:Awaited<ReturnType<typeof fixture>>,count=1){
  await f.db.batch(Array.from({length:count},(_,index)=>f.db.prepare(`INSERT INTO operator_activities
    (tenant_id,id,ticket_id,recipient_user_id,kind,source_id,producer_kind,receipt_fingerprint,facts)
    VALUES ('read-tenant',?,'read-ticket','reader-agent','assignment',?,'system',?,'{}')`)
    .bind('activity-'+index,'source-'+index,'a'.repeat(64))));
}
test('activity summaries retain full stored titles and sustain64 admitted combined reads',async()=>{
  const f=await fixture();try{
    await seedActivity(f);const title='😀'.repeat(600);await f.db.prepare("UPDATE tickets SET subject=? WHERE tenant_id='read-tenant'").bind(title).run();
    const token=await staffToken();let warm:unknown;
    for(let index=0;index<64;index++){
      const response=await request(f.mf,'/api/activities',token);assert.equal(response.status,200,`activity${index+1}: ${await response.clone().text()}`);
      const body=await response.json() as {page:{items:{ticketSubject:string}[]};unread:{count:number}};
      assert.equal(body.page.items[0].ticketSubject,'😀'.repeat(512)+'…');assert.equal(body.unread.count,1);
      if(index===0||index===7){const control=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {calls:unknown};
        if(index===0)warm=control.calls;else assert.deepEqual(control.calls,warm);}
    }
    assert.equal((await f.db.prepare("SELECT subject FROM tickets WHERE tenant_id='read-tenant'").first<{subject:string}>())?.subject,title);
    const control=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {calls:{reserve:number;reconcile:number};cache:{holders:number;operations:number}};
    assert.equal(control.calls.reserve,15);assert.equal(control.calls.reconcile,7);assert.equal(control.cache.holders,1);assert.equal(control.cache.operations,8);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n,64);
    const envelope=await f.db.prepare('SELECT operation_envelope_json FROM budget_grant_operations LIMIT 1').first<{operation_envelope_json:string}>();
    assert.equal(JSON.parse(envelope!.operation_envelope_json).d1RowsWritten,16);
    const transition=async(action:string,revision:number)=>f.mf.dispatchFetch('http://runtime.test/api/activities/activity-0/'+action,{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({expectedRevision:revision})});
    assert.equal((await transition('read',1)).status,200);assert.equal((await transition('read',1)).status,404);assert.equal((await transition('dismiss',2)).status,200);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n,67);
  }finally{await f.mf.dispose();}
});
for(const transition of [false,true])test(`activity ${transition?'transition':'combined read'} policy race rolls back ledger and mutation`,async()=>{
  const f=await fixture();try{
    await seedActivity(f);await f.mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',body:JSON.stringify({beforeCanonical:'authority'})});
    const token=await staffToken();const response=transition?await f.mf.dispatchFetch('http://runtime.test/api/activities/activity-0/read',{
      method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({expectedRevision:1})}):await request(f.mf,'/api/activities',token);
    assert.equal(response.status,503,await response.clone().text());
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n,0);
    assert.equal((await f.db.prepare('SELECT revision FROM operator_activities').first<{revision:number}>())?.revision,1);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{n:number}>())?.n,0);
  }finally{await f.mf.dispose();}
});
test('101 unread candidates preserve unavailable count and bounded encrypted paging',async()=>{
  const f=await fixture();try{
    await seedActivity(f,101);const response=await request(f.mf,'/api/activities',await staffToken());assert.equal(response.status,200);
    const body=await response.json() as {page:{items:unknown[];next:string};unread:{status:string;count:null}};
    assert.equal(body.page.items.length,20);assert.ok(body.page.next);assert.equal(body.unread.status,'unavailable');assert.equal(body.unread.count,null);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n,1);
  }finally{await f.mf.dispose();}
});
for(const change of ['session_version=2','mfa_enabled=0'] as const)test(`activity completion denies ${change} before the atomic activity batch`,async()=>{
  const f=await fixture();try{
    await seedActivity(f);await f.mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',body:JSON.stringify({pauseNextCanonical:true})});
    const pending=request(f.mf,'/api/activities',await staffToken());
    let paused=false;
    for(let attempt=0;attempt<100;attempt++){
      const control=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {canonicalPaused:boolean};
      if(control.canonicalPaused){paused=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(paused,true);await f.db.prepare(`UPDATE users SET ${change} WHERE tenant_id='read-tenant' AND id='reader-agent'`).run();
    await f.mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',body:JSON.stringify({releaseCanonical:true})});
    assert.equal((await pending).status,503);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n,0);
  }finally{await f.mf.dispose();}
});

for(const membershipRemoved of [false,true])test(`group access change before atomic batch denies hidden projections (membership removal=${membershipRemoved})`,async()=>{
  const f=await fixture();try{
    await seedActivity(f);await f.mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',body:JSON.stringify({pauseNextCanonical:true})});
    const pending=request(f.mf,'/api/activities',await staffToken());
    let paused=false;
    for(let attempt=0;attempt<100;attempt++){
      const control=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {canonicalPaused:boolean};
      if(control.canonicalPaused){paused=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(paused,true);
    if(membershipRemoved)await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='read-tenant' AND user_id='reader-agent'").run();
    else await f.db.batch([
      f.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('read-tenant','hidden-group','Hidden group')"),
      f.db.prepare("UPDATE tickets SET group_id='hidden-group' WHERE tenant_id='read-tenant' AND id='read-ticket'"),
    ]);
    await f.mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',body:JSON.stringify({releaseCanonical:true})});
    const response=await pending;assert.equal(response.status,membershipRemoved?503:200);
    if(!membershipRemoved){
      const body=await response.json() as {page:{items:unknown[]};unread:{count:number}};
      assert.deepEqual(body.page.items,[]);assert.equal(body.unread.count,0);
    }
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n,membershipRemoved?0:1);
  }finally{await f.mf.dispose();}
});
