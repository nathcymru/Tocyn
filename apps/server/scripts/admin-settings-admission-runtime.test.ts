import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { SignJWT } from 'jose';
import { splitSql } from './split-sql';

const root = resolve(import.meta.dirname, '..');
const now = Date.now();
const tenant = 'runtime-tenant';
const otherTenant = 'runtime-other';
const secret = 'admin-settings-runtime-secret-at-least-32-characters';

async function apply(db: Awaited<ReturnType<Miniflare['getD1Database']>>) {
  for (const file of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(root, 'migrations', file), 'utf8')).map(sql => db.prepare(sql)));
  }
}
function policy() {
  const limits = { workerRequests: 100_000, d1RowsRead: 1_000_000, d1RowsWritten: 100_000, doRequests: 1_000,
    doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 };
  return { schemaVersion: 1, policyId: 'admin-settings-policy', revision: 1, deploymentId: 'admin-settings-deployment', mode: 'conservative', catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000,
    budgets: Object.entries(limits).map(([dimension, limit]) => ({ dimension, limit, allocationId: `admin-${dimension}`, recoveryPercent: 20,
      provenance: 'owner-allocation', window: { kind: 'interval', id: 'admin-window', startsAt: now - 60_000, endsAt: now + 3_600_000 } })) };
}
async function token(id: string, role: 'admin' | 'agent', version = 1, tenantId = tenant) {
  return new SignJWT({ sub: id, role, tenant_id: tenantId, session_version: version, mfa_verified: true })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('app').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

test('native D1/DO admission fences bounded settings, themes and delegated-policy mutations', async () => {
  const bundle = await build({ absWorkingDir: root, entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true,
    write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'admin-settings-admission', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundle.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true', ENVIRONMENT: 'local', JWT_SECRET: secret,
      APP_MASTER_KEY: 'admin-settings-runtime-master-key-at-least-32' }, d1Databases: { DB: 'admin-settings-d1' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
    unsafeEphemeralDurableObjects: true,
  }] }));
  try {
    const db = await mf.getD1Database('DB'); await apply(db);
    const owner = policy(); const limits = Object.fromEntries(owner.budgets.map(item => [item.dimension, item.limit]));
    const allocation = (tenantId: string) => JSON.stringify({ schemaVersion: 1, tenantId, ownerPolicyId: owner.policyId, ownerPolicyRevision: 1,
      revision: 1, mode: 'conservative', limits, disabledFeatures: [] });
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('admin-settings-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('admin-settings-deployment','admin-settings-policy',1,1,'admin-settings-coordinator',32,60000,?)`).bind(JSON.stringify(owner)),
      ...[tenant, otherTenant].flatMap(tenantId => [
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'admin',?,'admin',1,1)").bind(tenantId, `admin-${tenantId}@example.test`),
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'agent',?,'agent',1,1)").bind(tenantId, `agent-${tenantId}@example.test`),
        db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES ('admin-settings-deployment',?,'admin-settings-policy',1,1,?,?,'active')`).bind(tenantId, `admin-${tenantId}`, allocation(tenantId)),
        db.prepare("INSERT INTO tenant_role_capability_policies (tenant_id,role,capability,enabled,revision) VALUES (?,'agent','settings.general.manage',1,1)").bind(tenantId),
      ]),
    ]);
    let admin = await token('admin', 'admin'); const request = (path: string, method: string, bearer: string, body?: unknown, key?: string) => mf.dispatchFetch(`http://runtime.test${path}`, {
      method, headers: { authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const read = await request('/api/settings', 'GET', admin); assert.equal(read.status, 200, await read.text());
    const first = await request('/api/settings', 'PUT', admin, { APP_NAME: 'Bounded tenant' }, 'settings-retry');
    assert.equal(first.status, 200); assert.deepEqual(await first.json(), { success: true });
    const replay = await request('/api/settings', 'PUT', admin, { APP_NAME: 'Bounded tenant' }, 'settings-retry');
    assert.equal(replay.status, 200); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true'); await replay.body?.cancel();
    assert.equal((await db.prepare("SELECT value FROM tenant_config WHERE tenant_id=? AND key='APP_NAME'").bind(tenant).first<{ value: string }>())?.value, 'Bounded tenant');
    assert.equal((await db.prepare("SELECT count(*) AS n FROM admin_settings_mutation_receipts WHERE tenant_id=? AND operation='dashboard.settings.update'").bind(tenant).first<{ n: number }>())?.n, 1);
    const collision = await request('/api/settings', 'PUT', admin, { APP_NAME: 'Different' }, 'settings-retry'); assert.equal(collision.status, 409); await collision.body?.cancel();

    const theme = { version: '1', light: { colorSurface: '#ffffff', colorText: '#111111' }, dark: {} };
    const themed = await request('/api/settings/theme', 'PUT', admin, theme, 'theme-retry'); assert.equal(themed.status, 200); await themed.body?.cancel();
    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<500)
      INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled)
      SELECT ?,printf('extra-agent-%d',x),printf('extra-agent-%d@example.invalid',x),'agent',1,1 FROM n`).bind(tenant).run();
    assert.equal((await db.prepare('SELECT agent_rows FROM admin_agent_population WHERE tenant_id=?').bind(tenant).first<{agent_rows:number}>())?.agent_rows,501);
    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<150)
      INSERT INTO admin_settings_mutation_receipts(tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot,created_at,expires_at)
      SELECT tenant_id,principal_id,operation,printf('%064x',1000+x),payload_hash,response_status,response_snapshot,unixepoch()-100,unixepoch()-1
      FROM admin_settings_mutation_receipts,n WHERE tenant_id=? AND operation='dashboard.settings.update'`).bind(tenant).run();
    const policyWrite = await request('/api/permissions', 'PUT', admin, { revision: 1, policies: { general: false } }, 'policy-retry');
    assert.equal(policyWrite.status, 200); assert.deepEqual(await policyWrite.json(), { success: true, revision: 2, sessionsRevoked: true });
    assert.equal((await db.prepare("SELECT session_version FROM users WHERE tenant_id=? AND id='agent'").bind(tenant).first<{ session_version: number }>())?.session_version, 2);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM admin_settings_mutation_receipts WHERE tenant_id=? AND operation='dashboard.permissions.update'").bind(tenant).first<{ n: number }>())?.n, 1);

    assert.equal((await db.prepare("SELECT count(*) AS n FROM users WHERE tenant_id=? AND role='agent' AND session_version=2").bind(tenant).first<{n:number}>())?.n,501);
    const policyBudget=await db.prepare(`SELECT operation_envelope_json FROM budget_grant_operations WHERE tenant_id=? AND operation_id=(
      SELECT key_hash FROM admin_settings_mutation_receipts WHERE tenant_id=? AND operation='dashboard.permissions.update' LIMIT 1)`).bind(tenant,tenant).first<{operation_envelope_json:string}>();
    assert.ok(policyBudget && JSON.parse(policyBudget.operation_envelope_json).d1RowsWritten>=501+1_024,'All-agent session revocation must fit an explicitly admitted dynamic envelope');
    const costState=await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {canonicalBatches:{rowsRead:number;rowsWritten:number}[]};
    const measured=costState.canonicalBatches.at(-1)!;
    assert.ok(measured.rowsWritten>=501);assert.ok(measured.rowsWritten<=JSON.parse(policyBudget!.operation_envelope_json).d1RowsWritten);
    console.log(JSON.stringify({fixture:'admin-501-agent-revocation-with-expired-receipts',...measured,reserved:JSON.parse(policyBudget!.operation_envelope_json).d1RowsWritten}));
    const stale = await request('/api/permissions','PUT',admin,{revision:1,policies:{general:true}},'policy-stale');
    assert.equal(stale.status,409,'A stale policy revision must never return an immutable success receipt'); await stale.body?.cancel();
    const staleReplay = await request('/api/permissions','PUT',admin,{revision:1,policies:{general:true}},'policy-stale');
    assert.equal(staleReplay.status,409); await staleReplay.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS n FROM admin_settings_mutation_receipts WHERE tenant_id=? AND operation='dashboard.permissions.update'").bind(tenant).first<{n:number}>())?.n,1);
    const operatorTheme = await request('/api/settings/theme','GET',await token('agent','agent',2));
    assert.equal(operatorTheme.status,200,'Shared theme remains readable by operators without settings-edit permission'); await operatorTheme.body?.cancel();

    await (await mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pauseNextCanonical:true})})).body?.cancel();
    const growingWrite=request('/api/permissions','PUT',admin,{revision:2,policies:{general:true}},'population-growth');
    let growthPaused=false;
    for(let index=0;index<200;index++) {
      const state=await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {canonicalPaused:boolean};
      if(state.canonicalPaused){growthPaused=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(growthPaused,'Population proof must pause after reservation before mutation');
    await db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'concurrent-agent','concurrent@example.invalid','agent',1,1)").bind(tenant).run();
    await (await mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({releaseCanonical:true})})).body?.cancel();
    const grown=await growingWrite;assert.equal(grown.status,503);await grown.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS n FROM admin_settings_mutation_receipts WHERE tenant_id=? AND operation='dashboard.permissions.update'").bind(tenant).first<{n:number}>())?.n,1);
    assert.equal((await db.prepare("SELECT session_version FROM users WHERE tenant_id=? AND id='agent'").bind(tenant).first<{session_version:number}>())?.session_version,2);

    await (await mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pauseNextCanonical:true})})).body?.cancel();
    const pausedRead=request('/api/settings','GET',admin);
    let paused=false;
    for(let index=0;index<200;index++) {
      const state=await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as {canonicalPaused:boolean};
      if(state.canonicalPaused){paused=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(paused,'Read proof must pause after admission before its D1 transaction');
    await db.prepare("UPDATE users SET session_version=2 WHERE tenant_id=? AND id='admin'").bind(tenant).run();
    await (await mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({releaseCanonical:true})})).body?.cancel();
    const revokedRead=await pausedRead;assert.equal(revokedRead.status,503);assert.doesNotMatch(await revokedRead.text(),/Bounded tenant/);
    admin=await token('admin','admin',2);

    await (await mf.dispatchFetch('http://runtime.test/__budget-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({beforeCanonical:'closedLinkedGrant'})})).body?.cancel();
    const closedAttempt=await request('/api/settings','PUT',admin,{COMPANY_NAME:'Closed grant must not commit'},'closed-grant');
    assert.equal(closedAttempt.status,503);await closedAttempt.body?.cancel();
    assert.ok((await db.prepare('SELECT count(*) AS n FROM budget_grant_closures WHERE tenant_id=?').bind(tenant).first<{n:number}>())!.n>0);
    assert.equal(await db.prepare("SELECT value FROM tenant_config WHERE tenant_id=? AND key='COMPANY_NAME'").bind(tenant).first(),null);

    const control = await mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ beforeCanonical: 'authority' }) }); await control.body?.cancel();
    const raced = await request('/api/settings', 'PUT', admin, { COMPANY_NAME: 'Must roll back' }, 'reset-race');
    assert.equal(raced.status, 503); await raced.body?.cancel();
    assert.equal(await db.prepare("SELECT 1 AS present FROM tenant_config WHERE tenant_id=? AND key='COMPANY_NAME'").bind(tenant).first(), null);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM tenant_config WHERE tenant_id=?").bind(otherTenant).first<{ n: number }>())?.n, 0);
  } finally { await mf.dispose(); }
});
