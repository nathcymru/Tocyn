import { describe, expect, it } from 'vitest';
import type { EffectiveTenantCostPolicy } from '@luminatick/shared';
import { applyTrustedCoordinatorAuthority, consumeBudgetGrant, createBudgetCoordinatorState, expireBudgetGrants, markBudgetGrantUncertain, reconcileBudgetGrant, reserveBudgetGrant } from '../coordinator-state';

function policy(revision = 3, restrictionRevision = 2, limit = 100): EffectiveTenantCostPolicy {
  return {
    schemaVersion: 1, policyId: 'owner-policy', revision, deploymentId: 'synthetic', tenantId: 'tenant-a', restrictionRevision,
    disabledFeatures: [], mode: 'conservative', catalogueVersion: 'cf-2026-09-10', maxGrantLifetimeMs: 10,
    budgets: [{ dimension: 'queueOperations', allocationId: 'queue-a', window: { kind: 'interval', id: `window-${revision}`, startsAt: 0, endsAt: 100 }, limit, recoveryPercent: 20, provenance: 'owner-allocation' }],
  };
}

function initial() {
  return createBudgetCoordinatorState({ coordinatorId: 'budget-do-tenant-a', maxReservations: 8, authority: { effectivePolicy: policy(), authorityCheckedAt: 0 } });
}

function reserve(state = initial(), holderId = 'holder-a', idempotencyKey = 'key-a', purpose: 'new-work' | 'recovery' = 'new-work', envelope = { queueOperations: 40 }, now = 1) {
  return reserveBudgetGrant(state, { holderId, idempotencyKey, expectedPolicyId: 'owner-policy', expectedPolicyRevision: state.policyRevision, expectedRestrictionRevision: state.restrictionRevision, purpose, envelope, now });
}

