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
async function customerToken() { return new SignJWT({ sub: 'reader-customer', role: 'customer', tenant_id: 'read-tenant', session_version: 1, email: 'reader@example.test' })
  .setProtectedHeader({ alg: 'HS256' }).setAudience('widget').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)); }

async function fixture(limit = 1_000_000, grantLifetime = 60_000) {
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

// Small synthetic fixture: exercise repeated real HTTP list completions without
// the separate 10,000-ticket query-plan fixture or provider activation.
for(const customer of [false,true])test(`sustained ${customer?'customer':'staff'} list reads reconcile full grants beyond32`,async()=>{
  const f=await fixture();try{
    const token=await(customer?customerToken():staffToken());
    const path=customer?'/api/v1/customer/tickets':'/api/tickets';
    let warmCalls:unknown;
    for(let index=0;index<64;index++){
      const response=await request(f.mf,path,token);
      assert.equal(response.status,200,`list${index+1}: ${await response.clone().text()}`);
      const body=await response.json() as {data:{id:string}[]};assert.deepEqual(body.data.map(item=>item.id),['read-ticket']);
      if(index===0||index===7){
        const diagnostic=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {calls:unknown};
        if(index===0)warmCalls=diagnostic.calls;else assert.deepEqual(diagnostic.calls,warmCalls,'seven warm reads issue no extra DO RPC');
      }
    }
    const diagnostic=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {
      calls:{reserve:number;reconcile:number};cache:{scopes:number;holders:number;operations:number;refills:number}};
    assert.equal(diagnostic.calls.reserve,12);assert.equal(diagnostic.calls.reconcile,4);
    assert.deepEqual(diagnostic.cache,{scopes:1,holders:4,operations:32,refills:4});
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n,64);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{n:number}>())?.n,4);
  }finally{await f.mf.dispose();}
});
