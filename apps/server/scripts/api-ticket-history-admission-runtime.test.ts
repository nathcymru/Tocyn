import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { API_TICKET_HISTORY_ENVELOPE } from '../src/budgets/api-ticket-history-admission.service';

const root = resolve(import.meta.dirname, '..');
const now = Date.now();
const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'doRequests', 'doRowsRead', 'doRowsWritten', 'logEvents'] as const;

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fixture(limit = 1_000_000, admissionPolicy: string | undefined = 'api-ticket-mutations-v1') {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-admission-runtime-entry.ts')], bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'api-history-admission-proof', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
    bindings: { ...(admissionPolicy === undefined ? {} : { BUDGET_ADMISSION_POLICY: admissionPolicy }), DISABLE_RATE_LIMIT: 'true', JWT_SECRET: 'synthetic-api-history-secret-at-least-32-chars' },
    d1Databases: { DB: 'api-history-admission-d1' }, r2Buckets: { ATTACHMENTS_BUCKET: 'api-history-admission-r2' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
    unsafeEphemeralDurableObjects: true,
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
    }
    const limits = Object.fromEntries(dimensions.map(dimension => [dimension, limit]));
    const owner = { schemaVersion: 1, policyId: 'api-history-policy', revision: 1, deploymentId: 'api-history-deployment',
      mode: 'conservative', catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000,
      budgets: dimensions.map(dimension => ({ dimension, limit: limits[dimension], allocationId: `history-${dimension}`,
        recoveryPercent: 20, provenance: 'owner-allocation', window: { kind: 'interval', id: 'history-window', startsAt: now - 1, endsAt: now + 60_000 } })) };
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('api-history-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('api-history-deployment','api-history-policy',1,1,'api-history-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
    ]);
    const keys: Record<string, { value: string; id: string }> = {};
    for (const tenantId of ['history-a', 'history-b', 'history-low']) {
      const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: owner.policyId, ownerPolicyRevision: 1, revision: 1,
        mode: 'conservative', limits, disabledFeatures: [] };
      const value = `lt_${tenantId.replace('-', '')}.synthetic-history-key-123456789012`;
      const id = 'shared-api-key'; keys[tenantId] = { value, id };
      await db.batch([
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'shared-customer',?,'customer',1,0)").bind(tenantId, `${tenantId}@example.test`),
        db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES (?,'shared-ticket','Synthetic history',?,'api')").bind(tenantId, `${tenantId}@example.test`),
        db.prepare("INSERT INTO api_keys (tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at) VALUES (?,?,'Synthetic history key',?,'lt_synth','tickets:read',1,?)")
          .bind(tenantId, id, await sha256(value), new Date(now).toISOString()),
        db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES ('api-history-deployment',?,'api-history-policy',1,1,?,?,'active')`).bind(tenantId, `history-${tenantId}`, JSON.stringify(restriction)),
      ]);
      const events = Array.from({ length: 51 }, (_, index) => {
        const articleId = `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`;
        return [db.prepare(`INSERT INTO articles
          (tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal,intake_source)
          VALUES (?,?,'shared-ticket','shared-customer','customer','Synthetic public reply',0,'api')`).bind(tenantId, articleId),
        db.prepare(`INSERT INTO conversation_events
        (tenant_id,id,ticket_id,article_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
        VALUES (?,?,'shared-ticket',?,?,'message.reply','api-key','shared-api-key','api-key','api','public','{}')`)
        .bind(tenantId, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, articleId, index + 1)];
      });
      await db.batch(events.flat());
    }
    return { mf, db, keys };
  } catch (error) { await mf.dispose(); throw error; }
}

function history(mf: Miniflare, key: string, path = '/api/v1/tickets/shared-ticket/history?limit=50') {
  return mf.dispatchFetch(`http://runtime.test${path}`, { headers: { 'X-API-Key': key } });
}

test('API history admits bounded public pages with a fresh execution id and a warm grant', async () => {
  const f = await fixture();
  try {
    const first = await history(f.mf, f.keys['history-a'].value);
    assert.equal(first.status, 200, await first.clone().text()); const firstPage = await first.json() as { events: unknown[]; nextCursor: string | null };
    assert.equal(firstPage.events.length, 50); assert.ok(firstPage.nextCursor);
    const cold = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { calls: { refresh: number; reserve: number }; historyEventQueries: number; historyEventRowsRead: number };
    assert.equal(cold.calls.refresh, 1); assert.equal(cold.calls.reserve, 1, 'cold authority refresh and reservation are paid once');
    // The 51 returned events can each issue one tenant-qualified article
    // visibility probe, so the native full page is bounded at 102 D1 rows.
    assert.equal(cold.historyEventQueries, 1); assert.ok(cold.historyEventRowsRead <= 102, String(cold.historyEventRowsRead));
    assert.ok((API_TICKET_HISTORY_ENVELOPE.d1RowsRead ?? 0) >= cold.historyEventRowsRead,
      'the measured event work fits the conservative admission envelope');
    const plan = await f.db.prepare(`EXPLAIN QUERY PLAN SELECT e.* FROM conversation_events e
      WHERE e.tenant_id=? AND e.ticket_id=? AND e.sequence>? AND e.visibility='public'
        AND e.kind IN ('ticket.intake','message.reply')
      ORDER BY e.sequence LIMIT ?`).bind('history-a', 'shared-ticket', 0, 51).all<{ detail: string }>();
    assert.ok(plan.results.some(row => /SEARCH e USING INDEX .*tenant_id=\? AND ticket_id=\? AND sequence>\?/.test(row.detail)),
      'the full-page event scan uses the tenant/ticket/sequence index rather than an unbounded sort');
    const retry = await history(f.mf, f.keys['history-a'].value, `/api/v1/tickets/shared-ticket/history?limit=1&cursor=${firstPage.nextCursor}`);
    assert.equal(retry.status, 200); await retry.body?.cancel();
    const warm = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { calls: { refresh: number; reserve: number }; cache: { operations: number } };
    assert.deepEqual(warm.calls, cold.calls, 'a second HTTP execution spends the warm preallocated grant without another coordinator RPC');
    assert.equal(warm.cache.operations, 2, 'read retries are separate charged executions rather than replayed responses');
  } finally { await f.mf.dispose(); }
});

test('API history tenant, current-key, malformed-page and exhaustion denials precede event reads', async () => {
  const f = await fixture(1);
  try {
    const foreign = await history(f.mf, f.keys['history-a'].value, '/api/v1/tickets/missing/history');
    assert.equal(foreign.status, 404); await foreign.body?.cancel();
    const malformed = await history(f.mf, f.keys['history-a'].value, '/api/v1/tickets/shared-ticket/history?limit=51');
    assert.equal(malformed.status, 400); await malformed.body?.cancel();
    const exhausted = await history(f.mf, f.keys['history-low'].value);
    assert.equal(exhausted.status, 429); await exhausted.body?.cancel();
    await f.mf.dispatchFetch('http://runtime.test/__budget-control', { method: 'POST', body: JSON.stringify({
      revokeApiKeyAfterAuth: { tenantId: 'history-b', apiKeyId: 'shared-api-key' },
    }) });
    const revokedAfterAuthentication = await history(f.mf, f.keys['history-b'].value);
    assert.equal(revokedAfterAuthentication.status, 503, 'the admission gate rechecks a key revoked after initial authentication'); await revokedAfterAuthentication.body?.cancel();
    const control = await (await f.mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { historyEventQueries: number };
    assert.equal(control.historyEventQueries, 0, 'every rejected request stops before the conversation event query');
  } finally { await f.mf.dispose(); }
});

test('API history preserves the pre-admission route when the optional policy binding is absent', async () => {
  const f = await fixture(1_000_000, undefined);
  try {
    const response = await history(f.mf, f.keys['history-a'].value, '/api/v1/tickets/shared-ticket/history?limit=1');
    assert.equal(response.status, 200); const page = await response.json() as { events: unknown[] };
    assert.equal(page.events.length, 1);
  } finally { await f.mf.dispose(); }
});
