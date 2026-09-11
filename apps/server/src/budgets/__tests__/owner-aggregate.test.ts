import { describe, expect, it } from 'vitest';
import type { CostPolicy, EffectiveTenantCostPolicy, ResourceAmounts } from '@luminatick/shared';
import {
  createBudgetOwnerAggregateState,
  refreshBudgetOwnerAggregateAuthority,
  reconcileOwnerAggregate,
  reserveOwnerAggregate,
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

describe('owner aggregate budget state', () => {
  it('does not duplicate the owner new-work ceiling for two tenant allocations', () => {
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority()), reserve('tenant-a', 'holder-a', 'grant-a', 50));
    expect(first.outcome.status).toBe('granted');
    expect(reserveOwnerAggregate(first.state, reserve('tenant-b', 'holder-b', 'grant-b', 50)).outcome).toEqual({ status: 'rejected', reason: 'exhausted' });
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
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority(1)), reserve('tenant-a', 'holder-a', 'grant-a', 1));
    expect(reserveOwnerAggregate(first.state, reserve('tenant-b', 'holder-b', 'grant-b', 1)).outcome).toEqual({ status: 'rejected', reason: 'capacity-exhausted' });
  });

  it('counts compacted certified charges across tenants without retaining a permanent reservation slot', () => {
    const first = reserveOwnerAggregate(createBudgetOwnerAggregateState(authority(1)), reserve('tenant-a', 'holder-a', 'grant-a', 50));
    const grant = first.outcome.reservation!;
    const reconciled = reconcileOwnerAggregate(first.state, {
      tenantId: 'tenant-a', reservationId: grant.reservationId, holderId: 'holder-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7,
      expectedRestrictionRevision: 3, terminalEvidenceId: 'certified-owner-terminal', measured: { workerRequests: 30 }, uncertain: {}, now: NOW + 1,
      certifiedClosure: { operationSetFingerprint: 'synthetic-owner-closure', expiresAt: grant.expiresAt },
    });
    expect(reconciled.outcome).toBe('reconciled');
    expect(reconciled.state.tenantStates.find(tenant => tenant.tenantId === 'tenant-a')?.grants).toHaveLength(0);
    expect(reserveOwnerAggregate(reconciled.state, reserve('tenant-b', 'holder-b', 'grant-b', 50)).outcome.status).toBe('granted');
    expect(reserveOwnerAggregate(reconciled.state, reserve('tenant-b', 'holder-b', 'owner-charge-not-reset', 71)).outcome).toEqual({ status: 'rejected', reason: 'exhausted' });
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
