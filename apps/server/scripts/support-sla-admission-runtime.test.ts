import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';

const root = resolve(import.meta.dirname, '..');
const secret = 'support-sla-admission-runtime-secret-at-least-32-chars';
const tenant = 'support-sla-runtime';
const unrelatedTenant = 'aaa-unrelated-support-sla-runtime';

async function applyMigrations(db: D1Database) {
  for (const name of readdirSync(join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(root, 'migrations', name), 'utf8')).map(sql => db.prepare(sql)));
  }
}

function policy(now: number) {
  const limits = { workerRequests: 10_000_000, d1RowsRead: 10_000_000, d1RowsWritten: 10_000_000,
    r2ClassBOperations: 10_000_000, doRequests: 10_000_000, doRowsRead: 10_000_000, doRowsWritten: 10_000_000, logEvents: 10_000_000 };
  return { schemaVersion: 1, policyId: 'support-sla-policy', revision: 1, deploymentId: 'support-sla-deployment',
    mode: 'conservative', catalogueVersion: 'synthetic', maxGrantLifetimeMs: 60_000,
    budgets: Object.entries(limits).map(([dimension, limit]) => ({ dimension, limit, allocationId: `support-sla-${dimension}`,
      recoveryPercent: 20, provenance: 'owner-allocation', window: { kind: 'interval', id: 'support-sla-window', startsAt: now - 1_000, endsAt: now + 60_000 } })) };
}

