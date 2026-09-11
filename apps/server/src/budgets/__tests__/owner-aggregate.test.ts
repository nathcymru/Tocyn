import { describe, expect, it } from 'vitest';
import type { CostPolicy, EffectiveTenantCostPolicy, ResourceAmounts } from '@luminatick/shared';
import {
  createBudgetOwnerAggregateState,
  handoffOwnerIngress,
  refreshBudgetOwnerAggregateAuthority,
  reconcileOwnerAggregate,
  reserveOwnerAggregate,
  reserveOwnerIngress,
  type TrustedBudgetCoordinatorAuthority,
} from '../owner-aggregate';

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

function authority(maxReservations = 64): TrustedBudgetCoordinatorAuthority {
  return {
    aggregateId: 'server-derived-owner-aggregate', ownerPolicy: ownerPolicy(), authorityCheckedAt: NOW, authorityRevision: 1, authorityExpiresAt: NOW + 30_000, maxReservations,
    tenantAllocations: [
      { reservationNamespace: 'server-issued-reservation-a', effectivePolicy: tenantPolicy('tenant-a') },
      { reservationNamespace: 'server-issued-reservation-b', effectivePolicy: tenantPolicy('tenant-b') },
    ],
  };
}

function reserve(tenantId: string, holderId: string, idempotencyKey: string, units: number, now = NOW) {
  return { tenantId, holderId, idempotencyKey, expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, purpose: 'new-work' as const, envelope: { workerRequests: units } satisfies ResourceAmounts, now };
}

function reserveIngress(holderId: string, idempotencyKey: string, units: number, purpose: 'new-work' | 'recovery' = 'new-work') {
  return { holderId, idempotencyKey, expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7,
    purpose, envelope: { workerRequests: units } satisfies ResourceAmounts, now: NOW };
}

