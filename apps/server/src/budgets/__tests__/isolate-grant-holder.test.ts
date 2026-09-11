import { describe, expect, it } from 'vitest';
import type { BudgetPurpose, EffectiveTenantCostPolicy, ResourceAmounts } from '@luminatick/shared';
import { createBudgetCoordinatorState, expireBudgetGrants, reserveBudgetGrant } from '../coordinator-state';
import {
  IsolateBudgetGrantHolder, isolateWarmReservedEnvelope, MAX_ISOLATE_GRANT_OPERATIONS,
  type CurrentIsolateGrantAuthority, type IsolateGrantScope,
} from '../isolate-grant-holder';

const scope: IsolateGrantScope = { tenantId: 'tenant-a', credentialKey: 'session:actor-a:3:write', workScopeKey: 'ticket:synthetic-a:reply', purpose: 'new-work' };

function fixture(purpose: BudgetPurpose = 'new-work', maxOperations?: number, envelope: ResourceAmounts = { queueOperations: 40, workerRequests: 4, d1RowsRead: 6_144 }) {
  const holder = new IsolateBudgetGrantHolder({ ...scope, purpose }, maxOperations);
  const policy: EffectiveTenantCostPolicy = {
    schemaVersion: 1, policyId: 'policy-a', revision: 3, deploymentId: 'synthetic', tenantId: 'tenant-a', restrictionRevision: 2,
    disabledFeatures: [], mode: 'conservative', catalogueVersion: 'cf-2026-09-10', maxGrantLifetimeMs: 100,
    budgets: (['queueOperations', 'workerRequests', 'd1RowsRead'] as const).map(dimension => ({
      dimension, allocationId: `allocation-${dimension}`, window: { kind: 'interval', id: 'window-a', startsAt: 0, endsAt: 200 },
      limit: dimension === 'queueOperations' ? 100 : 1_000_000, recoveryPercent: 20, provenance: 'owner-allocation',
    })),
  };
  const state = createBudgetCoordinatorState({ coordinatorId: 'coordinator-a', maxReservations: 8, authority: { effectivePolicy: policy, authorityCheckedAt: 0 } });
  const request = { holderId: holder.holderId, idempotencyKey: `allocation:${holder.holderId}`, expectedPolicyId: policy.policyId,
    expectedPolicyRevision: 3, expectedRestrictionRevision: 2, purpose, envelope, now: 1 };
  const reserved = reserveBudgetGrant(state, request);
  expect(reserved.outcome.status).toBe('granted');
  const grant = reserved.outcome.reservation!;
  const authority: CurrentIsolateGrantAuthority = { ...scope, purpose, aggregateId: 'aggregate-a', policyId: policy.policyId,
    policyRevision: 3, restrictionRevision: 2, authorityRevision: 4, authorityCheckedAt: 1, authorityExpiresAt: 80, allocations: grant.allocations };
  expect(holder.install(grant, authority, 1)).toBe(true);
  const spend = (operationId = 'operation-a', changes = {}, current = authority, now = 2) => holder.spend({
    holderId: holder.holderId, reservationId: grant.reservationId, operationId, operationFingerprint: `digest:${operationId}`,
    envelope: { queueOperations: 20 }, ...changes,
  }, current, now);
  return { holder, authority, grant, state: reserved.state, request, spend };
}

