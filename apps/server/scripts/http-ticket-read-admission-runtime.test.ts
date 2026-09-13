import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { HTTP_TICKET_READ_ENVELOPE } from '../src/budgets/http-ticket-read-admission.service';

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

test('dashboard and portal reads are separately prepaid and retain their private/public response boundaries', async () => {
  const f = await fixture();
  try {
    const [staff, customer] = await Promise.all([staffToken(), customerToken()]);
    const dashboard = await request(f.mf, '/api/tickets/read-ticket', staff);
    assert.equal(dashboard.status, 200, await dashboard.clone().text());
    assert.equal((await dashboard.json() as { articles: { id: string }[] }).articles.length, 2, 'staff detail retains private notes');
    const portal = await request(f.mf, '/api/v1/customer/tickets/read-ticket', customer);
    assert.equal(portal.status, 200, await portal.clone().text());
    assert.deepEqual((await portal.json() as { articles: { id: string }[] }).articles.map(article => article.id), ['public-article']);
    const [staffHistory, customerHistory] = await Promise.all([
      request(f.mf, '/api/tickets/read-ticket/history', staff), request(f.mf, '/api/v1/customer/tickets/read-ticket/history', customer),
    ]);
    assert.equal(staffHistory.status, 200); assert.equal((await staffHistory.json() as { events: unknown[] }).events.length, 2);
    const publicHistory = await customerHistory.json() as { events: { sequence?: number; facts: Record<string, unknown> }[] };
    assert.equal(publicHistory.events.length, 1); assert.equal(publicHistory.events[0].sequence, undefined); assert.deepEqual(publicHistory.events[0].facts, {});
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { calls: { refresh: number; reserve: number }; detailArticleRowsRead: number; historyRowsRead: number; cache: { operations: number } };
    assert.deepEqual(control.calls, { refresh: 4, reserve: 4, revoke: 0, reconcile: 0 });
    assert.equal(control.cache.operations, 4, 'each HTTP execution consumes its own admitted operation');
    const links=await f.db.prepare('SELECT operation_fingerprint,operation_envelope_json FROM budget_grant_operations').all<{operation_fingerprint:string;operation_envelope_json:string}>();
    assert.equal(links.results.length,4,'all four successful read paths retain durable completion links');
    assert.ok(links.results.every((row:{operation_fingerprint:string;operation_envelope_json:string})=>/^[a-f0-9]{64}$/.test(row.operation_fingerprint)&&!/Public reply|Internal note|reader@example/.test(row.operation_envelope_json)));
    const native=await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {canonicalBatches:{rowsRead:number;rowsWritten:number}[]};
    assert.equal(native.canonicalBatches.length,4);
    assert.ok(native.canonicalBatches.every(batch=>batch.rowsRead<=512&&batch.rowsWritten<=16),'native receipt/fence work fits added allowance');

    assert.ok(control.detailArticleRowsRead + control.historyRowsRead <= (HTTP_TICKET_READ_ENVELOPE.d1RowsRead ?? 0));
  } finally { await f.mf.dispose(); }
});

test('current group, owner and exhausted authority reject before detail/history business reads', async () => {
  const f = await fixture(1);
  try {
    const [staff, customer] = await Promise.all([staffToken(), customerToken()]);
    const exhausted = await request(f.mf, '/api/tickets/read-ticket', staff);
    assert.equal(exhausted.status, 429); await exhausted.body?.cancel();
    await f.db.batch([
      f.db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('read-tenant','moved-group','Moved')"),
      f.db.prepare("UPDATE tickets SET group_id='moved-group' WHERE tenant_id='read-tenant' AND id='read-ticket'"),
    ]);
    const groupDenied = await request(f.mf, '/api/tickets/read-ticket/history', staff);
    assert.equal(groupDenied.status, 503); await groupDenied.body?.cancel();
    await f.db.prepare("UPDATE tickets SET customer_id=NULL,customer_email='other@example.test' WHERE tenant_id='read-tenant' AND id='read-ticket'").run();
    const ownerDenied = await request(f.mf, '/api/v1/customer/tickets/read-ticket', customer);
    assert.equal(ownerDenied.status, 503); await ownerDenied.body?.cancel();
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { detailArticleMetadataQueries: number; historyEventQueries: number };
    assert.equal(control.detailArticleMetadataQueries, 0); assert.equal(control.historyEventQueries, 0);
  } finally { await f.mf.dispose(); }
});


