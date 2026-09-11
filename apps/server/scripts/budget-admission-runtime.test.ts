import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { BudgetAuthorityRepository } from '../src/budgets/authority-repository';
import { createVerifiedTenantScope } from '../src/auth/scope';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';

const serverRoot = resolve(import.meta.dirname, '..');
const now = Date.now();
const apiKey = 'lt_budget_runtime.12345678901234567890123456789012';

async function applyMigrations(db: D1Database): Promise<void> {
  const directory = join(serverRoot, 'migrations');
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(directory, file), 'utf8')).map(statement => db.prepare(statement)));
  }
}

function policy(overrides: Partial<Record<'workerRequests' | 'd1RowsRead' | 'd1RowsWritten' | 'doRequests' | 'doRowsWritten', number>> = {}) {
  const dimensions = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'doRequests', 'doRowsWritten'] as const;
  const limits = { workerRequests: 3, d1RowsRead: 4_000, d1RowsWritten: 100, doRequests: 10, doRowsWritten: 10, ...overrides };
  return {
    schemaVersion: 1, policyId: 'runtime-owner-policy', revision: 1, deploymentId: 'runtime-deployment',
    mode: 'conservative', catalogueVersion: 'runtime-catalogue', maxGrantLifetimeMs: 60_000,
    budgets: dimensions.map(dimension => ({ dimension, allocationId: `runtime-${dimension}`,
      window: { kind: 'interval', id: 'runtime-window', startsAt: now - 1_000, endsAt: now + 60_000 },
      limit: limits[dimension], recoveryPercent: 20, provenance: 'owner-allocation' as const })),
  };
}

async function seed(db: D1Database, extraTenants = 31, owner = policy()): Promise<void> {
  const tenantId = 'runtime-tenant';
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: owner.policyId, ownerPolicyRevision: 1,
    revision: 1, mode: 'conservative', limits: Object.fromEntries(owner.budgets.map(item => [item.dimension, item.limit])), disabledFeatures: [] };
  await db.batch([
    db.prepare(`INSERT INTO api_keys (tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
      VALUES (?,?,?,?,?,'tickets:write',1,unixepoch())`).bind(tenantId, 'runtime-key', 'runtime key', keyHash, 'lt_budget'),
    db.prepare(`INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at)
      VALUES ('runtime-deployment',1,'active',?)`).bind(now),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('runtime-deployment','runtime-owner-policy',1,1,'runtime-owner-coordinator',64,60000,?)`).bind(JSON.stringify(owner)),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('runtime-deployment',?,'runtime-owner-policy',1,1,'runtime-namespace',?,'active')`).bind(tenantId, JSON.stringify(restriction)),
  ]);
  // Exercise an enabled multi-tenant authority below the serialized RPC cap;
  // the separate authority test covers the 128-allocation sentinel and plan.
  const extraAllocationStatements = Array.from({ length: extraTenants }, (_, index) => {
    const extraTenant = `runtime-extra-${String(index).padStart(3, '0')}`;
    const extraRestriction = { ...restriction, tenantId: extraTenant };
    return db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('runtime-deployment',?,'runtime-owner-policy',1,1,?,?,'active')`)
      .bind(extraTenant, `runtime-namespace-${index}`, JSON.stringify(extraRestriction));
  });
  if (extraAllocationStatements.length > 0) await db.batch(extraAllocationStatements);
}

test('real local API-key create reserves configured aggregate capacity before its mutation commit', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' },
      unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    await seed(db);
    const snapshot = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(snapshot.kind, 'active');
    if (snapshot.kind !== 'active') throw new Error('expected active synthetic authority');
    assert.equal(snapshot.authority.tenantAllocations.length, 32);
    const coordinatorNamespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO');
    const coordinator = coordinatorNamespace.get(coordinatorNamespace.idFromName(snapshot.authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    await coordinator.refreshFromTrustedAuthority(snapshot.authority);
    const request = () => mf!.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ subject: 'Budgeted runtime ticket', customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    const accepted = await request();
    assert.equal(accepted.status, 201);
    const acceptedBody = await accepted.json() as { id: string };
    const rejected = await request();
    assert.equal(rejected.status, 429);
    assert.deepEqual(await rejected.json(), { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' });
    const reply = await mf.dispatchFetch(`http://runtime.test/api/v1/tickets/${acceptedBody.id}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ body: 'must not commit' }),
    });
    assert.equal(reply.status, 429, 'the reply route uses the same configured admission boundary');
    await reply.body?.cancel();
    const tickets = await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>();
    const articles = await db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant'").first<{ count: number }>();
    assert.equal(tickets?.count, 1, 'budget rejection occurs before the second ticket mutation batch');
    assert.equal(articles?.count, 1, 'budget rejection occurs before the reply mutation batch');
  } finally {
    await mf?.dispose();
  }
});

