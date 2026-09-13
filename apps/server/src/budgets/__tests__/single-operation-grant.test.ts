import { describe, expect, it, vi } from 'vitest';
import { RESOURCE_DIMENSIONS } from '@luminatick/shared';
import { IsolateBudgetAdmissionCache, ISOLATE_COLD_ENVELOPE, selectIsolateBlockSize } from '../isolate-admission.service';
import { isolateWarmReservedEnvelope } from '../isolate-grant-holder';

function fixture() {
  const policy = { schemaVersion: 1, policyId: 'policy', revision: 1, deploymentId: 'deployment', tenantId: 'tenant', restrictionRevision: 1,
    disabledFeatures: [], mode: 'conservative', catalogueVersion: 'test', maxGrantLifetimeMs: 60_000,
    budgets: RESOURCE_DIMENSIONS.map(dimension => ({ dimension, allocationId: dimension, window: { kind: 'interval', id: 'window', startsAt: 0, endsAt: 100_000 }, limit: 1_000_000_000, recoveryPercent: 20, provenance: 'owner-allocation' })) };
  const reserve = vi.fn().mockResolvedValue({ status: 'rejected', reason: 'capacity-exhausted' });
  const coordinator = { refreshFromTrustedAuthority: vi.fn(), reserveFromTrustedAuthority: reserve };
  const input: any = { repository: { bindingIdentity: {}, resolveForVerifiedPrincipal: vi.fn().mockResolvedValue({ kind: 'active', commitSnapshot: { deployment_id: 'deployment' },
    authority: { aggregateId: 'aggregate', authorityRevision: 1, authorityCheckedAt: 1, authorityExpiresAt: 60_000, ownerPolicy: policy, tenantAllocations: [{ effectivePolicy: policy }] } }) },
    namespace: { idFromName: (name: string) => name, get: () => coordinator }, authorization: { authorize: vi.fn().mockResolvedValue({}) },
    scope: { tenantId: 'tenant', actorId: 'actor' }, credentialKey: 'credential', intent: { operationId: 'operation', operationFingerprint: 'fingerprint', workScopeKey: 'target' },
    business: { workerRequests: 2, d1RowsRead: 128, d1RowsWritten: 16, logEvents: 32 }, now: () => 2 };
  return { cache: new IsolateBudgetAdmissionCache(), input, reserve };
}

describe('single-operation allocation accounting', () => {
  it('keeps default eight-operation envelope, separates explicit cap, and preserves every cold dimension', async () => {
    const f = fixture(); await f.cache.admit(f.input); await f.cache.admit({ ...f.input, maxBlockOperations: 1 });
    expect(f.cache.inspectForTrustedRuntime().scopes).toBe(2);
    const warm = isolateWarmReservedEnvelope(f.input.business)!;
    for (const [index, size] of [8, 1].entries()) {
      const expected = Object.fromEntries(RESOURCE_DIMENSIONS.map(dimension => [dimension, (warm[dimension] ?? 0) * size + (ISOLATE_COLD_ENVELOPE[dimension] ?? 0)]).filter(([, units]) => Number(units) > 0));
      expect(f.reserve.mock.calls[index][0].envelope).toEqual(expected);
    }
    // Re-entering the default partition retains that entry rather than creating a third scope.
    await f.cache.admit(f.input); expect(f.cache.inspectForTrustedRuntime().scopes).toBe(2);
  });
  it.each([0, 2, 8, -1, NaN, '1', null])('rejects unsupported primitive option %s before any authority or reservation', async maxBlockOperations => {
    expect(selectIsolateBlockSize({} as any, {} as any, {}, maxBlockOperations as any)).toBe(0);
    const f = fixture(); expect(await f.cache.admit({ ...f.input, maxBlockOperations })).toEqual({ status: 'rejected', reason: 'invalid-request' });
    expect(f.input.authorization.authorize).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled(); expect(f.cache.inspectForTrustedRuntime().scopes).toBe(0);
  });
});
