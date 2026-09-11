import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { BudgetAuthorityRepository } from '../src/budgets/authority-repository';
import { BudgetCoordinatorService } from '../src/budgets/budget-coordinator.service';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import { splitSql } from './split-sql';

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
    budgets: [{ dimension: 'workerRequests', allocationId: 'owner-worker-requests', window: { kind: 'interval', id: 'subscription-2026-09', startsAt: NOW - 1, endsAt: NOW + 3_600_000 }, limit: 100, recoveryPercent: 20, provenance: 'owner-allocation' }],
  };
}

function restriction(tenantId: string) {
  return { schemaVersion: 1, tenantId, ownerPolicyId: 'owner-policy', ownerPolicyRevision: 7, revision: 3, mode: 'conservative', limits: { workerRequests: 80 }, disabledFeatures: [] };
}

async function seedAuthority(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('tenant-a','actor-a','actor-a@example.test','admin',1)"),
    db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('tenant-b','actor-b','actor-b@example.test','admin',1)"),
    db.prepare("INSERT INTO budget_deployment_authority (deployment_id,authority_revision,state,updated_at) VALUES ('deployment-verified',1,'active',?)").bind(NOW),
    db.prepare(`INSERT INTO budget_owner_policies
      (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES ('deployment-verified','owner-policy',7,1,'server-derived-owner-aggregate',64,30000,?)`).bind(JSON.stringify(ownerPolicy())),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('deployment-verified',?,'owner-policy',7,1,?,?, 'active')`).bind('tenant-a', 'server-issued-reservation-a', JSON.stringify(restriction('tenant-a'))),
    db.prepare(`INSERT INTO budget_tenant_allocations
      (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES ('deployment-verified',?,'owner-policy',7,1,?,?, 'active')`).bind('tenant-b', 'server-issued-reservation-b', JSON.stringify(restriction('tenant-b'))),
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
    const namespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO');
    const holders = await mf.getDurableObjectNamespace('BUDGET_GRANT_HOLDER_DO');
    const service = new BudgetCoordinatorService(repository, namespace, holders, { authorize: async () => true }, () => clock);
    const tenantA = createVerifiedTenantScope('tenant-a', 'actor-a', ['admin'], 1);
    const tenantB = createVerifiedTenantScope('tenant-b', 'actor-b', ['admin'], 1);
    const request = (holderId: string, idempotencyKey: string) => ({ holderId, idempotencyKey, purpose: 'new-work' as const, envelope: { workerRequests: 50 } });

    const denied = new BudgetCoordinatorService(repository, namespace, holders, { authorize: async () => false }, () => clock);
    assert.equal((await denied.reserveForVerifiedScope(tenantA, request('holder-denied', 'denied'))).reason, 'unavailable');

    const concurrent = await Promise.all([
      service.reserveForVerifiedScope(tenantA, request('holder-a', 'same-time-a')),
      service.reserveForVerifiedScope(tenantB, request('holder-b', 'same-time-b')),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'granted').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason === 'exhausted').length, 1);
    const winnerIndex = concurrent.findIndex(result => result.status === 'granted');
    const winner = concurrent[winnerIndex];
    if (winner.status !== 'granted' || !winner.reservation) throw new Error('expected a seeded warm grant');
    const winningScope = winnerIndex === 0 ? tenantA : tenantB;
    const winningHolder = winnerIndex === 0 ? 'holder-a' : 'holder-b';
    assert.equal((await service.spendWarmForVerifiedScope(winningScope, {
      holderId: winningHolder, reservationId: winner.reservation.reservationId, operationId: 'warm-operation-1', envelope: { workerRequests: 1 },
    })).status, 'spent');

    const authority = await repository.resolveForVerifiedScope(tenantA, NOW);
    assert.equal(authority.kind, 'active');
    if (authority.kind !== 'active') throw new Error('expected active local D1 authority');
    const coordinator = namespace.get(namespace.idFromName(authority.authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    const stale = await coordinator.reserveFromTrustedAuthority({
      tenantId: 'tenant-a', holderId: 'holder-stale', idempotencyKey: 'stale-after-lease', purpose: 'new-work', envelope: { workerRequests: 1 },
      expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, now: authority.authority.authorityExpiresAt,
    });
    assert.equal(stale.status, 'rejected');
    assert.equal(stale.reason, 'stale-policy');

    // A fresh server-side D1 read can renew an unchanged authority lease; a
    // cached revision by itself cannot. The 1-unit envelope still fits the
    // shared 80-unit owner new-work partition after the prior 50-unit grant.
    clock = authority.authority.authorityExpiresAt;
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