describe('isolate-owned prepaid budget grants', () => {
  it('decrements synchronously before concurrent asynchronous work without any external calls', async () => {
    const f = fixture();
    let workStarted = 0;
    const attempt = async (id: string) => {
      const outcome = f.spend(id);
      if (outcome.status === 'spent') {
        expect(f.holder.inspect().operationCount).toBeGreaterThan(0);
        await Promise.resolve();
        workStarted++;
      }
      return outcome;
    };
    const results = await Promise.all([attempt('a'), attempt('b'), attempt('c')]);
    expect(results.map(result => result.status)).toEqual(['spent', 'spent', 'rejected']);
    expect(workStarted).toBe(2);
    expect(f.holder.inspect()).toMatchObject({ remaining: {}, operationCount: 2 });
    // Local use never changes the durable reservation or returns unused credits.
    expect(f.state.grants[0].accounted).toEqual({ queueOperations: 40, workerRequests: 4, d1RowsRead: 6_144 });
  });

  it('keeps the full uncertain charge across isolate loss and refuses to import it into a replacement', () => {
    const f = fixture();
    expect(f.spend().status).toBe('spent');
    const replacement = new IsolateBudgetGrantHolder(scope);
    expect(replacement.holderId).not.toBe(f.holder.holderId);
    expect(replacement.install(f.grant, f.authority, 2)).toBe(false);
    const expired = expireBudgetGrants(f.state, 102);
    expect(expired.grants[0]).toMatchObject({ status: 'uncertain', accounted: f.grant.envelope });
    // Even a fresh holder cannot reclaim the lost grant's 40-unit charge.
    expect(reserveBudgetGrant(expired, { ...f.request, holderId: replacement.holderId, idempotencyKey: 'new-allocation',
      envelope: { queueOperations: 41 }, now: 102 }).outcome).toMatchObject({ status: 'rejected', reason: 'exhausted' });
  });

  it('recovers a lost allocation acknowledgement only into the same live instance without resetting spend', () => {
    const f = fixture();
    expect(f.spend().status).toBe('spent');
    const replay = reserveBudgetGrant(f.state, f.request);
    expect(replay.outcome.status).toBe('idempotent');
    expect(f.holder.install(replay.outcome.reservation!, f.authority, 2)).toBe(true);
    expect(f.holder.inspect().remaining.queueOperations).toBe(20);
    expect(f.spend('operation-b').status).toBe('spent');
    expect(f.spend('operation-c')).toMatchObject({ reason: 'exhausted' });
    expect(reserveBudgetGrant(replay.state, f.request).outcome).toMatchObject({ reason: 'delivery-exhausted' });
  });

  it('holds two control attempts up front and never authorizes business execution for replay', () => {
    const f = fixture();
    expect(f.spend()).toEqual({ status: 'spent' });
    expect(f.holder.inspect().remaining).toEqual({ queueOperations: 20, workerRequests: 2, d1RowsRead: 3_072 });
    expect(f.spend()).toEqual({ status: 'idempotent' });
    expect(f.spend()).toEqual({ status: 'rejected', reason: 'replay-exhausted' });
    expect(f.holder.inspect().operationCount).toBe(1);
  });

  it('detects equal-cost different work and changed-cost operation replay', () => {
    const f = fixture();
    expect(f.spend().status).toBe('spent');
    expect(f.spend('operation-a', { operationFingerprint: 'different-body' })).toMatchObject({ reason: 'replay-conflict' });
    expect(f.spend('operation-a', { envelope: { queueOperations: 1 } })).toMatchObject({ reason: 'replay-conflict' });
    expect(f.spend()).toEqual({ status: 'idempotent' });
  });

  it.each([
    ['tenantId', 'tenant-b'], ['credentialKey', 'session:actor-b:3:write'], ['credentialKey', 'session:actor-a:4:write'],
    ['workScopeKey', 'ticket:synthetic-b:reply'], ['purpose', 'recovery'],
  ])('rejects a changed trusted %s scope before local use', (field, value) => {
    const f = fixture();
    expect(f.spend('a', {}, { ...f.authority, [field]: value })).toMatchObject({ reason: 'stale-policy' });
    expect(f.holder.inspect().operationCount).toBe(0);
  });

  it.each(['aggregateId', 'policyId', 'policyRevision', 'restrictionRevision', 'authorityRevision'] as const)(
    'retires on %s change and cannot be resurrected by an older in-flight result', field => {
      const f = fixture();
      const value = f.authority[field];
      const changed = { ...f.authority, [field]: typeof value === 'number' ? value + 1 : `${value}-changed` };
      expect(f.spend('a', {}, changed)).toMatchObject({ reason: 'stale-policy' });
      expect(f.spend()).toMatchObject({ reason: 'stale-policy' });
      expect(f.holder.inspect().retired).toBe(true);
    });

  it.each(['allocationId', 'windowId'] as const)('rejects changed %s even when policy revisions match', field => {
    const f = fixture();
    const allocations = f.authority.allocations.map((allocation, index) => index === 0 ? { ...allocation, [field]: 'reset-b' } : allocation);
    expect(f.spend('a', {}, { ...f.authority, allocations })).toMatchObject({ reason: 'stale-policy' });
    expect(f.holder.inspect().retired).toBe(true);
  });

  it('rejects expired authority and grants, future or regressing authority reads, and explicit revocation', () => {
    const f = fixture();
    expect(f.spend('a', {}, f.authority, 80)).toMatchObject({ reason: 'stale-policy' });
    expect(f.spend('a', {}, { ...f.authority, authorityCheckedAt: 3 }, 2)).toMatchObject({ reason: 'stale-policy' });
    expect(f.spend('a', {}, { ...f.authority, authorityCheckedAt: 3 }, 3).status).toBe('spent');
    expect(f.spend('b', {}, f.authority, 4)).toMatchObject({ reason: 'stale-policy' });
    expect(f.spend('b', {}, { ...f.authority, authorityCheckedAt: 100, authorityExpiresAt: 200 }, 101)).toMatchObject({ reason: 'stale-policy' });
    const revoked = fixture();
    revoked.holder.invalidate();
    expect(revoked.spend()).toMatchObject({ reason: 'stale-policy' });
    expect(revoked.holder.install(revoked.grant, revoked.authority, 2)).toBe(false);
  });

  it('refuses wrong holder/reservation and never partially spends an unsupported dimension', () => {
    const f = fixture();
    expect(f.spend('a', { holderId: 'other' })).toMatchObject({ reason: 'stale-policy' });
    expect(f.spend('a', { reservationId: 'other' })).toMatchObject({ reason: 'stale-policy' });
    expect(f.spend('a', { envelope: { queueOperations: 1, aiMicroNeurons: 1 } })).toMatchObject({ reason: 'exhausted' });
    expect(f.holder.inspect().remaining).toEqual(f.grant.envelope);
  });

  it('bounds receipt growth and retains old receipts rather than evicting them for replay', () => {
    const f = fixture('new-work', 1);
    expect(f.spend('a').status).toBe('spent');
    expect(f.spend('b')).toMatchObject({ reason: 'capacity-exhausted' });
    expect(f.spend('a')).toEqual({ status: 'idempotent' });
    expect(() => new IsolateBudgetGrantHolder(scope, MAX_ISOLATE_GRANT_OPERATIONS + 1)).toThrow(/bound/);
  });

  it('enforces the production operation cap even when prepaid resources still remain', () => {
    const f = fixture('new-work', undefined, { queueOperations: 1, workerRequests: 1_024, d1RowsRead: 790_000 });
    for (let operation = 0; operation < 256; operation++) {
      expect(f.spend(`operation-${operation}`, { envelope: { workerRequests: 1 } }).status).toBe('spent');
    }
    expect(f.holder.inspect()).toMatchObject({ operationCount: 256, remaining: { d1RowsRead: 3_568 } });
    expect(f.spend('operation-257', { envelope: { workerRequests: 1 } })).toMatchObject({ reason: 'capacity-exhausted' });
  });

  it('retires changed authority on repeated installation and keeps acknowledgement reads monotonic', () => {
    const f = fixture();
    expect(f.holder.install(f.grant, { ...f.authority, authorityCheckedAt: 4 }, 4)).toBe(true);
    expect(f.spend('a', {}, f.authority, 5)).toMatchObject({ reason: 'stale-policy' });
    expect(f.holder.install(f.grant, { ...f.authority, authorityCheckedAt: 5, authorityRevision: 5 }, 5)).toBe(false);
    expect(f.spend('a', {}, { ...f.authority, authorityCheckedAt: 6 }, 6)).toMatchObject({ reason: 'stale-policy' });
    expect(f.holder.inspect().retired).toBe(true);
  });

  it('keeps recovery grant purpose exact and separate from the full new-work allowance', () => {
    const f = fixture('recovery', undefined, { queueOperations: 20, workerRequests: 2, d1RowsRead: 3_072 });
    expect(f.spend('a', {}, { ...f.authority, purpose: 'new-work' })).toMatchObject({ reason: 'stale-policy' });
    expect(f.spend('a').status).toBe('spent');
    expect(f.spend('b')).toMatchObject({ reason: 'exhausted' });
    const moreNew = reserveBudgetGrant(f.state, { ...f.request, holderId: 'new-holder', idempotencyKey: 'new-work',
      purpose: 'new-work', envelope: { queueOperations: 80 }, now: 2 });
    expect(moreNew.outcome.status).toBe('granted');
    expect(reserveBudgetGrant(moreNew.state, { ...f.request, holderId: 'other-holder', idempotencyKey: 'extra',
      purpose: 'new-work', envelope: { queueOperations: 1 }, now: 2 }).outcome).toMatchObject({ reason: 'exhausted' });
  });

  it('rejects invalid or overflowing amounts and isolates retained objects from caller mutation', () => {
    const f = fixture();
    expect(isolateWarmReservedEnvelope({ d1RowsRead: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(isolateWarmReservedEnvelope({ queueOperations: 0.5 })).toBeNull();
    expect(f.spend('a', { envelope: {} })).toMatchObject({ reason: 'invalid-request' });
    expect(f.spend('a', { operationFingerprint: 'bad\nidentifier' })).toMatchObject({ reason: 'invalid-request' });
    f.grant.envelope.queueOperations = 1_000;
    f.grant.remaining.queueOperations = 1_000;
    const diagnostic = f.holder.inspect();
    diagnostic.remaining.queueOperations = 1_000;
    expect(f.holder.inspect().remaining.queueOperations).toBe(40);
    expect(f.spend('a').status).toBe('spent');
    expect(f.holder.install(f.grant, f.authority, 2)).toBe(false);
  });
});