async function token(sub: string, role: 'admin' | 'agent', sessionVersion = 1) {
  return new SignJWT({ sub, role, tenant_id: tenant, session_version: sessionVersion, mfa_verified: true })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('app').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

async function seed(db: D1Database) {
  const now = Date.now(), owner = policy(now);
  const limits = Object.fromEntries(owner.budgets.map(item => [item.dimension, item.limit]));
  const restriction = JSON.stringify({ schemaVersion: 1, tenantId: tenant, ownerPolicyId: owner.policyId,
    ownerPolicyRevision: 1, revision: 1, mode: 'conservative', limits, disabledFeatures: [] });
  const unrelated = [unrelatedTenant, tenant].flatMap(scope => Array.from({ length: 512 }, (_, index) => [
    db.prepare(`INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source)
      VALUES (?,?,'Unrelated boundedness fixture','open',?,'dashboard')`)
      .bind(scope, `${scope}-unrelated-${index}`, `unrelated-${index}@example.test`),
    db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,sequence,kind,actor_kind,actor_provenance,source,visibility,facts)
      VALUES (?,?,?,1,'ticket.state_changed','staff','mfa-staff','dashboard','internal','{}')`)
      .bind(scope, `${scope}-unrelated-event-${index}`, `${scope}-unrelated-${index}`),
  ])).flat();
  await db.batch([
    ...unrelated,
    db.prepare("INSERT INTO budget_deployment_authority VALUES ('support-sla-deployment',1,'active',?)").bind(now),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('support-sla-deployment','support-sla-policy',1,1,'support-sla-coordinator',32,60000,?)`).bind(JSON.stringify(owner)),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('support-sla-deployment',?,'support-sla-policy',1,1,'support-sla-namespace',?,'active')`).bind(tenant, restriction),
    db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'admin','admin@example.test','admin',1,1)").bind(tenant),
    db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'agent','agent@example.test','agent',1,1)").bind(tenant),
    db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES (?,'group','Runtime group')").bind(tenant),
    db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,'agent','group')").bind(tenant),
    db.prepare("INSERT INTO tenant_role_capability_policies (tenant_id,role,capability,enabled,revision) VALUES (?,'agent','settings.general.manage',1,1)").bind(tenant),
    db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,customer_email,group_id,source) VALUES (?,'ticket','Ticket','open','customer@example.test','group','dashboard')").bind(tenant),
    db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source) VALUES (?,'legacy','Legacy','open','legacy@example.test','dashboard')").bind(tenant),
  ]);
}

const state = (id: string, label = id) => ({ id, legacyStatus: 'pending', internalLabel: `${label} internal`, publicLabel: `${label} public`, waitingReasonRequired: true });

test('real combined admission protects all bounded support-state/SLA writes with current session, capability, group, replay and CAS fences', async () => {
  const bundle = await build({ absWorkingDir: root, entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true,
    write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'support-sla-admission-runtime', modules: true,
    compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundle.outputFiles[0].text,
    bindings: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true', ENVIRONMENT: 'local', JWT_SECRET: secret },
    d1Databases: { DB: 'support-sla-admission-runtime-d1' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO', NOTIFICATION_DO: 'NotificationDO' },
    unsafeEphemeralDurableObjects: true,
  }] }));
  try {
    const db = await mf.getD1Database('DB'); await applyMigrations(db); await seed(db);
    const admin = await token('admin', 'admin'); let agent = await token('agent', 'agent');
    const request = (path: string, method: string, bearer: string, body: unknown, key?: string) => mf.dispatchFetch(`http://runtime.test${path}`, {
      method, headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body),
    });

    // The admission fence deletes at most 99 old receipts, even under a prior
    // retry backlog. These are deliberately the current actor's rows.
    await db.batch(Array.from({ length: 150 }, (_, index) => db.prepare(`INSERT INTO support_sla_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,created_at,expires_at,response_status,response_snapshot)
      VALUES (?,'admin','dashboard.support-state.create',?,?,unixepoch()-7200,unixepoch()-3600,201,'{}')`)
      .bind(tenant, index.toString(16).padStart(64, 'a'), 'b'.repeat(64))));

    const created = await request('/api/support-states', 'POST', admin, state('awaiting'), 'state-create');
    assert.equal(created.status, 201); await created.body?.cancel();
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM support_sla_mutation_receipts
      WHERE tenant_id=? AND principal_id='admin' AND expires_at<=unixepoch()`).bind(tenant).first<{ n: number }>())?.n, 51,
      'receipt cleanup deletes only the indexed 99-row batch');
    const createReplay = await request('/api/support-states', 'POST', admin, state('awaiting'), 'state-create');
    assert.equal(createReplay.status, 201); assert.equal(createReplay.headers.get('Idempotency-Replayed'), 'true'); await createReplay.body?.cancel();
    const createConflict = await request('/api/support-states', 'POST', admin, state('different'), 'state-create');
    assert.equal(createConflict.status, 409); await createConflict.body?.cancel();
    const collision = await Promise.all([
      request('/api/support-states', 'POST', admin, state('collision-a'), 'cross-isolate-collision'),
      request('/api/support-states', 'POST', admin, state('collision-b'), 'cross-isolate-collision'),
    ]);
    assert.deepEqual(collision.map(response => response.status).sort(), [201, 409],
      'the concurrent winner can succeed once, but a same-key different-payload contender never receives its snapshot');
    await Promise.all(collision.map(response => response.body?.cancel()));

    const initial = await db.prepare("SELECT revision FROM ticket_support_state WHERE tenant_id=? AND ticket_id='ticket'").bind(tenant).first<{ revision: number }>();
    const transition = await request('/api/tickets/ticket/support-state', 'PATCH', agent,
      { definitionId: 'awaiting', waitingReason: 'Need evidence', expectedRevision: initial!.revision }, 'state-transition');
    assert.equal(transition.status, 200); const transitioned = await transition.json() as { revision: number };
    await db.prepare("DELETE FROM user_groups WHERE tenant_id=? AND user_id='agent' AND group_id='group'").bind(tenant).run();
    const removedGroup = await request('/api/tickets/ticket/support-state', 'PATCH', agent,
      { definitionId: 'awaiting', waitingReason: 'Must not write', expectedRevision: transitioned.revision }, 'removed-group');
    assert.equal(removedGroup.status, 401, 'removing the live group scope invalidates the dashboard session before the ticket write'); await removedGroup.body?.cancel();
    await db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,'agent','group')").bind(tenant).run();
    agent = await token('agent', 'agent', (await db.prepare("SELECT session_version FROM users WHERE tenant_id=? AND id='agent'").bind(tenant).first<{ session_version: number }>())!.session_version);
    const stale = await request('/api/tickets/ticket/support-state', 'PATCH', agent,
      { definitionId: 'awaiting', waitingReason: 'Stale', expectedRevision: initial!.revision }, 'stale-transition');
    assert.equal(stale.status, 409); await stale.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS n FROM support_sla_mutation_receipts WHERE tenant_id=? AND operation='dashboard.ticket.support-state.transition'").bind(tenant).first<{ n: number }>())?.n, 1,
      'a stale CAS cannot leave a replay receipt');

    const calendar = { timeZone: 'UTC', weekly: { monday: [{ startMinute: 0, endMinute: 1440 }] }, exceptions: [], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } };
    const policyRevision = (await db.prepare('SELECT revision FROM sla_policies WHERE tenant_id=?').bind(tenant).first<{ revision: number }>())!.revision;
    const configured = await request('/api/sla-policy', 'PUT', admin, { expectedRevision: policyRevision, calendar, responseTargetMs: 60_000, resolutionTargetMs: null }, 'sla-policy');
    assert.equal(configured.status, 200); await configured.body?.cancel();
    const policyReplay = await request('/api/sla-policy', 'PUT', admin, { expectedRevision: policyRevision, calendar, responseTargetMs: 60_000, resolutionTargetMs: null }, 'sla-policy');
    assert.equal(policyReplay.status, 200); assert.equal(policyReplay.headers.get('Idempotency-Replayed'), 'true'); await policyReplay.body?.cancel();

    const initialized = await request('/api/tickets/legacy/sla/initialize', 'POST', admin, {}, 'initialize');
    assert.equal(initialized.status, 201); await initialized.body?.cancel();
    const initializeReplay = await request('/api/tickets/legacy/sla/initialize', 'POST', admin, {}, 'initialize');
    assert.equal(initializeReplay.status, 201); assert.equal(initializeReplay.headers.get('Idempotency-Replayed'), 'true'); await initializeReplay.body?.cancel();

    const updated = await request('/api/support-states/awaiting', 'PATCH', admin, { publicLabel: 'Updated public' }, 'state-update');
    assert.equal(updated.status, 200); await updated.body?.cancel();
    const replacement = await request('/api/support-states', 'POST', admin, { id: 'replacement', legacyStatus: 'open', internalLabel: 'Working internal', publicLabel: 'Working public' }, 'replacement');
    assert.equal(replacement.status, 201); await replacement.body?.cancel();
    const deactivated = await request('/api/support-states/awaiting/deactivate', 'POST', admin, { replacementId: 'replacement', waitingReason: 'Carry forward' }, 'deactivate');
    assert.equal(deactivated.status, 200); await deactivated.body?.cancel();
    assert.deepEqual(await db.prepare(`SELECT paused_at,pause_reason,last_support_state_revision FROM ticket_sla_clocks
      WHERE tenant_id=? AND ticket_id='ticket'`).bind(tenant).first(), { paused_at: null, pause_reason: null, last_support_state_revision: transitioned.revision + 1 },
      'deactivation resumes the initialized waiting clock at the remapped support-state revision');
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ticket_sla_pause_intervals
      WHERE tenant_id=? AND ticket_id='ticket' AND ended_at IS NOT NULL`).bind(tenant).first<{ n: number }>())?.n, 1,
      'the prior waiting interval remains durable history and is closed atomically');
    assert.equal((await db.prepare(`SELECT kind FROM ticket_sla_events WHERE tenant_id=? AND ticket_id='ticket'
      ORDER BY recorded_at DESC LIMIT 1`).bind(tenant).first<{ kind: string }>())?.kind, 'clock.resumed');
    const bulkSource = await request('/api/support-states', 'POST', admin, state('bulk-source'), 'bulk-source');
    assert.equal(bulkSource.status, 201); await bulkSource.body?.cancel();
    const bulkReplacement = await request('/api/support-states', 'POST', admin, state('bulk-replacement'), 'bulk-replacement');
    assert.equal(bulkReplacement.status, 201); await bulkReplacement.body?.cancel();
    await db.batch(Array.from({ length: 100 }, (_, index) => db.prepare(`INSERT INTO tickets
      (tenant_id,id,subject,status,customer_email,source) VALUES (?,?,'Bounded remap','open',?,'dashboard')`)
      .bind(tenant, `bulk-${index}`, `bulk-${index}@example.test`)));
    await db.prepare("UPDATE ticket_support_state SET definition_id='bulk-source' WHERE tenant_id=? AND ticket_id LIKE 'bulk-%'").bind(tenant).run();
    const bulkDeactivated = await request('/api/support-states/bulk-source/deactivate', 'POST', admin,
      { replacementId: 'bulk-replacement', waitingReason: 'Carry bounded remap' }, 'bulk-deactivate');
    assert.equal(bulkDeactivated.status, 200); await bulkDeactivated.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS n FROM ticket_support_state WHERE tenant_id=? AND definition_id='bulk-replacement'").bind(tenant).first<{ n: number }>())?.n, 100);
    const observed = await (await mf.dispatchFetch('http://runtime.test/__budget-control')).json() as { canonicalBatches: Array<{ statements: number; rowsRead: number; rowsWritten: number }> };
    assert.ok(observed.canonicalBatches.length >= 11, 'each admitted route contributes one fenced D1 batch');
    const maximumWrites = Math.max(...observed.canonicalBatches.map(batch => batch.rowsWritten));
    const maximumReads = Math.max(...observed.canonicalBatches.map(batch => batch.rowsRead));
    assert.ok(maximumWrites <= 4_096,
      `the measured 100-ticket remap fits the reserved deactivation write ceiling: ${JSON.stringify(observed.canonicalBatches)}`);
    assert.ok(maximumReads <= 8_192,
      `the measured 100-ticket remap fits the reserved deactivation read ceiling despite unrelated same- and foreign-tenant history: ${JSON.stringify(observed.canonicalBatches)}`);
    console.log(JSON.stringify({ fixture: 'native-support-sla-100-remap-envelope', measuredMaximumD1RowsRead: maximumReads, measuredMaximumD1RowsWritten: maximumWrites, remapBatch: observed.canonicalBatches.at(-1) }));

    await db.prepare("UPDATE users SET session_version=2 WHERE tenant_id=? AND id='admin'").bind(tenant).run();
    const revoked = await request('/api/support-states', 'POST', admin, state('revoked'), 'revoked');
    assert.equal(revoked.status, 401, 'a revoked current session is rejected before a receipt or business write'); await revoked.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS n FROM support_sla_mutation_receipts WHERE tenant_id=? AND operation='dashboard.support-state.create'").bind(tenant).first<{ n: number }>())?.n, 5);
  } finally { await mf.dispose(); }
});