describe('owner aggregate budget state', () => {
  it('does not duplicate the owner new-work ceiling for two tenant allocations', () => {
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority()), reserve('tenant-a', 'holder-a', 'grant-a', 50));
    expect(first.outcome.status).toBe('granted');
    expect(reserveOwnerAggregate(first.state, reserve('tenant-b', 'holder-b', 'grant-b', 50)).outcome).toEqual({ status: 'rejected', reason: 'exhausted' });
  });

  it('shares the exact owner partition between ingress and tenant grants', () => {
    const ingress = reserveOwnerIngress(createBudgetOwnerAggregateState(authority()), reserveIngress('ingress-a', 'request-a', 30));
    expect(ingress.outcome.status).toBe('granted');
    expect(reserveOwnerAggregate(ingress.state, reserve('tenant-a', 'holder-a', 'tenant-a', 51)).outcome)
      .toEqual({ status: 'rejected', reason: 'exhausted' });
    expect(reserveOwnerAggregate(ingress.state, reserve('tenant-a', 'holder-a', 'tenant-a', 50)).outcome.status).toBe('granted');
  });

  it('keeps owner ingress recovery inside the existing recovery partition', () => {
    const recovery = reserveOwnerIngress(createBudgetOwnerAggregateState(authority()), reserveIngress('ingress-recovery', 'recovery-a', 20, 'recovery'));
    expect(recovery.outcome.status).toBe('granted');
    expect(reserveOwnerIngress(recovery.state, reserveIngress('ingress-recovery-b', 'recovery-b', 1, 'recovery')).outcome)
      .toEqual({ status: 'rejected', reason: 'exhausted' });
    expect(reserveOwnerIngress(recovery.state, reserveIngress('ingress-new-work', 'new-work-a', 1)).outcome.status).toBe('granted');
  });

  it('hands an admitted recovery execution to the verified tenant recovery partition', () => {
    const ingress = reserveOwnerIngress(createBudgetOwnerAggregateState(authority()), reserveIngress('recovery-handoff', 'recovery-transfer', 10, 'recovery'));
    const reservation = ingress.outcome.reservation!;
    const handed = handoffOwnerIngress(ingress.state, {
      tenantId: 'tenant-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, now: NOW + 1,
      ownerClosure: { reservationId: reservation.reservationId, holderId: reservation.holderId,
        expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, terminalEvidenceId: 'recovery-handoff-terminal',
        measured: {}, uncertain: {}, now: NOW + 1,
        certifiedClosure: { operationSetFingerprint: 'recovery-handed-to-tenant', expiresAt: reservation.expiresAt } },
    });
    expect(handed.outcome).toEqual({ status: 'handed-off' });
    expect(handed.state.tenantStates[0].closedCharges).toContainEqual(expect.objectContaining({ purpose: 'recovery', units: 10 }));
  });

  it('bounds ingress acknowledgement replay and retains an unclosed charge', () => {
    const first = reserveOwnerIngress(createBudgetOwnerAggregateState(authority()), reserveIngress('ingress-lost', 'lost-ack', 10));
    const second = reserveOwnerIngress(first.state, reserveIngress('ingress-lost', 'lost-ack', 10));
    const third = reserveOwnerIngress(second.state, reserveIngress('ingress-lost', 'lost-ack', 10));
    expect(first.outcome.status).toBe('granted');
    expect(second.outcome.status).toBe('idempotent');
    expect(third.outcome).toEqual({ status: 'rejected', reason: 'delivery-exhausted' });
    expect(third.state.ownerIngress.grants[0].accounted).toEqual({ workerRequests: 10 });
  });

  it('atomically transfers ingress into a tenant grant without a temporary double charge', () => {
    const ingress = reserveOwnerIngress(createBudgetOwnerAggregateState(authority()), reserveIngress('ingress-handoff', 'handoff-a', 20));
    const reservation = ingress.outcome.reservation!;
    // Charging the 20-unit ingress envelope a second time inside the business
    // reservation would reject this otherwise valid 44-unit operation.
    expect(reserveOwnerAggregate(ingress.state, reserve('tenant-a', 'without-handoff', 'tenant-work-no-handoff', 64)).outcome)
      .toEqual({ status: 'rejected', reason: 'exhausted' });
    const handed = handoffOwnerIngress(ingress.state, {
      tenantId: 'tenant-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, now: NOW + 1,
      ownerClosure: {
        reservationId: reservation.reservationId, holderId: reservation.holderId,
        expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7,
        terminalEvidenceId: 'ingress-handoff-terminal', measured: {}, uncertain: {}, now: NOW + 1,
        certifiedClosure: { operationSetFingerprint: 'one-request-handed-to-tenant', expiresAt: reservation.expiresAt },
      },
    });
    expect(handed.outcome).toEqual({ status: 'handed-off' });
    expect(handed.state.ownerIngress.grants.filter(grant => !grant.compacted)).toHaveLength(0);
    expect(handed.state.tenantStates.find(item => item.tenantId === 'tenant-a')?.closedCharges).toContainEqual(
      expect.objectContaining({ dimension: 'workerRequests', units: 20 }),
    );
    expect(handoffOwnerIngress(handed.state, {
      tenantId: 'tenant-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, now: NOW + 1,
      ownerClosure: {
        reservationId: reservation.reservationId, holderId: reservation.holderId,
        expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7,
        terminalEvidenceId: 'ingress-handoff-terminal', measured: {}, uncertain: {}, now: NOW + 1,
        certifiedClosure: { operationSetFingerprint: 'one-request-handed-to-tenant', expiresAt: reservation.expiresAt },
      },
    }).outcome).toEqual({ status: 'already-handed-off' });
    const tenant = reserveOwnerAggregate(handed.state, reserve('tenant-a', 'tenant-holder', 'tenant-work', 44));
    expect(tenant.outcome.status).toBe('granted');
    expect(reserveOwnerAggregate(tenant.state, reserve('tenant-b', 'tenant-holder-b', 'remaining-owner-capacity', 16)).outcome.status).toBe('granted');
    expect(reserveOwnerAggregate(tenant.state, reserve('tenant-b', 'tenant-holder-c', 'owner-overrun', 17)).outcome)
      .toEqual({ status: 'rejected', reason: 'exhausted' });
  });

  it('keeps an expired grant charged until trusted terminal evidence changes it', () => {
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority()), reserve('tenant-a', 'holder-a', 'grant-a', 50));
    expect(first.outcome.reservation?.expiresAt).toBe(NOW + 30_000);
    const refreshed = refreshBudgetOwnerAggregateAuthority(first.state, {
      ...authority(), authorityCheckedAt: NOW + 30_000, authorityExpiresAt: NOW + 60_000,
    });
    const afterExpiry = reserveOwnerAggregate(refreshed, reserve('tenant-b', 'holder-b', 'grant-b', 40, NOW + 30_000));
    expect(afterExpiry.outcome).toEqual({ status: 'rejected', reason: 'exhausted' });
    expect(afterExpiry.state.tenantStates.find(tenant => tenant.tenantId === 'tenant-a')?.grants[0]?.accounted).toEqual({ workerRequests: 50 });
  });

  it('blocks the shared aggregate after a measured overrun instead of clamping it', () => {
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority()), reserve('tenant-a', 'holder-a', 'grant-a', 10));
    const reservation = first.outcome.reservation;
    expect(reservation).toBeDefined();
    const reconciled = reconcileOwnerAggregate(first.state, {
      tenantId: 'tenant-a', reservationId: reservation!.reservationId, holderId: 'holder-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3,
      terminalEvidenceId: 'trusted-terminal-evidence-1', measured: { workerRequests: 11 }, uncertain: {}, now: NOW + 1,
    });
    expect(reconciled.outcome).toBe('capacity-defect');
    expect(reserveOwnerAggregate(reconciled.state, reserve('tenant-b', 'holder-b', 'grant-b', 1)).outcome).toEqual({ status: 'rejected', reason: 'capacity-defect' });
  });

  it('bounds retained grants across all tenant allocations', () => {
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority(2)), reserve('tenant-a', 'holder-a', 'grant-a', 1));
    expect(reserveOwnerAggregate(first.state, reserve('tenant-b', 'holder-b', 'grant-b', 1)).outcome).toEqual({ status: 'rejected', reason: 'capacity-exhausted' });
  });

  it('counts compacted certified charges across tenants without retaining a permanent reservation slot', () => {
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority(2)), reserve('tenant-a', 'holder-a', 'grant-a', 50));
    const grant = first.outcome.reservation!;
    const reconciled = reconcileOwnerAggregate(first.state, {
      tenantId: 'tenant-a', reservationId: grant.reservationId, holderId: 'holder-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7,
      expectedRestrictionRevision: 3, terminalEvidenceId: 'certified-owner-terminal', measured: { workerRequests: 30 }, uncertain: {}, now: NOW + 1,
      certifiedClosure: { operationSetFingerprint: 'synthetic-owner-closure', expiresAt: grant.expiresAt },
    });
    expect(reconciled.outcome).toBe('reconciled');
    expect(reconciled.state.tenantStates.find(tenant => tenant.tenantId === 'tenant-a')?.grants.filter(grant => !grant.compacted)).toHaveLength(0);
    expect(reserveOwnerAggregate(reconciled.state, reserve('tenant-b', 'holder-b', 'grant-b', 50)).outcome.status).toBe('granted');
    expect(reserveOwnerAggregate(reconciled.state, reserve('tenant-b', 'holder-b', 'owner-charge-not-reset', 71)).outcome).toEqual({ status: 'rejected', reason: 'exhausted' });
  });

  it('retains closed stock charges across grant expiry and owner allocation replacement', () => {
    const configured = authority(2);
    const budgets: CostPolicy['budgets'] = [{ dimension: 'r2StorageBytes', allocationId: 'stock-original', window: { kind: 'stock', id: 'stock' },
      limit: 100, recoveryPercent: 20, provenance: 'owner-allocation' }];
    const stock = { ...configured, ownerPolicy: { ...configured.ownerPolicy, budgets },
      tenantAllocations: configured.tenantAllocations.map(tenant => ({ ...tenant, effectivePolicy: { ...tenant.effectivePolicy, budgets } })) };
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(stock), { ...reserve('tenant-a', 'holder-stock', 'stock-a', 1), envelope: { r2StorageBytes: 50 } });
    const grant = first.outcome.reservation!;
    const closed = reconcileOwnerAggregate(first.state, { tenantId: 'tenant-a', reservationId: grant.reservationId, holderId: grant.holderId,
      expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, terminalEvidenceId: 'stock-terminal',
      measured: { r2StorageBytes: 30 }, uncertain: { r2StorageBytes: 10 }, now: NOW + 1,
      certifiedClosure: { operationSetFingerprint: 'stock-set', expiresAt: grant.expiresAt } });
    expect(closed.outcome).toBe('reconciled');
    const replacement = budgets.map(budget => ({ ...budget, allocationId: 'stock-replacement' }));
    const next = refreshBudgetOwnerAggregateAuthority(closed.state, { ...stock, authorityRevision: 2,
      authorityCheckedAt: NOW + 30_001, authorityExpiresAt: NOW + 60_000, ownerPolicy: { ...stock.ownerPolicy, revision: 8, budgets: replacement },
      tenantAllocations: stock.tenantAllocations.map(tenant => ({ ...tenant, effectivePolicy: { ...tenant.effectivePolicy, revision: 8, budgets: replacement } })) });
    expect(next.tenantStates[0].grants).toHaveLength(0);
    expect(next.tenantStates[0].closedCharges[0].units).toBe(40);
    const request = { ...reserve('tenant-b', 'holder-next', 'stock-next', 1, NOW + 30_001), expectedPolicyRevision: 8, envelope: { r2StorageBytes: 41 } };
    expect(reserveOwnerAggregate(next, request).outcome).toMatchObject({ status: 'rejected', reason: 'exhausted' });
    expect(reserveOwnerAggregate(next, { ...request, envelope: { r2StorageBytes: 40 } }).outcome.status).toBe('granted');
  });

  it('preserves an owner-approved tenant aggressive restriction without changing shared capacity', () => {
    const configured = authority();
    const tenant = configured.tenantAllocations[1];
    const state = createBudgetOwnerAggregateState({
      ...configured,
      tenantAllocations: [configured.tenantAllocations[0], {
        ...tenant,
        effectivePolicy: { ...tenant.effectivePolicy, mode: 'aggressive' },
      }],
    });
    expect(state.tenantStates.find(candidate => candidate.tenantId === 'tenant-b')?.policyRevision).toBe(7);
  });

  it('transitions a newer lower policy without releasing an outstanding owner charge', () => {
    const initial = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority()), reserve('tenant-a', 'holder-a', 'grant-a', 50));
    const nextOwner = { ...ownerPolicy(), revision: 8 };
    const next = refreshBudgetOwnerAggregateAuthority(initial.state, {
      ...authority(), ownerPolicy: nextOwner, authorityRevision: 2, authorityCheckedAt: NOW + 1, authorityExpiresAt: NOW + 30_001,
      tenantAllocations: [
        { reservationNamespace: 'server-issued-reservation-a', effectivePolicy: { ...tenantPolicy('tenant-a'), ...nextOwner, restrictionRevision: 4, budgets: [{ ...nextOwner.budgets[0], limit: 60 }] } },
        { reservationNamespace: 'server-issued-reservation-b', effectivePolicy: { ...tenantPolicy('tenant-b'), ...nextOwner, restrictionRevision: 4, budgets: [{ ...nextOwner.budgets[0], limit: 60 }] } },
      ],
    });
    expect(next.tenantStates.find(tenant => tenant.tenantId === 'tenant-a')?.grants[0]?.status).toBe('uncertain');
    expect(next.tenantStates.find(tenant => tenant.tenantId === 'tenant-a')?.grants[0]?.accounted).toEqual({ workerRequests: 50 });
    expect(reserveOwnerAggregate(next, {
      tenantId: 'tenant-b', holderId: 'holder-b', idempotencyKey: 'after-lower', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 8, expectedRestrictionRevision: 4,
      purpose: 'new-work', envelope: { workerRequests: 31 }, now: NOW + 1,
    }).outcome).toEqual({ status: 'rejected', reason: 'exhausted' });
  });
});