test('portal detail bounds canonical references on long histories outside local-beta mode', async () => {
  const f = await fixture();
  try {
    for (let offset = 0; offset < 600; offset += 25) {
      await f.db.batch(Array.from({length:25}, (_, item) => {
        const index = offset + item;
        return f.db.prepare("INSERT INTO articles (tenant_id,id,ticket_id,sender_type,body,is_internal,created_at) VALUES ('read-tenant',?,'read-ticket','customer','Public',0,?)")
          .bind(`page-${index}`, new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString());
      }));
      await f.db.batch(Array.from({length:25}, (_, item) => {
        const index = offset + item;
        return f.db.prepare("INSERT INTO conversation_events (tenant_id,id,ticket_id,article_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts) VALUES ('read-tenant',?,'read-ticket',?,?,'message.reply','customer','reader-customer','authenticated-customer','dashboard','public','{}')")
          .bind(`20000000-0000-4000-8000-${String(index).padStart(12,'0')}`, `page-${index}`, index + 3);
      }));
    }
    const response = await request(f.mf, '/api/v1/customer/tickets/read-ticket', await customerToken());
    assert.equal(response.status,200,await response.clone().text());
    const body = await response.json() as {articles: unknown[]; pagination:{has_more:boolean}; canonical:{messages:unknown[]}};
    assert.equal(body.articles.length,50); assert.equal(body.canonical.messages.length,50); assert.equal(body.pagination.has_more,true);
    const measured = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {detailReferenceRowsRead:number};
    assert.ok(measured.detailReferenceRowsRead > 0, 'reference query was measured');
    assert.ok(measured.detailReferenceRowsRead <= 204, `reference lookup stays page-bound: ${measured.detailReferenceRowsRead}`);
  } finally { await f.mf.dispose(); }
});

async function control(mf:Miniflare,body?:Record<string,unknown>) {
 return mf.dispatchFetch('http://runtime.test/__budget-control',body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);
}
for(const scenario of [
 {name:'staff group revoked',path:'/api/tickets/read-ticket',staff:true,sql:"DELETE FROM user_groups WHERE tenant_id='read-tenant' AND user_id='reader-agent'"},
 {name:'staff session revoked',path:'/api/tickets/read-ticket/history',staff:true,sql:"UPDATE users SET session_version=2 WHERE tenant_id='read-tenant' AND id='reader-agent'"},
 {name:'customer owner changed',path:'/api/v1/customer/tickets/read-ticket',staff:false,sql:"UPDATE tickets SET customer_id=NULL,customer_email='other@example.test' WHERE tenant_id='read-tenant' AND id='read-ticket'"},
 {name:'customer policy revoked',path:'/api/v1/customer/tickets/read-ticket/history',staff:false,sql:"UPDATE budget_deployment_authority SET state='revoked'"},
])test(`completion withholds response and rolls back link when ${scenario.name} after business reads`,async()=>{
 const f=await fixture();try{
  await(await control(f.mf,{pauseNextCanonical:true})).body?.cancel();
  const pending=request(f.mf,scenario.path,await(scenario.staff?staffToken():customerToken()));
  let paused=false;
  for(let attempt=0;attempt<100;attempt++){
   const state=await(await control(f.mf)).json() as {canonicalPaused:boolean};if(state.canonicalPaused){paused=true;break}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(paused,true,'business read reached native completion batch');
  await f.db.prepare(scenario.sql).run();await(await control(f.mf,{releaseCanonical:true})).body?.cancel();
  const response=await pending;assert.ok(response.status>=500);await response.body?.cancel();
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())!.n,0);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{n:number}>())!.n,0);
 }finally{await f.mf.dispose()}
});
test('lost completion acknowledgement retains durable link but withholds response and does not certify closure',async()=>{
 const f=await fixture();try{
  await(await control(f.mf,{loseCanonicalAck:true})).body?.cancel();
  const response=await request(f.mf,'/api/tickets/read-ticket',await staffToken());assert.ok(response.status>=500);await response.body?.cancel();
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())!.n,1);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{n:number}>())!.n,0);
 }finally{await f.mf.dispose()}
});

