import { describe, expect, it } from 'vitest';
import { costPolicySchema, defaultTenantRestriction, effectiveTenantPolicy, optionalAiFeatures,
  partitionBudget, sumResourceEnvelopes, validateSpendableReservation } from '../utils/cost-policy';

const owner = () => ({ schemaVersion: 1, policyId: 'owner-allocation-a', revision: 3,
  deploymentId: 'synthetic', mode: 'conservative', catalogueVersion: 'cf-2026-09-10',
  maxGrantLifetimeMs: 30_000, budgets: [{ dimension: 'queueOperations', allocationId: 'queue-a',
    window: { kind: 'interval', id: '2026-09-10', startsAt: 100, endsAt: 200 },
    limit: 100, recoveryPercent: 20, provenance: 'owner-allocation' }] });
const restriction = () => defaultTenantRestriction(owner(), 'tenant-a');
const reservation = () => ({ schemaVersion: 1, reservationId: 'grant-a', tenantId: 'tenant-a',
  holderId: 'holder-a', policyId: 'owner-allocation-a', policyRevision: 3, restrictionRevision: 1,
  purpose: 'new-work', createdAt: 100, expiresAt: 200, state: 'reserved',
  grants: [{ dimension: 'queueOperations', allocationId: 'queue-a', windowId: '2026-09-10', units: 80 }] });

