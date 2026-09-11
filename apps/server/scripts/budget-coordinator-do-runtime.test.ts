import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { CostPolicy, EffectiveTenantCostPolicy, ResourceAmounts } from '@luminatick/shared';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import type { TrustedBudgetCoordinatorAuthority } from '../src/budgets/owner-aggregate';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

const NOW = Date.UTC(2026, 8, 11, 9, 0, 0);

function ownerPolicy(): CostPolicy {
  return {
    schemaVersion: 1, policyId: 'owner-policy', revision: 7, deploymentId: 'deployment-verified', mode: 'conservative', catalogueVersion: 'catalogue-1', maxGrantLifetimeMs: 60_000,
    budgets: [{ dimension: 'workerRequests', allocationId: 'owner-worker-requests', window: { kind: 'interval', id: 'month-2026-09', startsAt: NOW - 1, endsAt: NOW + 3_600_000 }, limit: 100, recoveryPercent: 20, provenance: 'owner-allocation' }],
  };
}

function tenantPolicy(tenantId: string): EffectiveTenantCostPolicy {
  return { ...ownerPolicy(), tenantId, restrictionRevision: 3, disabledFeatures: [], budgets: [{ ...ownerPolicy().budgets[0], limit: 80 }] };
}

function authority(): TrustedBudgetCoordinatorAuthority {
  return {
    aggregateId: 'server-derived-owner-aggregate', ownerPolicy: ownerPolicy(), authorityCheckedAt: NOW, authorityRevision: 1, authorityExpiresAt: NOW + 30_000, maxReservations: 64,
    tenantAllocations: [
      { reservationNamespace: 'server-issued-reservation-a', effectivePolicy: tenantPolicy('tenant-a') },
      { reservationNamespace: 'server-issued-reservation-b', effectivePolicy: tenantPolicy('tenant-b') },
    ],
  };
}

function reserve(tenantId: string, holderId: string, idempotencyKey: string, units: number) {
  return { tenantId, holderId, idempotencyKey, expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, purpose: 'new-work' as const, envelope: { workerRequests: units } satisfies ResourceAmounts, now: NOW };
}

test('real Miniflare coordinator atomically caps two tenant allocations at their shared owner ceiling', async () => {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-coordinator-do-runtime-entry.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'budget-coordinator-proof', modules: true, script: bundled.outputFiles[0].text,
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO' }, unsafeEphemeralDurableObjects: true,
    }] }));
    const namespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = namespace.get(namespace.idFromName('server-derived-owner-aggregate')) as unknown as BudgetCoordinatorDO;
    await coordinator.initializeFromTrustedAuthority(authority());

    const outcomes = await Promise.all([
      coordinator.reserveFromTrustedAuthority(reserve('tenant-a', 'holder-a', 'same-time-a', 50)),
      coordinator.reserveFromTrustedAuthority(reserve('tenant-b', 'holder-b', 'same-time-b', 50)),
    ]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'granted').length, 1);
    assert.equal(outcomes.filter(outcome => outcome.status === 'rejected' && outcome.reason === 'exhausted').length, 1);

    const state = await coordinator.inspectForTrustedRuntime();
    const granted = state.tenantStates.flatMap(tenant => tenant.grants).find(grant => grant.status === 'reserved');
    assert.ok(granted);
    const owningTenant = state.tenantStates.find(tenant => tenant.grants.some(grant => grant.reservationId === granted.reservationId));
    assert.ok(owningTenant);
    const reconciliation = await coordinator.reconcileFromTrustedAuthority({
      tenantId: owningTenant.tenantId, reservationId: granted.reservationId, holderId: granted.holderId,
      expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3,
      terminalEvidenceId: 'trusted-terminal-evidence-1', measured: { workerRequests: 30 }, uncertain: {}, now: NOW + 1,
    });
    assert.equal(reconciliation, 'reconciled');

    const afterReconciliation = await coordinator.reserveFromTrustedAuthority(reserve(
      owningTenant.tenantId === 'tenant-a' ? 'tenant-b' : 'tenant-a', 'holder-after-reconcile', 'after-reconcile', 50,
    ));
    assert.equal(afterReconciliation.status, 'granted');
    const final = await coordinator.inspectForTrustedRuntime();
    assert.equal(final.tenantStates.flatMap(tenant => tenant.grants).reduce((total, grant) => total + (grant.accounted.workerRequests ?? 0), 0), 80);
  } finally {
    await mf?.dispose();
  }
});