for (const customer of [false, true]) test(`sustained ${customer ? 'customer' : 'staff'} detail reads reconcile full grants and exceed32 without growing local slots`, async () => {
  const f = await fixture();
  try {
    const token = await (customer ? customerToken() : staffToken());
    const path = customer ? '/api/v1/customer/tickets/read-ticket' : '/api/tickets/read-ticket';
    for (let index = 0; index < 64; index++) {
      const response = await request(f.mf, path, token);
      assert.equal(response.status, 200, `read${index + 1}: ${await response.text()}; control=${response.status===200?'':await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).text()}`);
    }
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {
      calls: { refresh: number; reserve: number; reconcile: number }; cache: { scopes: number; holders: number; operations: number; refills: number }
    };
    assert.equal(control.calls.reconcile, 7, 'one closure per exhausted8-operation block before each cold replacement');
    assert.equal(control.calls.reserve, 15, '8 work blocks plus7 separately charged recovery reservations');
    assert.deepEqual(control.cache, { scopes: 1, holders: 1, operations: 8, refills: 1 });
    const count = await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>();
    assert.equal(count?.n, 64, 'all successful responses have durable grant links');
  } finally { await f.mf.dispose(); }
});

test('spaced successful reads retire expired slots while retaining their full original liability', async () => {
  const f = await fixture(1_000_000, 1_000);
  try {
    const token = await staffToken();
    const startedAt = Date.now();
    for (let index = 0; index < 7; index++) {
      await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method:'POST', body:JSON.stringify({now:startedAt + index * 2_000}) });
      const response = await request(f.mf, '/api/tickets/read-ticket', token);
      assert.equal(response.status, 200, `spaced read${index + 1}: ${await response.text()}`);
    }
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {
      calls: { reconcile: number }; cache: { holders: number; refills: number }
    };
    assert.equal(control.calls.reconcile, 6);
    assert.equal(control.cache.holders, 1);
    assert.equal(control.cache.refills, 1);
  } finally { await f.mf.dispose(); }
});

test('concurrent refill requests share one certified closure and one new block', async () => {
  const f = await fixture();
  try {
    const token = await staffToken();
    for(let i=0;i<32;i++){const response=await request(f.mf,'/api/tickets/read-ticket',token);assert.equal(response.status,200);await response.body?.cancel();}
    const responses=await Promise.all(Array.from({length:8},()=>request(f.mf,'/api/tickets/read-ticket',token)));
    for(const response of responses)assert.equal(response.status,200,await response.text());
    const control=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {calls:{reconcile:number;reserve:number};cache:{operations:number;holders:number;refills:number}};
    assert.equal(control.calls.reconcile,4);assert.equal(control.calls.reserve,9);
    assert.equal(control.cache.operations,8);assert.equal(control.cache.holders,1);assert.equal(control.cache.refills,1);
  }finally{await f.mf.dispose();}
});

for(const lostAcks of [1,2])test(`lost reconciliation acknowledgement retains its slot until confirmed (${lostAcks} losses)`,async()=>{
  const f=await fixture();
  try{
    const token=await staffToken();
    for(let i=0;i<8;i++){const initial=await request(f.mf,'/api/tickets/read-ticket',token);assert.equal(initial.status,200);await initial.body?.cancel();}
    await f.mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',body:JSON.stringify({loseReconcileAcks:lostAcks})});
    const first=await request(f.mf,'/api/tickets/read-ticket',token);assert.equal(first.status,200,await first.text());
    const before=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {calls:{reconcile:number};cache:{holders:number;operations:number;refills:number}};
    assert.equal(before.calls.reconcile,1);assert.equal(before.cache.holders,2);assert.equal(before.cache.operations,9);assert.equal(before.cache.refills,2);
    // The unconfirmed closure did not return credit. A warm request uses the new
    // separately charged block without another recovery RPC.
    const warm=await request(f.mf,'/api/tickets/read-ticket',token);assert.equal(warm.status,200);await warm.body?.cancel();
    const warmState=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {calls:{reconcile:number}};
    assert.equal(warmState.calls.reconcile,1);
    for(let i=0;i<6;i++){const fill=await request(f.mf,'/api/tickets/read-ticket',token);assert.equal(fill.status,200);await fill.body?.cancel();}
    const retry=await request(f.mf,'/api/tickets/read-ticket',token);assert.equal(retry.status,200,await retry.text());
    const after=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {calls:{reconcile:number};cache:{holders:number;refills:number}};
    assert.equal(after.calls.reconcile,2);assert.equal(after.cache.holders,lostAcks===1?2:3);assert.equal(after.cache.refills,lostAcks===1?2:3);
  }finally{await f.mf.dispose();}
});