describe('budget coordinator pure state', () => {
  it('creates serializable unique-holder grants and durably decrements their warm-path balance', () => {
    const granted = reserve();
    expect(granted.outcome.status).toBe('granted');
    const grant = granted.outcome.reservation!;
    expect(grant.reservationId).toBe('budget-do-tenant-a:1');
    expect(JSON.parse(JSON.stringify(granted.state))).toMatchObject({ tenantId: 'tenant-a', policyId: 'owner-policy' });
    expect(consumeBudgetGrant(granted.state, { reservationId: grant.reservationId, holderId: 'holder-b', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, envelope: { queueOperations: 1 }, now: 2 }).consumed).toBe(false);
    const consumed = consumeBudgetGrant(granted.state, { reservationId: grant.reservationId, holderId: 'holder-a', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, envelope: { queueOperations: 40 }, now: 2 });
    expect(consumed.consumed).toBe(true);
    expect(consumed.state.grants[0]).toMatchObject({ status: 'consumed', remaining: {} });
  });

  it('rejects composite-key controls, non-integer amounts, and an unbounded state limit', () => {
    expect(() => reserve(initial(), 'holder-a\u0000other')).toThrow(/control characters/);
    expect(() => reserve(initial(), 'holder-a', 'key-a\u0000other')).toThrow(/control characters/);
    expect(() => reserve(initial(), 'holder-a', 'fraction', 'new-work', { queueOperations: 0.5 })).toThrow(/invalid resource amount/);
    expect(() => createBudgetCoordinatorState({ coordinatorId: 'budget-do-tenant-a', maxReservations: 4_097, authority: { effectivePolicy: policy(), authorityCheckedAt: 0 } })).toThrow(/1 to 4096/);
  });

  it('shortens a grant to the earliest active interval boundary', () => {
    const shortWindowPolicy = policy();
    shortWindowPolicy.budgets[0].window = { kind: 'interval', id: 'short', startsAt: 0, endsAt: 5 };
    const state = createBudgetCoordinatorState({ coordinatorId: 'budget-do-tenant-a', maxReservations: 8, authority: { effectivePolicy: shortWindowPolicy, authorityCheckedAt: 0 } });
    const granted = reserve(state, 'holder-a', 'short-window', 'new-work', { queueOperations: 1 }, 1);
    expect(granted.outcome.reservation?.expiresAt).toBe(5);
    expect(reserve(state, 'holder-a', 'outside-window', 'new-work', { queueOperations: 1 }, 5).outcome).toMatchObject({ reason: 'exhausted' });
  });

  it('is all-or-nothing, permits one durable holder recovery, and never borrows recovery credits', () => {
    const granted = reserve();
    const replay = reserve(granted.state);
    expect(replay.outcome.status).toBe('idempotent');
    expect(replay.state.grants).toHaveLength(1);
    expect(replay.outcome.reservation?.holderSeedAttempts).toBe(2);
    const exhaustedDelivery = reserve(replay.state);
    expect(exhaustedDelivery.outcome).toMatchObject({ status: 'rejected', reason: 'delivery-exhausted' });
    expect(exhaustedDelivery.state.grants[0].holderSeedAttempts).toBe(2);
    expect(() => reserve(granted.state, 'holder-a', 'key-a', 'new-work', { queueOperations: 41 })).toThrow(/different envelope/);
    expect(reserve(initial(), 'holder-a', 'new-work-too-large', 'new-work', { queueOperations: 81 }).outcome).toMatchObject({ status: 'rejected', reason: 'exhausted' });
    expect(reserve(initial(), 'holder-a', 'recovery', 'recovery', { queueOperations: 20 }).outcome.status).toBe('granted');
  });

  it('fences policy and restriction revisions, keeping stale credits charged and unspendable', () => {
    const granted = reserve();
    const nextPolicy = policy(4, 3, 50);
    nextPolicy.budgets[0].window = { kind: 'interval', id: 'window-3', startsAt: 0, endsAt: 100 };
    const revised = applyTrustedCoordinatorAuthority(granted.state, { effectivePolicy: nextPolicy, authorityCheckedAt: 3 });
    expect(revised.grants[0].status).toBe('uncertain');
    expect(consumeBudgetGrant(revised, { reservationId: granted.outcome.reservation!.reservationId, holderId: 'holder-a', expectedPolicyRevision: 4, expectedRestrictionRevision: 3, envelope: { queueOperations: 1 }, now: 4 }).consumed).toBe(false);
    expect(reserveBudgetGrant(revised, { holderId: 'holder-a', idempotencyKey: 'old-revision', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, purpose: 'new-work', envelope: { queueOperations: 1 }, now: 4 }).outcome).toMatchObject({ reason: 'stale-policy' });
    expect(reserve(revised, 'holder-a', 'new-revision', 'new-work', { queueOperations: 11 }, 4).outcome).toMatchObject({ reason: 'exhausted' });
  });

  it('keeps expired or lost grants charged until matching terminal evidence reconciles them', () => {
    const granted = reserve(initial(), 'holder-a', 'expired', 'new-work', { queueOperations: 80 });
    const expired = expireBudgetGrants(granted.state, 11);
    expect(expired.grants[0].status).toBe('uncertain');
    expect(reserve(expired, 'holder-b', 'blocked', 'new-work', { queueOperations: 1 }, 12).outcome).toMatchObject({ reason: 'exhausted' });
    const reconciled = reconcileBudgetGrant(expired, { reservationId: expired.grants[0].reservationId, holderId: 'holder-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, terminalEvidenceId: 'terminal-a', measured: { queueOperations: 30 }, uncertain: {}, now: 12 });
    expect(reconciled.outcome).toBe('reconciled');
    expect(reconcileBudgetGrant(reconciled.state, { reservationId: expired.grants[0].reservationId, holderId: 'holder-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, terminalEvidenceId: 'terminal-a', measured: { queueOperations: 30 }, uncertain: {}, now: 12 }).outcome).toBe('already-reconciled');
    expect(reconcileBudgetGrant(reconciled.state, { reservationId: expired.grants[0].reservationId, holderId: 'holder-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, terminalEvidenceId: 'terminal-a', measured: { queueOperations: 31 }, uncertain: {}, now: 12 }).outcome).toBe('rejected');
    expect(reserve(reconciled.state, 'holder-b', 'released', 'new-work', { queueOperations: 50 }, 12).outcome.status).toBe('granted');
    expect(markBudgetGrantUncertain(reconciled.state, expired.grants[0].reservationId, 'holder-b', 12).marked).toBe(false);
  });

  it('does not return consumed credits or reservation capacity merely because their grant expires', () => {
    const granted = reserve(initial(), 'holder-a', 'consumed-expiry', 'new-work', { queueOperations: 80 });
    const consumed = consumeBudgetGrant(granted.state, { reservationId: granted.outcome.reservation!.reservationId, holderId: 'holder-a', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, envelope: { queueOperations: 80 }, now: 2 });
    const expired = expireBudgetGrants(consumed.state, 11);
    expect(expired.grants[0].status).toBe('consumed');
    expect(reserve(expired, 'holder-b', 'not-reissued', 'new-work', { queueOperations: 1 }, 12).outcome).toMatchObject({ reason: 'exhausted' });
    expect(expired.grants).toHaveLength(1);
    const capped = createBudgetCoordinatorState({ coordinatorId: 'budget-do-tenant-a', maxReservations: 1, authority: { effectivePolicy: policy(), authorityCheckedAt: 0 } });
    const cappedGrant = reserve(capped, 'holder-a', 'capped-consumed', 'new-work', { queueOperations: 1 });
    const cappedConsumed = consumeBudgetGrant(cappedGrant.state, { reservationId: cappedGrant.outcome.reservation!.reservationId, holderId: 'holder-a', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, envelope: { queueOperations: 1 }, now: 2 });
    const cappedExpired = expireBudgetGrants(cappedConsumed.state, 11);
    expect(reserve(cappedExpired, 'holder-b', 'capacity-not-returned', 'new-work', { queueOperations: 1 }, 12).outcome).toMatchObject({ reason: 'capacity-exhausted' });
  });

  it('rejects partial envelopes and preserves uncertainty in reconciliation', () => {
    const granted = reserve(initial(), 'holder-a', 'multi', 'new-work', { queueOperations: 40 });
    expect(reserve(granted.state, 'holder-b', 'next', 'new-work', { workerRequests: 1 }).outcome).toMatchObject({ reason: 'exhausted' });
    const uncertain = markBudgetGrantUncertain(granted.state, granted.outcome.reservation!.reservationId, 'holder-a', 2);
    const reconciled = reconcileBudgetGrant(uncertain.state, { reservationId: granted.outcome.reservation!.reservationId, holderId: 'holder-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, terminalEvidenceId: 'uncertain-terminal', measured: { queueOperations: 5 }, uncertain: { queueOperations: 35 }, now: 3 });
    expect(reconciled.outcome).toBe('reconciled');
    expect(reserve(reconciled.state, 'holder-b', 'still-held', 'new-work', { queueOperations: 46 }, 3).outcome).toMatchObject({ reason: 'exhausted' });
  });

  it('records measured overrun without clamping it and blocks further admission', () => {
    const granted = reserve(initial(), 'holder-a', 'overrun', 'new-work', { queueOperations: 10 });
    const reconciled = reconcileBudgetGrant(granted.state, { reservationId: granted.outcome.reservation!.reservationId, holderId: 'holder-a', expectedPolicyId: 'owner-policy', expectedPolicyRevision: 3, expectedRestrictionRevision: 2, terminalEvidenceId: 'overrun-terminal', measured: { queueOperations: 11 }, uncertain: {}, now: 2 });
    expect(reconciled.outcome).toBe('capacity-defect');
    expect(reconciled.state.capacityDefects[0]).toMatchObject({ overrun: { queueOperations: 1 } });
    expect(reconciled.state.grants[0].accounted).toEqual({ queueOperations: 11 });
    expect(reserve(reconciled.state, 'holder-b', 'blocked-by-defect', 'new-work', { queueOperations: 1 }, 3).outcome).toMatchObject({ reason: 'capacity-defect' });
  });
});