test('real Miniflare coordinator rejects uninitialized or replacement authority snapshots', async () => {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-coordinator-do-runtime-entry.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'budget-coordinator-bootstrap-proof', modules: true, script: bundled.outputFiles[0].text,
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO' }, unsafeEphemeralDurableObjects: true }] }));
    const namespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = namespace.get(namespace.idFromName('server-derived-owner-aggregate')) as unknown as BudgetCoordinatorDO;
    await assert.rejects(() => coordinator.reserveFromTrustedAuthority(reserve('tenant-a', 'holder-a', 'before-bootstrap', 1)));
    await coordinator.initializeFromTrustedAuthority(authority());
    await assert.rejects(() => coordinator.initializeFromTrustedAuthority(authority()));
  } finally {
    await mf?.dispose();
  }
});

test('native coordinator bounds unexpired allocation and charge history and permits exact current-authority refreshes', async () => {
  const bundled = await build({ entryPoints: [resolve(import.meta.dirname, 'budget-coordinator-do-runtime-entry.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'budget-metadata-proof', modules: true,
    script: bundled.outputFiles[0].text, durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDiagnosticDO' }, unsafeEphemeralDurableObjects: true }] }));
  try {
    const namespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = namespace.get(namespace.idFromName('server-derived-owner-aggregate')) as unknown as BudgetCoordinatorDO;
    const snapshot = (cycle: number, checkedAt = NOW): TrustedBudgetCoordinatorAuthority => {
      const original = authority();
      const owner = { ...original.ownerPolicy, revision: 7 + cycle, budgets: original.ownerPolicy.budgets.map(budget => ({ ...budget,
        allocationId: `window-allocation-${cycle}`, window: { kind: 'interval' as const, id: `window-${cycle}-€`, startsAt: checkedAt - 1, endsAt: checkedAt + 3_600_000 } })) };
      return { ...original, ownerPolicy: owner, authorityRevision: 1 + cycle, authorityCheckedAt: checkedAt, authorityExpiresAt: checkedAt + 30_000,
        tenantAllocations: original.tenantAllocations.map(tenant => ({ ...tenant, effectivePolicy: { ...owner,
          tenantId: tenant.effectivePolicy.tenantId, restrictionRevision: 3, disabledFeatures: [] } })) };
    };
    const diagnosticCoordinator = coordinator as unknown as import('./budget-coordinator-do-runtime-entry').BudgetCoordinatorDiagnosticDO;
    await coordinator.initializeFromTrustedAuthority(snapshot(0));
    await diagnosticCoordinator.persistLegacyObjectForTest();
    assert.equal((await diagnosticCoordinator.inspectStoredValueForTest()).kind, 'object');
    let completed = 0;
    let lastCommitted = '';
    for (let cycle = 0; cycle < 256; cycle++) {
      const current = snapshot(cycle);
      if (cycle === 1) {
        await diagnosticCoordinator.persistLegacyStringForTest();
        assert.equal((await diagnosticCoordinator.inspectStoredValueForTest()).kind, 'string');
        assert.equal((await coordinator.inspectForTrustedRuntime()).tenantStates[0].closedCharges[0].units, 1);
      }
      lastCommitted = JSON.stringify(await coordinator.inspectForTrustedRuntime().catch(() => null));
      try { await coordinator.refreshFromTrustedAuthority(current); }
      catch (error) {
        assert.match(String(error), /metadata.*capacity exhausted/);
        assert.equal(JSON.stringify(await coordinator.inspectForTrustedRuntime()), lastCommitted);
        break;
      }
      await coordinator.refreshFromTrustedAuthority(current);
      lastCommitted = JSON.stringify(await coordinator.inspectForTrustedRuntime());
      let result;
      try { result = await coordinator.reserveFromTrustedAuthority({ ...reserve('tenant-a', `holder-${cycle}`, `operation-${cycle}`, 1), expectedPolicyRevision: 7 + cycle }); }
      catch (error) {
        assert.match(String(error), /metadata.*capacity exhausted/);
        assert.equal(JSON.stringify(await coordinator.inspectForTrustedRuntime()), lastCommitted);
        break;
      }
      if (result.status === 'rejected') {
        assert.equal(result.reason, 'capacity-exhausted');
        assert.equal(JSON.stringify(await coordinator.inspectForTrustedRuntime()), lastCommitted);
        break;
      }
      assert.equal(result.status, 'granted'); const grant = JSON.parse(JSON.stringify(result.reservation!));
      if (cycle === 0) {
        await diagnosticCoordinator.persistLegacyObjectForTest();
        assert.equal((await diagnosticCoordinator.inspectStoredValueForTest()).kind, 'object');
        assert.equal((await coordinator.inspectForTrustedRuntime()).tenantStates[0].grants[0].accounted.workerRequests, 1);
      }
      lastCommitted = JSON.stringify(await coordinator.inspectForTrustedRuntime());
      const diagnostic = await (coordinator as unknown as import('./budget-coordinator-do-runtime-entry').BudgetCoordinatorDiagnosticDO).reconcileDiagnostic({ tenantId: 'tenant-a', reservationId: grant.reservationId, holderId: grant.holderId,
        expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7 + cycle, expectedRestrictionRevision: 3, terminalEvidenceId: `terminal-${cycle}`,
        measured: { workerRequests: 1 }, uncertain: {}, now: NOW, certifiedClosure: { operationSetFingerprint: `set-${cycle}`, expiresAt: grant.expiresAt } });
      if (diagnostic.error) {
        assert.match(diagnostic.error, /metadata.*capacity exhausted/);
        assert.equal(JSON.stringify(await coordinator.inspectForTrustedRuntime()), lastCommitted);
        break;
      }
      assert.equal(diagnostic.outcome, 'reconciled');
      completed++;
    }
    const state = await coordinator.inspectForTrustedRuntime();
    assert.ok(completed > 2 && completed < 256, 'physical byte bound rejects before the 256-allocation ceiling');
    assert.ok(state.tenantStates[0].allocations.length <= 256);
    assert.equal(state.tenantStates[0].closedCharges.length, completed);
    assert.equal(state.tenantStates[0].closedCharges.reduce((sum, row) => sum + row.units, 0), completed);
    const stored = await diagnosticCoordinator.inspectStoredValueForTest();
    assert.equal(stored.kind, 'utf8', 'historic object and string state is read and upgraded under the same key');
    assert.ok(stored.bytes > 0 && stored.bytes <= 120 * 1_024, 'actual UTF-8 persisted value remains below the physical ceiling');
    console.log('metadata-bound-evidence', { completed, storedBytes: stored.bytes });
    await coordinator.refreshFromTrustedAuthority(snapshot(256, NOW + 3_600_001));
    const next = await coordinator.inspectForTrustedRuntime();
    assert.ok(next.tenantStates[0].allocations.length <= 2);
    assert.equal(next.tenantStates[0].closedCharges.length, 0, 'only the expired interval rolls over');
    assert.ok(next.tenantStates[0].grants.every(grant => !grant.compacted), 'only certified completion records retire after their retry horizon');
    assert.equal(next.tenantStates[0].grants.length, state.tenantStates[0].grants.filter(grant => !grant.compacted).length, 'unknown work remains detailed and charged');
    assert.ok(next.ownerAllocations.length <= 2);
  } finally { await mf.dispose(); }
});