test('four grants with unknown read completions cannot reclaim slots from durable links alone',async()=>{
  const f=await fixture();
  try{
    const token=await staffToken();
    await f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_id,customer_email,group_id,source) VALUES ('read-tenant','second-ticket','Second proof','reader-customer','reader@example.test','reader-group','dashboard')").run();
    for(let i=0;i<32;i++){
      if(i%8===0)await f.mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',body:JSON.stringify({loseCanonicalAck:true})});
      const response=await request(f.mf,i%2===0?'/api/tickets/read-ticket':'/api/tickets/second-ticket',token);
      assert.equal(response.status,i%8===0?500:200,await response.text());
    }
    const response=await request(f.mf,'/api/tickets/read-ticket',token);assert.equal(response.status,429,await response.text());
    const control=await(await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {calls:{reconcile:number};cache:{holders:number;operations:number;refills:number}};
    assert.equal(control.calls.reconcile,0);assert.equal(control.cache.holders,4);assert.equal(control.cache.operations,32);assert.equal(control.cache.refills,4);
    const closures=await f.db.prepare('SELECT count(*) AS n FROM budget_grant_closures').first<{n:number}>();assert.equal(closures?.n,0);
  }finally{await f.mf.dispose();}
});


test('cold sparse authenticated scopes retire their own expired grants before the fourth refill', async () => {
  const f = await fixture(1_000_000, 1_000);
  try {
    const staff = await staffToken(), customer = await customerToken();
    const routes = [
      ['/api/tickets/read-ticket', staff], ['/api/tickets/read-ticket/history', staff],
      ['/api/v1/customer/tickets/read-ticket', customer], ['/api/v1/customer/tickets/read-ticket/history', customer],
    ];
    const startedAt = Date.now();
    for (let cycle = 0; cycle < 3; cycle++) {
      await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ now: startedAt + cycle * 2_000 }) });
      for (const [path, token] of routes) {
        const response = await request(f.mf, path, token);
        assert.equal(response.status, 200, await response.text());
      }
    }
    const state = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {
      calls: { reconcile: number }; cache: { scopes: number; holders: number; refills: number }
    };
    assert.equal(state.calls.reconcile, 8, 'each of four exact scopes retires its prior expired grant on each cold return');
    assert.equal(state.cache.scopes, 4);
    assert.equal(state.cache.holders, 4);
    assert.equal(state.cache.refills, 4);
  } finally { await f.mf.dispose(); }
});

for (const change of ['policy', 'credential'] as const) test(`cold recovery rechecks current ${change} after awaited reservation`, async () => {
  const f = await fixture(1_000_000, 1_000);
  try {
    const token = await staffToken();
    const first = await request(f.mf, '/api/tickets/read-ticket', token);
    assert.equal(first.status, 200); await first.body?.cancel();
    await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ now: Date.now() + 2_000, pauseNextReserve: true }) });
    const pending = request(f.mf, '/api/tickets/read-ticket', token);
    let paused = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { reservePaused: boolean };
      if (state.reservePaused) { paused = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(paused, true);
    await f.db.prepare(change === 'policy' ? "UPDATE budget_deployment_authority SET state='revoked'" : "UPDATE users SET session_version=2 WHERE tenant_id='read-tenant' AND id='reader-agent'").run();
    await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ releaseReserve: true }) });
    const response = await pending;
    assert.notEqual(response.status, 200, await response.text());
    const count = await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>();
    assert.equal(count?.n, 0, 'expired prior links were retired; revoked request creates no new completion receipt');
  } finally { await f.mf.dispose(); }
});


