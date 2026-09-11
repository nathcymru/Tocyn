import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { BUDGET_AUTHORITY_MAX_TENANT_ALLOCATIONS, BudgetAuthorityRepository } from '../src/budgets/authority-repository';
import { BudgetCoordinatorService } from '../src/budgets/budget-coordinator.service';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import type { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import { splitSql } from './split-sql';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

const NOW = Date.UTC(2026, 8, 11, 10, 0, 0);
const serverRoot = resolve(import.meta.dirname, '..');

async function applyMigrations(db: D1Database): Promise<void> {
  const directory = join(serverRoot, 'migrations');
  for (const migration of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(directory, migration), 'utf8')).map(statement => db.prepare(statement)));
  }
}

function ownerPolicy() {
  return {
    schemaVersion: 1, policyId: 'owner-policy', revision: 7, deploymentId: 'deployment-verified', mode: 'conservative', catalogueVersion: 'catalogue-1', maxGrantLifetimeMs: 60_000,
    budgets: [
      { dimension: 'workerRequests', allocationId: 'owner-worker-requests', window: { kind: 'interval', id: 'subscription-2026-09', startsAt: NOW - 1, endsAt: NOW + 3_600_000 }, limit: 100, recoveryPercent: 20, provenance: 'owner-allocation' },
      { dimension: 'd1RowsRead', allocationId: 'owner-d1-reads', window: { kind: 'interval', id: 'subscription-2026-09', startsAt: NOW - 1, endsAt: NOW + 3_600_000 }, limit: 10_000, recoveryPercent: 20, provenance: 'owner-allocation' },
      { dimension: 'doRequests', allocationId: 'owner-do-requests', window: { kind: 'interval', id: 'subscription-2026-09', startsAt: NOW - 1, endsAt: NOW + 3_600_000 }, limit: 100, recoveryPercent: 20, provenance: 'owner-allocation' },
      { dimension: 'doRowsWritten', allocationId: 'owner-do-writes', window: { kind: 'interval', id: 'subscription-2026-09', startsAt: NOW - 1, endsAt: NOW + 3_600_000 }, limit: 100, recoveryPercent: 20, provenance: 'owner-allocation' },
    ],
  };
}

function restriction(tenantId: string) {
  return { schemaVersion: 1, tenantId, ownerPolicyId: 'owner-policy', ownerPolicyRevision: 7, revision: 3, mode: 'conservative', limits: { workerRequests: 80, d1RowsRead: 8_000, doRequests: 80, doRowsWritten: 80 }, disabledFeatures: [] };
}

function snapshotOwnerPolicy() {
  return { ...ownerPolicy(), budgets: [ownerPolicy().budgets[0]] };
}

function snapshotRestriction(tenantId: string) {
  return { ...restriction(tenantId), limits: { workerRequests: 80 } };
}