test('real local admission gives distinct server-issued holder balances to separate same-key API mutations', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-multiple-grants-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-multiple-grants-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    // Four mutations each reserve 2 worker requests, 3,072 D1 reads, 64 D1
    // writes and six DO requests/writes. The new-work partition admits all
    // four, so a failure proves holder identity rather than exhaustion.
    await seed(db, 0, policy({ workerRequests: 10, d1RowsRead: 16_000, d1RowsWritten: 400, doRequests: 40, doRowsWritten: 40 }));
    const request = (subject: string, key: string) => mf!.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'idempotency-key': key },
      body: JSON.stringify({ subject, customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    const first = await request('First independently budgeted ticket', 'multiple-create-1');
    const second = await request('Second independently budgeted ticket', 'multiple-create-2');
    assert.equal(first.status, 201); assert.equal(second.status, 201);
    const firstTicket = await first.json() as { id: string };
    const secondTicket = await second.json() as { id: string };
    const reply = (ticketId: string, body: string, key: string) => mf!.dispatchFetch(`http://runtime.test/api/v1/tickets/${ticketId}/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'idempotency-key': key }, body: JSON.stringify({ body }),
    });
    const firstReply = await reply(firstTicket.id, 'first independently budgeted reply', 'multiple-reply-1');
    const secondReply = await reply(secondTicket.id, 'second independently budgeted reply', 'multiple-reply-2');
    assert.equal(firstReply.status, 201); assert.equal(secondReply.status, 201);
    await Promise.all([firstReply.body?.cancel(), secondReply.body?.cancel()]);

    const replay = await reply(firstTicket.id, 'first independently budgeted reply', 'multiple-reply-1');
    assert.equal(replay.status, 201, 'the canonical replay must not create a fifth budget grant');
    await replay.body?.cancel();

    const snapshot = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(snapshot.kind, 'active');
    if (snapshot.kind !== 'active') throw new Error('expected active synthetic authority');
    const coordinators = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO');
    const coordinator = coordinators.get(coordinators.idFromName(snapshot.authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    const grants = (await coordinator.inspectForTrustedRuntime()).tenantStates.find(state => state.tenantId === 'runtime-tenant')?.grants ?? [];
    assert.equal(grants.length, 4, 'two creates and two replies reserve four distinct canonical admissions');
    assert.equal(new Set(grants.map(grant => grant.reservationId)).size, 4);
    const holders = await mf.getDurableObjectNamespace('BUDGET_GRANT_HOLDER_DO');
    for (const grant of grants) {
      const holder = holders.get(holders.idFromName(JSON.stringify([
        'budget-grant-holder-v2', 'runtime-tenant', 'api-key:runtime-key', grant.reservationId,
      ]))) as any;
      const stored = await holder.inspectForTrustedRuntime();
      assert.equal(stored?.grant.reservationId, grant.reservationId, 'each server-issued reservation owns an isolated durable holder balance');
    }
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 2);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM articles WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 4);
  } finally { await mf?.dispose(); }
});


test('full 128-allocation authority that exceeds the bounded DO payload fails closed before mutation', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-admission-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-admission-oversize-proof', modules: true, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text,
      bindings: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', DISABLE_RATE_LIMIT: 'true' },
      d1Databases: { DB: 'budget-admission-oversize-d1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB'); await applyMigrations(db); await seed(db, 127);
    const resolution = await new BudgetAuthorityRepository(db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope('runtime-tenant', 'runtime-key', ['integration'], 1),
      { kind: 'api-key', apiKeyId: 'runtime-key', requiredPermission: 'tickets:write' }, now,
    );
    assert.equal(resolution.kind, 'unavailable', 'oversized configured authority never reaches a coordinator RPC');
    const response = await mf.dispatchFetch('http://runtime.test/api/v1/tickets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ subject: 'must not commit', customer_email: 'runtime@example.test', body: 'synthetic' }),
    });
    assert.equal(response.status, 503);
    await response.body?.cancel();
    assert.equal((await db.prepare("SELECT count(*) AS count FROM tickets WHERE tenant_id='runtime-tenant'").first<{ count: number }>())?.count, 0);
  } finally { await mf?.dispose(); }
});