test('transient post-recovery D1 failure clears only the rejected pending allocation and permits retry', async () => {
  const f = await fixture(1_000_000, 1_000);
  try {
    const token = await staffToken();
    const first = await request(f.mf, '/api/tickets/read-ticket', token);
    assert.equal(first.status, 200); await first.body?.cancel();
    await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({ now: Date.now() + 2_000, failReadAfterRecovery: true }) });
    const failed = await request(f.mf, '/api/tickets/read-ticket', token);
    assert.equal(failed.status, 503); await failed.body?.cancel();
    const before = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {
      calls: { reserve: number; reconcile: number }; cache: { holders: number; refills: number }
    };
    assert.equal(before.calls.reserve, 2, 'one business and one separately charged recovery reservation');
    assert.equal(before.calls.reconcile, 1);
    assert.equal(before.cache.refills, 0, 'only confirmed recovery returned the original slot');
    const retry = await request(f.mf, '/api/tickets/read-ticket', token);
    assert.equal(retry.status, 200, await retry.text());
    const after = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {
      calls: { reserve: number; reconcile: number }; cache: { holders: number; refills: number }
    };
    assert.equal(after.calls.reserve, 3, 'retry allocates a newly charged business grant');
    assert.equal(after.calls.reconcile, 1, 'retry does not repeat the completed recovery');
    assert.equal(after.cache.holders, 1); assert.equal(after.cache.refills, 1);
  } finally { await f.mf.dispose(); }
});

test('twenty distinct authorized tickets share three read scopes without reusing target permission', async () => {
  const f = await fixture();
  try {
    const token = await staffToken();
    for (let index = 0; index < 20; index++) await f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_id,customer_email,group_id,source) VALUES ('read-tenant',?,'Distinct proof','reader-customer','reader@example.test','reader-group','dashboard')").bind(`distinct-${index}`).run();
    for (let index = 0; index < 20; index++) for (const path of [`/api/tickets/distinct-${index}`, `/api/tickets/distinct-${index}/history`, `/api/workspace/drafts/distinct-${index}`]) {
      const response = await request(f.mf, path, token);
      assert.equal(response.status, path.includes('/drafts/') ? 204 : 200, await response.text());
    }
    const state = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { calls: { reserve: number; reconcile: number }; cache: { scopes: number; holders: number } };
    assert.equal(state.cache.scopes, 3); assert.equal(state.cache.holders, 3);
    assert.equal(state.calls.reserve, 15); assert.equal(state.calls.reconcile, 6);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n, 60);
    await f.db.prepare("UPDATE tickets SET group_id=NULL WHERE tenant_id='read-tenant' AND id='distinct-19'").run();
    // Membership removal must affect the next read even though accounting is warm.
    await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='read-tenant' AND user_id='reader-agent'").run();
    const denied = await request(f.mf, '/api/tickets/distinct-0', token); assert.notEqual(denied.status, 200); await denied.body?.cancel();
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n, 60);
  } finally { await f.mf.dispose(); }
});


for (const operation of ['detail', 'history', 'draft']) test(`shared warm ${operation} block retains exact terminal target permission`, async () => {
  const f = await fixture();
  try {
    const token = await staffToken();
    await f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_id,customer_email,group_id,source) VALUES ('read-tenant','warm-ticket','Warm proof','reader-customer','reader@example.test','reader-group','dashboard')").run();
    const path = (id:string) => operation === 'draft' ? `/api/workspace/drafts/${id}` : `/api/tickets/${id}${operation === 'history' ? '/history' : ''}`;
    const warm = await request(f.mf, path('warm-ticket'), token); assert.equal(warm.status, operation === 'draft' ? 204 : 200); await warm.body?.cancel();
    await (await control(f.mf, { pauseNextCanonical: true })).body?.cancel();
    const pending = request(f.mf, path('read-ticket'), token);
    let paused = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await (await control(f.mf)).json() as { canonicalPaused: boolean };
      if (state.canonicalPaused) { paused = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(paused, true);
    await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='read-tenant' AND user_id='reader-agent'").run();
    await (await control(f.mf, { releaseCanonical: true })).body?.cancel();
    const denied = await pending; assert.ok(denied.status >= 400); await denied.body?.cancel();
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM budget_grant_operations').first<{n:number}>())?.n, 1, 'target revocation cannot mint another completion');
  } finally { await f.mf.dispose(); }
});