async function seedAuthority(db: D1Database, policy = ownerPolicy(), tenantRestriction: (tenantId: string) => ReturnType<typeof restriction> | ReturnType<typeof snapshotRestriction> = restriction): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('tenant-a','actor-a','actor-a@example.test','admin',1)"),
    db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('tenant-b','actor-b','actor-b@example.test','admin',1)"),
    db.prepare("INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at) VALUES ('deployment-verified',1,'active',?)").bind(NOW),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('deployment-verified','owner-policy',7,1,'server-derived-owner-aggregate',64,30000,?)`).bind(JSON.stringify(policy)),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('deployment-verified',?,'owner-policy',7,1,?,?, 'active')`).bind('tenant-a', 'server-issued-reservation-a', JSON.stringify(tenantRestriction('tenant-a'))),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('deployment-verified',?,'owner-policy',7,1,?,?, 'active')`).bind('tenant-b', 'server-issued-reservation-b', JSON.stringify(tenantRestriction('tenant-b'))),
  ]);
}

test('real local D1 authority derives a shared coordinator, expires stale policy, and delivers revocation', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-coordinator-do-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-authority-proof', modules: true, script: bundled.outputFiles[0].text,
      d1Databases: { DB: 'budget-authority-d1' }, durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
    }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    await seedAuthority(db);
    let clock = NOW;
    const repository = new BudgetAuthorityRepository(db);
    const namespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace;
    const holders = await mf.getDurableObjectNamespace('BUDGET_GRANT_HOLDER_DO') as unknown as DurableObjectNamespace;
    const service = new BudgetCoordinatorService(repository, namespace, holders, { authorize: async scope => ({ kind: 'session' as const, sessionVersion: scope.authVersion }) }, () => clock);
    const tenantA = createVerifiedTenantScope('tenant-a', 'actor-a', ['admin'], 1);
    const tenantB = createVerifiedTenantScope('tenant-b', 'actor-b', ['admin'], 1);
    const request = (holderId: string, idempotencyKey: string) => ({ holderId, idempotencyKey, purpose: 'new-work' as const,
      envelope: { workerRequests: 50, d1RowsRead: 3_072, doRequests: 6, doRowsWritten: 6 } });

    const denied = new BudgetCoordinatorService(repository, namespace, holders, { authorize: async () => null }, () => clock);
    assert.equal((await denied.reserveForVerifiedScope(tenantA, request('holder-denied', 'denied'))).reason, 'unavailable');

    const concurrent = await Promise.all([
      service.reserveForVerifiedScope(tenantA, request('holder-a', 'same-time-a')),
      service.reserveForVerifiedScope(tenantB, request('holder-b', 'same-time-b')),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'granted').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason === 'exhausted').length, 1);

    // A coordinator write can survive an interrupted holder seed. Its finite
    // recovery allowance is committed before each seed, so repeated failures
    // retain the charge for reconciliation instead of causing infinite work.
    const retryHolderId = 'holder-seed-retry';
    const actualHolder = holders.get(holders.idFromName(JSON.stringify(['budget-grant-holder-v1', 'tenant-a', retryHolderId]))) as any;
    let remainingFailedSeeds = 2;
    let seedCalls = 0;
    const flakyHolders = {
      idFromName: holders.idFromName.bind(holders),
      get: () => ({
        seedFromTrustedAuthority: async (input: unknown) => {
          seedCalls += 1;
          if (remainingFailedSeeds-- > 0) throw new Error('synthetic holder seed interruption');
          return actualHolder.seedFromTrustedAuthority(input);
        },
      }),
    } as any;
    const interrupted = new BudgetCoordinatorService(repository, namespace, flakyHolders, { authorize: async scope => ({ kind: 'session' as const, sessionVersion: scope.authVersion }) }, () => clock);
    await assert.rejects(interrupted.reserveForVerifiedScope(tenantA, { holderId: retryHolderId, idempotencyKey: 'retry-seed', purpose: 'new-work', envelope: { workerRequests: 1 } }));
    await assert.rejects(interrupted.reserveForVerifiedScope(tenantA, { holderId: retryHolderId, idempotencyKey: 'retry-seed', purpose: 'new-work', envelope: { workerRequests: 1 } }));
    const exhaustedSeedDelivery = await interrupted.reserveForVerifiedScope(tenantA, { holderId: retryHolderId, idempotencyKey: 'retry-seed', purpose: 'new-work', envelope: { workerRequests: 1 } });
    assert.equal(exhaustedSeedDelivery.status, 'rejected');
    assert.equal(exhaustedSeedDelivery.reason, 'delivery-exhausted');
    assert.equal(seedCalls, 2, 'the durable grant permits only the initial seed and one recovery seed');
    assert.equal(await actualHolder.inspectForTrustedRuntime(), null, 'a delivery-exhausted grant is held for reconciliation rather than silently retried');

    // The reverse fault is also possible: the holder commits its seed but the
    // RPC acknowledgement is lost. A recovery delivery changes only the
    // coordinator-local attempt counter and must neither reject nor reset the
    // durable holder grant/receipts.
    const lostAckHolderId = 'holder-lost-ack';
    const persistThenLoseAckHolders = {
      idFromName: holders.idFromName.bind(holders),
      get: (id: unknown) => {
        const target = holders.get(id as any) as any;
        return {
          seedFromTrustedAuthority: async (input: unknown) => {
            await target.seedFromTrustedAuthority(input);
            throw new Error('synthetic acknowledgement loss after durable seed');
          },
        };
      },
    } as any;
    const lostAckService = new BudgetCoordinatorService(repository, namespace, persistThenLoseAckHolders,
      { authorize: async scope => ({ kind: 'session' as const, sessionVersion: scope.authVersion }) }, () => clock);
    await assert.rejects(lostAckService.reserveForVerifiedScope(tenantA, {
      holderId: lostAckHolderId, idempotencyKey: 'lost-ack-after-seed', purpose: 'new-work', envelope: { workerRequests: 1 },
    }));
    const lostAckGrant = (await (namespace.get(namespace.idFromName('server-derived-owner-aggregate')) as unknown as BudgetCoordinatorDO).inspectForTrustedRuntime())
      .tenantStates.find(tenant => tenant.tenantId === 'tenant-a')?.grants.find(grant => grant.idempotencyKey === 'lost-ack-after-seed');
    assert.ok(lostAckGrant);
    const lostAckHolder = holders.get(holders.idFromName(JSON.stringify([
      'budget-grant-holder-v2', 'tenant-a', lostAckHolderId, lostAckGrant.reservationId,
    ]))) as any;
    const holderBeforeRecovery = await lostAckHolder.inspectForTrustedRuntime();
    assert.ok(holderBeforeRecovery, 'the first seed must have persisted before its acknowledgement was lost');
    const recoveredLostAck = await service.reserveForVerifiedScope(tenantA, {
      holderId: lostAckHolderId, idempotencyKey: 'lost-ack-after-seed', purpose: 'new-work', envelope: { workerRequests: 1 },
    });
    assert.equal(recoveredLostAck.status, 'idempotent');
    assert.equal(JSON.stringify(await lostAckHolder.inspectForTrustedRuntime()), JSON.stringify(holderBeforeRecovery),
      'recovery accepts the delivery counter update without replacing the holder grant or replay state');

    const winnerIndex = concurrent.findIndex(result => result.status === 'granted');
    const winner = concurrent[winnerIndex];
    if (winner.status !== 'granted' || !winner.reservation) throw new Error('expected a seeded warm grant');
    const winningScope = winnerIndex === 0 ? tenantA : tenantB;
    const winningHolder = winnerIndex === 0 ? 'holder-a' : 'holder-b';
    const winningIdempotencyKey = winnerIndex === 0 ? 'same-time-a' : 'same-time-b';
    const warmRequest = {
      holderId: winningHolder, reservationId: winner.reservation.reservationId, operationId: 'warm-operation-1', envelope: { workerRequests: 1 },
    };
    assert.equal((await service.spendWarmForVerifiedScope(winningScope, warmRequest)).status, 'spent');
    assert.equal((await service.spendWarmForVerifiedScope(winningScope, warmRequest)).status, 'idempotent', 'the pre-reserved recovery acknowledgement is finite');
    assert.equal((await service.spendWarmForVerifiedScope(winningScope, warmRequest)).reason, 'replay-exhausted');
    const warmHolder = holders.get(holders.idFromName(JSON.stringify(['budget-grant-holder-v2', winningScope.tenantId, winningHolder, winner.reservation.reservationId]))) as any;
    assert.deepEqual((await warmHolder.inspectForTrustedRuntime()).grant.remaining, { workerRequests: 47 },
      'the first warm execution holds both 1,536-row/three-DO-attempt control-plane allowances before work; its one replay consumes the pre-held recovery acknowledgement');

    clock = winner.reservation.expiresAt;
    const terminalRetry = await service.reserveForVerifiedScope(winningScope, request(winningHolder, winningIdempotencyKey));
    assert.equal(terminalRetry.status, 'rejected');
    assert.equal(terminalRetry.reason, 'stale-policy', 'an expired idempotency reservation must not re-seed or admit canonical work');
    assert.deepEqual((await warmHolder.inspectForTrustedRuntime()).grant.remaining, { workerRequests: 47 },
      'terminal recovery leaves the already-spent holder balance untouched');

    const authority = await repository.resolveForVerifiedScope(tenantA, NOW);
    assert.equal(authority.kind, 'active');
    if (authority.kind !== 'active') throw new Error('expected active local D1 authority');
    const coordinator = namespace.get(namespace.idFromName(authority.authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    const currentCoordinatorLease = (await coordinator.inspectForTrustedRuntime()).authorityExpiresAt;
    const stale = await coordinator.reserveFromTrustedAuthority({
      tenantId: 'tenant-a', holderId: 'holder-stale', idempotencyKey: 'stale-after-lease', purpose: 'new-work', envelope: { workerRequests: 1 },
      expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, now: currentCoordinatorLease,
    });
    assert.equal(stale.status, 'rejected');
    assert.equal(stale.reason, 'stale-policy');

    // A fresh server-side D1 read can renew an unchanged authority lease; a
    // cached revision by itself cannot. The 1-unit envelope still fits the
    // shared 80-unit owner new-work partition after the prior 50-unit grant.
    clock = currentCoordinatorLease;
    const refreshed = await service.reserveForVerifiedScope(tenantA, {
      holderId: 'holder-after-fresh-read', idempotencyKey: 'after-fresh-read', purpose: 'new-work', envelope: { workerRequests: 1 },
    });
    assert.equal(refreshed.status, 'granted');

    const transitionedPolicy = { ...ownerPolicy(), revision: 8 };
    const transitionedRestriction = (tenantId: string) => ({ ...restriction(tenantId), ownerPolicyRevision: 8, revision: 4, limits: { workerRequests: 60 } });
    await db.batch([
      db.prepare(`INSERT INTO budget_owner_policies
        (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('deployment-verified','owner-policy',8,2,'server-derived-owner-aggregate',64,30000,?)`).bind(JSON.stringify(transitionedPolicy)),
      db.prepare(`UPDATE budget_tenant_allocations SET policy_revision=8,authority_revision=2,restriction_json=?
        WHERE deployment_id='deployment-verified' AND tenant_id=?`).bind(JSON.stringify(transitionedRestriction('tenant-a')), 'tenant-a'),
      db.prepare(`UPDATE budget_tenant_allocations SET policy_revision=8,authority_revision=2,restriction_json=?
        WHERE deployment_id='deployment-verified' AND tenant_id=?`).bind(JSON.stringify(transitionedRestriction('tenant-b')), 'tenant-b'),
      db.prepare("UPDATE budget_deployment_authority SET authority_revision=2,state='active',updated_at=? WHERE deployment_id='deployment-verified'").bind(clock + 1),
    ]);
    clock += 1;
    const transition = await service.reserveForVerifiedScope(tenantB, request('holder-after-transition', 'after-transition'));
    assert.equal(transition.status, 'rejected');
    assert.equal((await coordinator.inspectForTrustedRuntime()).tenantStates.flatMap(tenant => tenant.grants).some(grant => grant.status === 'uncertain'), true);
    const staleWarm = await service.spendWarmForVerifiedScope(winningScope, {
      holderId: winningHolder, reservationId: winner.reservation.reservationId, operationId: 'warm-after-policy-change', envelope: { workerRequests: 1 },
    });
    assert.equal(staleWarm.reason, 'stale-policy', 'a fresh D1 policy revision fences warm spend before holder decrement');

    await db.prepare("UPDATE budget_deployment_authority SET authority_revision=3,state='revoked',updated_at=? WHERE deployment_id='deployment-verified'").bind(clock + 1).run();
    clock += 1;
    const revoked = await service.reserveForVerifiedScope(tenantB, request('holder-revoked', 'after-revocation'));
    assert.equal(revoked.status, 'rejected');
    assert.equal(revoked.reason, 'stale-policy');
    assert.equal((await coordinator.inspectForTrustedRuntime()).newAdmissionsBlocked, true);

    await db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='actor-a'").run();
    const unavailable = await service.reserveForVerifiedScope(tenantA, request('holder-revoked-session', 'no-membership'));
    assert.equal(unavailable.status, 'rejected');
    assert.equal(unavailable.reason, 'unavailable');
  } finally {
    await mf?.dispose();
  }
});


test('real local D1 snapshot stops at the configured allocation sentinel and uses the allocation index', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-coordinator-do-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'budget-authority-snapshot-proof', modules: true, script: bundled.outputFiles[0].text,
      d1Databases: { DB: 'budget-authority-snapshot-d1' }, unsafeEphemeralDurableObjects: true }] }));
    const db = await mf.getD1Database('DB');
    await applyMigrations(db); await seedAuthority(db, snapshotOwnerPolicy(), snapshotRestriction);
    const additions = Array.from({ length: BUDGET_AUTHORITY_MAX_TENANT_ALLOCATIONS - 2 }, (_, index) => {
      const tenantId = `tenant-snapshot-${String(index).padStart(3, '0')}`;
      return db.prepare(`INSERT INTO budget_tenant_allocations
        (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES ('deployment-verified',?,'owner-policy',7,1,?,?,'active')`)
        .bind(tenantId, `snapshot-namespace-${index}`, JSON.stringify(snapshotRestriction(tenantId)));
    });
    await db.batch(additions);
    const plan = await db.prepare(`EXPLAIN QUERY PLAN SELECT a.tenant_id FROM budget_tenant_allocations a
      JOIN budget_owner_policies p ON p.deployment_id=a.deployment_id AND p.policy_id=a.policy_id
        AND p.policy_revision=a.policy_revision AND p.authority_revision=a.authority_revision
      JOIN budget_deployment_authority d ON d.deployment_id=a.deployment_id
      WHERE a.deployment_id=? AND a.policy_id=? AND a.policy_revision=? AND a.authority_revision=? AND a.state='active'
        AND p.coordinator_id=? AND d.state='active' AND d.authority_revision=a.authority_revision LIMIT 129`)
      .bind('deployment-verified', 'owner-policy', 7, 1, 'server-derived-owner-aggregate').all<{ detail: string }>();
    const details = plan.results.map((row: { detail: string }) => row.detail).join(' | ');
    assert.match(details, /idx_budget_tenant_authority/, `snapshot plan must use the bounded allocation index: ${details}`);
    const countPlan = await db.prepare(`EXPLAIN QUERY PLAN SELECT count(*) AS count FROM (
      SELECT 1 FROM budget_tenant_allocations a
      JOIN budget_owner_policies p ON p.deployment_id=a.deployment_id AND p.policy_id=a.policy_id
        AND p.policy_revision=a.policy_revision AND p.authority_revision=a.authority_revision
      JOIN budget_deployment_authority d ON d.deployment_id=a.deployment_id
      WHERE a.deployment_id=? AND a.policy_id=? AND a.policy_revision=? AND a.authority_revision=? AND a.state='active'
        AND p.coordinator_id=? AND d.state='active' AND d.authority_revision=? AND p.max_reservations=? AND p.authority_max_age_ms=?
      LIMIT 129)`)
      .bind('deployment-verified', 'owner-policy', 7, 1, 'server-derived-owner-aggregate', 1, 64, 30000).all<{ detail: string }>();
    assert.match(countPlan.results.map((row: { detail: string }) => row.detail).join(' | '), /idx_budget_tenant_authority/, 'sentinel count must use the same bounded allocation index');
    const repository = new BudgetAuthorityRepository(db);
    const scope = createVerifiedTenantScope('tenant-a', 'actor-a', ['admin'], 1);
    const active = await repository.resolveForVerifiedScope(scope, NOW);
    assert.equal(active.kind, 'active');
    if (active.kind !== 'active') throw new Error('expected maximum valid snapshot');
    assert.equal(active.authority.tenantAllocations.length, BUDGET_AUTHORITY_MAX_TENANT_ALLOCATIONS);
    await db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('deployment-verified','tenant-snapshot-overflow','owner-policy',7,1,'snapshot-overflow',?,'active')`)
      .bind(JSON.stringify(snapshotRestriction('tenant-snapshot-overflow'))).run();
    assert.equal((await repository.resolveForVerifiedScope(scope, NOW)).kind, 'unavailable', 'the 129th allocation is rejected without an unbounded count');
  } finally { await mf?.dispose(); }
});
