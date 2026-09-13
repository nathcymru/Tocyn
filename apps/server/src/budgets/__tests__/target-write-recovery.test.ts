import { describe, expect, it, vi } from 'vitest';
import { RESOURCE_DIMENSIONS, type EffectiveTenantCostPolicy } from '@luminatick/shared';
import { createBudgetCoordinatorState, reserveBudgetGrant } from '../coordinator-state';
import { SessionBudgetAdmissionService } from '../session-admission.service';
import { BudgetGrantRecoveryService } from '../budget-grant-recovery.service';
import { IsolateBudgetAdmissionCache } from '../isolate-admission.service';

function fixture() {
  let clock = 2;
  const policy: EffectiveTenantCostPolicy = {
    schemaVersion: 1, policyId: 'policy', revision: 1, deploymentId: 'deployment', tenantId: 'tenant', restrictionRevision: 1,
    disabledFeatures: [], mode: 'conservative', catalogueVersion: 'test', maxGrantLifetimeMs: 60_000,
    budgets: RESOURCE_DIMENSIONS.map(dimension => ({ dimension, allocationId: dimension,
      window: { kind: 'interval', id: 'window', startsAt: 0, endsAt: 100_000 },
      limit: 1_000_000_000, recoveryPercent: 20, provenance: 'owner-allocation' })),
  };
  let state = createBudgetCoordinatorState({ coordinatorId: 'aggregate', maxReservations: 64,
    authority: { effectivePolicy: policy, authorityCheckedAt: 1 } });
  const reserve = vi.fn(async request => {
    const result = reserveBudgetGrant(state, request);
    state = result.state;
    return result.outcome;
  });
  const coordinator = { refreshFromTrustedAuthority: vi.fn(), reserveFromTrustedAuthority: reserve };
  const repository = { bindingIdentity: {}, resolveForVerifiedPrincipal: vi.fn(async () => ({ kind: 'active',
    commitSnapshot: { deployment_id: 'deployment', policy_id: 'policy', policy_revision: 1, restriction_json: '{"revision":1}' }, authority: { aggregateId: 'aggregate', authorityRevision: 1,
      authorityCheckedAt: clock, authorityExpiresAt: 60_000, ownerPolicy: policy, tenantAllocations: [{ effectivePolicy: policy }] } })) };
  const namespace = { idFromName: (name: string) => name, get: () => coordinator };
  const credential = { tenantId: 'tenant', actorId: 'actor', role: 'agent' as const, sessionVersion: 1, expiresAt: 9999999999, mfaVerified: true };
  const cache = new IsolateBudgetAdmissionCache();
  const request = (target: string, recover = vi.fn().mockResolvedValue('reconciled')): any => ({
    repository, namespace, scope: { tenantId: 'tenant', actorId: 'actor' },
    authorization: { authorize: vi.fn().mockResolvedValue({ kind: 'session', sessionVersion: 1 }) },
    credentialKey: `credential-${target}`, maxBlockOperations: 1,
    intent: { operationId: target, operationFingerprint: `fingerprint-${target}`, workScopeKey: `write-${target}` },
    business: { workerRequests: 2, d1RowsRead: 128, d1RowsWritten: 16, logEvents: 32 }, now: () => clock,
    sessionRecovery: { groupKey: 'full-credential-group', recover, descriptor: {
      credential: structuredClone(credential), requirements: { ticket: { id: target, groupId: 'group' } },
      credentialKey: `credential-${target}`, recoveryGroupKey: 'full-credential-group',
    } },
  });
  const seed = async (input = request('old'), settlement: 'committed' | 'unknown' | 'in-flight' = 'committed') => {
    const result = await cache.admit(input);
    expect(result.status).toBe('spent');
    expect(result.commitAuthority).toBeDefined();
    if (settlement !== 'in-flight') cache.settleOperation(result.commitAuthority!, settlement, clock);
    return result;
  };
  return { cache, request, seed, repository, namespace, reserve, coordinator, setClock: (value: number) => { clock = value; } };
}

