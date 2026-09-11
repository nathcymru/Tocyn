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

async function fixture(limit = 1_000_000) {
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
      catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000,
      budgets: dimensions.map(dimension => ({ dimension, limit: limits[dimension], allocationId: `read-${dimension}`, recoveryPercent: 20,
        provenance: 'owner-allocation', window: { kind: 'interval', id: 'read-window', startsAt: now - 1_000, endsAt: now + 60_000 } })) };
    const restriction = { schemaVersion: 1, tenantId: 'read-tenant', ownerPolicyId: owner.policyId, ownerPolicyRevision: 1, revision: 1,
      mode: 'conservative', limits, disabledFeatures: [] };
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('read-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('read-deployment','read-policy',1,1,'read-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
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