describe('cost policy contracts', () => {
  it('defaults owner mode and recovery share conservatively', () => {
    const input = owner();
    const parsed = costPolicySchema.parse({ ...input, mode: undefined,
      budgets: [{ ...input.budgets[0], recoveryPercent: undefined }] });
    expect(parsed.mode).toBe('conservative');
    expect(parsed.budgets[0].recoveryPercent).toBe(20);
  });
  it('fences grants at the half-open window boundary and preserves recovery allocation', () => {
    const policy = effectiveTenantPolicy(owner(), restriction(), 'tenant-a');
    expect(validateSpendableReservation(reservation(), policy, 'holder-a', 199).reservationId).toBe('grant-a');
    expect(() => validateSpendableReservation(reservation(), policy, 'holder-a', 200)).toThrow();
    const recovery = { ...reservation(), purpose: 'recovery', grants: [{ ...reservation().grants[0], units: 20 }] };
    expect(validateSpendableReservation(recovery, policy, 'holder-a', 100).purpose).toBe('recovery');
    expect(() => validateSpendableReservation({ ...recovery, grants: [{ ...recovery.grants[0], units: 21 }] }, policy, 'holder-a', 100)).toThrow();
  });
  it.each([
    { tenantId: 'tenant-b' }, { holderId: 'holder-b' }, { policyRevision: 2 },
    { restrictionRevision: 2 }, { policyId: 'other' }, { state: 'uncertain' },
    { state: 'consumed' }, { createdAt: 101 }, { expiresAt: 201 },
    { grants: [] }, { grants: [reservation().grants[0], reservation().grants[0]] },
    { grants: [{ ...reservation().grants[0], units: 81 }] },
    { grants: [{ ...reservation().grants[0], windowId: 'tomorrow' }] },
    { grants: [{ ...reservation().grants[0], allocationId: 'other-tenant' }] },
  ])('rejects unusable or mis-scoped durable grant %j', patch => {
    const policy = effectiveTenantPolicy(owner(), restriction(), 'tenant-a');
    expect(() => validateSpendableReservation({ ...reservation(), ...patch }, policy, 'holder-a', 100)).toThrow();
  });
  it('keeps immutable owner allocation while deriving only lower tenant limits', () => {
    const original = owner();
    const effective = effectiveTenantPolicy(original, { ...restriction(), limits: { queueOperations: 30 } }, 'tenant-a');
    expect(effective.budgets[0].limit).toBe(30);
    expect(original.budgets[0].limit).toBe(100);
    expect(partitionBudget(30)).toEqual({ newWork: 24, recovery: 6 });
  });
  it.each([
    { tenantId: 'tenant-b' }, { ownerPolicyId: 'other' }, { ownerPolicyRevision: 2 },
    { limits: { queueOperations: 101 } }, { limits: { workerRequests: 1 } },
    { limits: { queueOperations: -1 } }, { limits: { queueOperations: .5 } },
    { limits: { queueOperations: Infinity } }, { limits: { queueOperations: NaN } },
    { limits: { queueOperations: Number.MAX_SAFE_INTEGER + 1 } }, { schemaVersion: 2 },
    { recoveryPercent: 0 }, { limits: { inventedResource: 1 } },
  ])('rejects malformed, cross-tenant or escalated restriction %j', patch => {
    expect(() => effectiveTenantPolicy(owner(), { ...restriction(), ...patch }, 'tenant-a')).toThrow();
  });
  it('does not let a tenant undo the owner aggressive mode', () => {
    expect(() => effectiveTenantPolicy({ ...owner(), mode: 'aggressive' }, restriction(), 'tenant-a')).toThrow();
    expect(effectiveTenantPolicy(owner(), { ...restriction(), mode: 'aggressive' }, 'tenant-a').mode).toBe('aggressive');
  });
  it('retains tenant feature restrictions and their revision in the effective policy', () => {
    const input = { ...restriction(), revision: 7, disabledFeatures: ['email', 'email', 'ai-enrichment'] };
    const effective = effectiveTenantPolicy(owner(), input, 'tenant-a');
    expect(effective.tenantId).toBe('tenant-a');
    expect(effective.restrictionRevision).toBe(7);
    expect(effective.disabledFeatures).toEqual(['email', 'ai-enrichment']);
    effective.disabledFeatures.push('other');
    expect(input.disabledFeatures).toEqual(['email', 'email', 'ai-enrichment']);
  });
  it('does not silently omit malformed or ambiguous resource windows', () => {
    const p = owner();
    expect(costPolicySchema.safeParse({ ...p, budgets: [p.budgets[0], p.budgets[0]] }).success).toBe(false);
    expect(costPolicySchema.safeParse({ ...p, budgets: [{ ...p.budgets[0], window: { kind: 'interval', id: 'x', startsAt: 200, endsAt: 200 } }] }).success).toBe(false);
    expect(costPolicySchema.safeParse({ ...p, budgets: [{ ...p.budgets[0], window: { kind: 'stock', id: 'storage' } }] }).success).toBe(false);
    expect(costPolicySchema.safeParse({ ...p, budgets: [{ ...p.budgets[0], dimension: 'd1StorageBytes', window: { kind: 'stock', id: 'storage' } }] }).success).toBe(true);
    expect(costPolicySchema.safeParse({ ...p, budgets: [{ ...p.budgets[0], dimension: 'd1StorageBytes' }] }).success).toBe(false);
  });
  it('preserves the reserve for tiny and maximum safe integer ceilings', () => {
    for (const ceiling of [0, 1, 2, 4, 5, 99, 100, Number.MAX_SAFE_INTEGER]) {
      const split = partitionBudget(ceiling);
      expect(BigInt(split.newWork) + BigInt(split.recovery)).toBe(BigInt(ceiling));
      expect(BigInt(split.newWork) * 100n <= BigInt(ceiling) * 80n).toBe(true);
    }
    expect(() => partitionBudget(10, 101)).toThrow();
  });
  it('accounts retry envelopes without overflow or unknown dimensions', () => {
    expect(sumResourceEnvelopes({ queueOperations: 3 }, { queueOperations: 2, d1RowsWritten: 4 })).toEqual({ queueOperations: 5, d1RowsWritten: 4 });
    expect(() => sumResourceEnvelopes({ queueOperations: Number.MAX_SAFE_INTEGER }, { queueOperations: 1 })).toThrow();
  });
  it('sheds gratitude before other optional enrichment', () => {
    expect(optionalAiFeatures('conservative', 'normal')).toEqual({ gratitude: true, enrichment: true });
    expect(optionalAiFeatures('conservative', 'tight')).toEqual({ gratitude: false, enrichment: true });
    expect(optionalAiFeatures('conservative', 'exhausted')).toEqual({ gratitude: false, enrichment: false });
    expect(optionalAiFeatures('aggressive', 'normal')).toEqual({ gratitude: false, enrichment: false });
  });
});
