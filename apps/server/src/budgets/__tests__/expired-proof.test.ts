import { describe, expect, it } from 'vitest';
import type { CostPolicy, EffectiveTenantCostPolicy, ResourceAmounts } from '@luminatick/shared';
import { createBudgetOwnerAggregateState, reserveOwnerAggregate, refreshBudgetOwnerAggregateAuthority,
 reconcileOwnerAggregate, retireExpiredOwnerGrants, type TrustedBudgetCoordinatorAuthority } from '../owner-aggregate';
import { encodeCoordinatorState, decodeCoordinatorState } from '../coordinator-storage';
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


function retired() {
 const first=reserveOwnerAggregate(createBudgetOwnerAggregateState(authority()),reserve('tenant-a','holder','key',4));
 const grant=first.outcome.reservation!, now=grant.expiresAt+1;
 const state=retireExpiredOwnerGrants(first.state,now);
 const fresh=refreshBudgetOwnerAggregateAuthority(state,{...authority(),authorityCheckedAt:now,authorityExpiresAt:now+30000});
 return {state:fresh,grant,now};
}
function proof(f:ReturnType<typeof retired>) {
 return {tenantId:'tenant-a',reservationId:f.grant.reservationId,holderId:f.grant.holderId,
 expectedPolicyId:'owner-policy',expectedPolicyRevision:7,expectedRestrictionRevision:3,terminalEvidenceId:'expiry-proof',
 measured:{},uncertain:f.grant.envelope,now:f.now,
 certifiedClosure:{operationSetFingerprint:'exact-original-operation-set',expiresAt:f.grant.expiresAt,retireExpired:true as const},
 certifiedCompletionDigest:'sha256:'+'a'.repeat(64)};
}
describe('late proof after irreversible expiry accounting',()=>{
 it('acknowledges an exact expiry proof without adding or refunding original charges',()=>{
  const f=retired(),before=f.state.tenantStates[0].closedCharges;
  const restored=decodeCoordinatorState(encodeCoordinatorState(f.state));
  const result=reconcileOwnerAggregate(restored,proof(f));
  expect(result.outcome).toBe('reconciled');
  expect(result.state.tenantStates[0].closedCharges).toEqual(before);
  expect(result.state.tenantStates[0].grants.some(g=>g.reservationId===f.grant.reservationId)).toBe(false);
  expect(reconcileOwnerAggregate(result.state,proof(f)).outcome).toBe('rejected','expired absent proof is not fabricated acknowledgement');
  expect(result.state.tenantStates[0].closedCharges).toEqual(before);
 });
 it('charges a fresh paired recovery once, retaining the original full rollup',()=>{
  const f=retired(),input=proof(f);
  const reserved=reserveOwnerAggregate(f.state,{tenantId:'tenant-a',holderId:'recovery:expiry-proof',idempotencyKey:'expiry-proof',
    expectedPolicyId:'owner-policy',expectedPolicyRevision:7,expectedRestrictionRevision:3,purpose:'recovery',recoversReservationId:f.grant.reservationId,envelope:{workerRequests:1},now:f.now});
  expect(reserved.outcome.status).toBe('granted');const recovery=reserved.outcome.reservation!;
  const result=reconcileOwnerAggregate(reserved.state,{...input,certifiedClosure:{...input.certifiedClosure,recoveryReservationId:recovery.reservationId,recoveryHolderId:recovery.holderId}});
  expect(result.outcome).toBe('reconciled');
  expect(result.state.tenantStates[0].closedCharges).toEqual(expect.arrayContaining([
    expect.objectContaining({purpose:'new-work',units:4}),expect.objectContaining({purpose:'recovery',units:1}),
  ]));
  const replay=reconcileOwnerAggregate(result.state,{...input,certifiedClosure:{...input.certifiedClosure,recoveryReservationId:recovery.reservationId,recoveryHolderId:recovery.holderId}});
  expect(replay.outcome).toBe('rejected');expect(replay.state.tenantStates[0].closedCharges).toEqual(result.state.tenantStates[0].closedCharges);
 });
 for(const mode of ['uncertified','lower','measured','wrong-holder','wrong-expiry','wrong-policy','wrong-pair'] as const)
 it('rejects '+mode+' late evidence without altering retained liability',()=>{
  const f=retired(),input=proof(f);
  const candidate=mode==='uncertified'?{...input,certifiedClosure:undefined}:
   mode==='lower'?{...input,uncertain:{workerRequests:3}}:
   mode==='measured'?{...input,measured:{workerRequests:1},uncertain:{workerRequests:3}}:
   mode==='wrong-holder'?{...input,holderId:'other'}:
   mode==='wrong-expiry'?{...input,certifiedClosure:{...input.certifiedClosure,expiresAt:f.grant.expiresAt+1}}:
   mode==='wrong-policy'?{...input,expectedPolicyRevision:6}:
   {...input,certifiedClosure:{...input.certifiedClosure,recoveryReservationId:'missing',recoveryHolderId:'missing'}};
  const result=reconcileOwnerAggregate(f.state,candidate);
  expect(result.outcome).toBe('rejected');expect(result.state.tenantStates[0].closedCharges).toEqual(f.state.tenantStates[0].closedCharges);
  expect(result.state.tenantStates[0].grants[0]).toMatchObject({compacted:true,status:'uncertain',accounted:{workerRequests:4}});
 });
});
