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

async function apply(db: D1Database) {
  for (const file of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(root, 'migrations', file), 'utf8')).map(sql => db.prepare(sql)));
  }
}
function policy() {
  const limits = { workerRequests: 100, d1RowsRead: 1_000_000, d1RowsWritten: 100_000, doRequests: 1_000,
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
    const admin = await token('admin', 'admin'); const request = (path: string, method: string, bearer: string, body?: unknown, key?: string) => mf.dispatchFetch(`http://runtime.test${path}`, {
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
    const policyWrite = await request('/api/permissions', 'PUT', admin, { revision: 1, policies: { general: false } }, 'policy-retry');
    assert.equal(policyWrite.status, 200); assert.deepEqual(await policyWrite.json(), { success: true, revision: 2, sessionsRevoked: true });
    assert.equal((await db.prepare("SELECT session_version FROM users WHERE tenant_id=? AND id='agent'").bind(tenant).first<{ session_version: number }>())?.session_version, 2);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM admin_settings_mutation_receipts WHERE tenant_id=? AND operation='dashboard.permissions.update'").bind(tenant).first<{ n: number }>())?.n, 1);

    const control = await mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ beforeCanonical: 'authority' }) }); await control.body?.cancel();
    const raced = await request('/api/settings', 'PUT', admin, { COMPANY_NAME: 'Must roll back' }, 'reset-race');
    assert.equal(raced.status, 503); await raced.body?.cancel();
    assert.equal(await db.prepare("SELECT 1 AS present FROM tenant_config WHERE tenant_id=? AND key='COMPANY_NAME'").bind(tenant).first(), null);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM tenant_config WHERE tenant_id=?").bind(otherTenant).first<{ n: number }>())?.n, 0);
  } finally { await mf.dispose(); }
});