describe('bounded target-write cross-scope recovery', () => {
  it('uses the current callback and clock with an immutable original-target descriptor', async () => {
    const f = fixture();
    const staleCallback = vi.fn().mockRejectedValue(new Error('old request diagnostics must not run'));
    const old = f.request('old', staleCallback);
    await f.seed(old);
    old.sessionRecovery.descriptor.requirements.ticket.id = 'mutated';
    old.sessionRecovery.descriptor.credential.actorId = 'mutated';
    f.setClock(17);
    const currentDiagnostics = vi.fn();
    const current = f.request('new', vi.fn(async (sealed, descriptor, now) => {
      currentDiagnostics(now);
      expect(sealed.credentialKey).toBe('credential-old');
      expect(descriptor.requirements.ticket.id).toBe('old');
      expect(descriptor.credential.actorId).toBe('actor');
      expect(Object.isFrozen(descriptor.requirements.ticket)).toBe(true);
      return 'reconciled';
    }));
    expect((await f.cache.admit(current)).status).toBe('spent');
    expect(staleCallback).not.toHaveBeenCalled();
    expect(currentDiagnostics).toHaveBeenCalledExactlyOnceWith(17);
    expect(f.cache.inspectForTrustedRuntime()).toMatchObject({ holders: 1, operations: 1, scopes: 1 });
  });

  it.each(['rejected', 'pending', 'throw'])('retains original liability after %s and rechecks the new target before allocation', async outcome => {
    const f = fixture();
    await f.seed();
    const current = f.request('new');
    current.sessionRecovery.recover = vi.fn(async () => {
      current.authorization.authorize.mockResolvedValue(null);
      if (outcome === 'throw') throw new Error('uncertain closure');
      return outcome;
    });
    expect((await f.cache.admit(current)).status).toBe('rejected');
    expect(current.sessionRecovery.recover).toHaveBeenCalledOnce();
    expect(current.authorization.authorize).toHaveBeenCalledTimes(2);
    expect(f.reserve).toHaveBeenCalledOnce();
    expect(f.cache.inspectForTrustedRuntime()).toMatchObject({ holders: 1, operations: 1, refills: 1 });
  });

  it.each(['binding', 'namespace', 'credential-group'])('does not select an original holder across a different %s', async boundary => {
    const f = fixture();
    await f.seed();
    const current = f.request('new');
    if (boundary === 'binding') current.repository = { ...f.repository, bindingIdentity: {} };
    if (boundary === 'namespace') current.namespace = { ...f.namespace };
    if (boundary === 'credential-group') {
      current.sessionRecovery.groupKey = 'other-full-credential';
      current.sessionRecovery.descriptor.recoveryGroupKey = 'other-full-credential';
    }
    expect((await f.cache.admit(current)).status).toBe('spent');
    expect(current.sessionRecovery.recover).not.toHaveBeenCalled();
    expect(f.cache.inspectForTrustedRuntime()).toMatchObject({ holders: 2, operations: 2 });
  });

  it.each(['unknown', 'in-flight'] as const)('never seals %s work', async settlement => {
    const f = fixture();
    await f.seed(f.request('old'), settlement);
    const current = f.request('new');
    expect((await f.cache.admit(current)).status).toBe('spent');
    expect(current.sessionRecovery.recover).not.toHaveBeenCalled();
    expect(f.cache.inspectForTrustedRuntime()).toMatchObject({ holders: 2, operations: 2 });
  });

  it('locks a selected holder before awaiting closure, preventing duplicate concurrent closure', async () => {
    const f = fixture();
    await f.seed();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const recover = vi.fn(async () => { entered(); await blocked; return 'reconciled'; });
    const first = f.cache.admit(f.request('first', recover));
    await started;
    expect((await f.cache.admit(f.request('second', recover))).status).toBe('spent');
    expect(recover).toHaveBeenCalledOnce();
    release();
    expect((await first).status).toBe('spent');
    expect(recover).toHaveBeenCalledOnce();
    expect(f.cache.inspectForTrustedRuntime()).toMatchObject({ holders: 2, operations: 2 });
  });

  it('does no recovery or coordinator RPC for an admitted warm replay', async () => {
    const f = fixture();
    const input = f.request('old');
    await f.seed(input);
    f.reserve.mockClear();
    f.coordinator.refreshFromTrustedAuthority.mockClear();
    expect((await f.cache.admit(input)).status).toBe('idempotent');
    expect(input.sessionRecovery.recover).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.coordinator.refreshFromTrustedAuthority).not.toHaveBeenCalled();
  });
});


function adapterFixture() {
  const captured: any[] = [];
  const service = new SessionBudgetAdmissionService({ admit: async (input: any) => {
    captured.push(input);
    return { status: 'spent' };
  } } as any);
  const input: any = {
    repository: {}, sessions: { authorize: vi.fn().mockResolvedValue(null) }, namespace: {}, database: {},
    scope: { tenantId: 'tenant', actorId: 'actor' },
    credential: { tenantId: 'tenant', actorId: 'actor', role: 'agent', sessionVersion: 1, expiresAt: 9999999999, mfaVerified: true },
    requirements: { ticket: { id: 'old', groupId: 'group' } }, singleOperationGrant: 'target-write-v1',
    intent: { operationId: 'old', operationFingerprint: 'old', workScopeKey: `dashboard.ticket.reply:${'a'.repeat(64)}` },
    business: { workerRequests: 1 }, now: () => 2,
  };
  return { service, input, captured };
}

describe('session recovery descriptor and current request composition', () => {
  it('constructs recovery with the current request database observation wrapper, repository and namespace', async () => {
    const f = adapterFixture();
    await f.service.admit(f.input);
    const descriptor = f.captured[0].sessionRecovery.descriptor;
    const current = { ...f.input, database: { diagnosticRequest: 'current' }, repository: { request: 'current' },
      namespace: { request: 'current' }, now: () => 31 };
    await f.service.admit(current);
    const recover = vi.spyOn(BudgetGrantRecoveryService.prototype, 'recover').mockImplementation(async function (this: any, _sealed, now) {
      expect(this.db).toBe(current.database);
      expect(this.repository).toBe(current.repository);
      expect(this.namespace).toBe(current.namespace);
      expect(now).toBe(31);
      return 'pending';
    });
    try {
      expect(await f.captured[1].sessionRecovery.recover({}, descriptor, 31)).toBe('pending');
      expect(recover).toHaveBeenCalledOnce();
    } finally { recover.mockRestore(); }
  });

});
