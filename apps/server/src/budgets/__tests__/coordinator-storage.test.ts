import { describe, expect, it } from 'vitest';
import type { CostPolicy, EffectiveTenantCostPolicy, ResourceAmounts } from '@luminatick/shared';
import { createBudgetOwnerAggregateState, reserveOwnerAggregate, reconcileOwnerAggregate, type TrustedBudgetCoordinatorAuthority } from '../owner-aggregate';
import { encodeCoordinatorState, decodeCoordinatorState, encodedGrantBytes } from '../coordinator-storage';
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


function fixture() {
 let state=createBudgetOwnerAggregateState(authority());
 for(const tenant of ['tenant-a','tenant-b']) for(let i=0;i<3;i++)
  state=reserveOwnerAggregate(state,reserve(tenant,'holder-'+i,'key-'+i,1)).state;
 return {...state,tenantStates:state.tenantStates.map(t=>({...t,grants:t.grants.map(g=>({...g,compacted:false}))}))};
}
describe('coordinator format3 dictionaries',()=>{
 it('roundtrips every state field, with tenant-local dictionaries and no amount aliases',()=>{
  const state=fixture(),wire=JSON.parse(encodeCoordinatorState(state)),decoded=decodeCoordinatorState(JSON.stringify(wire));
  expect(decoded).toEqual(state);
  expect(wire.tenantStates).toBeUndefined();
  expect(wire.state.tenantStates[0].amounts).toEqual([{workerRequests:1}]);
  const a=decoded.tenantStates[0].grants[0],b=decoded.tenantStates[0].grants[1];
  expect(a.envelope).not.toBe(a.remaining);expect(a.remaining).not.toBe(a.accounted);
  expect(a.envelope).not.toBe(b.envelope);
  expect(a.envelope).not.toBe(decoded.tenantStates[1].grants[0].envelope);
 });
 it('preserves raw legacy object/string and actual format2 compatibility',()=>{
  const state=fixture();expect(decodeCoordinatorState(state)).toBe(state);
  expect(decodeCoordinatorState(JSON.stringify(state))).toEqual(state);
  const wire=JSON.parse(encodeCoordinatorState(state));
  for(const t of [wire.state.ownerIngress,...wire.state.tenantStates]){
   for(const row of t.grants){for(const i of[10,11,12])if(row[i]!==null)row[i]=t.amounts[row[i]];
    if(typeof row[16]==='number')row[16]=t.proofs[row[16]];}
   delete t.amounts;delete t.proofs;
  }
  wire.format=2;expect(decodeCoordinatorState(JSON.stringify(wire))).toEqual(state);
 });
 it('retains reserve delivery and conflicting-envelope semantics',()=>{
  const state=decodeCoordinatorState(encodeCoordinatorState(fixture()));
  const input=reserve('tenant-a','holder-0','key-0',1);
  const replay=reserveOwnerAggregate(state,input);expect(replay.outcome.status).toBe('idempotent');
  expect(reserveOwnerAggregate(replay.state,input).outcome.reason).toBe('delivery-exhausted');
  expect(()=>reserveOwnerAggregate(state,{...input,envelope:{workerRequests:2}})).toThrow('different envelope');
 });
 it('canonicalizes key order without merging missing and explicit zero',()=>{
  const state=fixture(),a=state.tenantStates[0].grants[0];
  const changed={...state,tenantStates:[{...state.tenantStates[0],grants:[
   {...a,envelope:{workerRequests:1,d1RowsRead:0}},
   {...a,envelope:{d1RowsRead:0,workerRequests:1}},
   a]},state.tenantStates[1]]};
  const wire=JSON.parse(encodeCoordinatorState(changed));
  expect(wire.state.tenantStates[0].amounts).toContainEqual({workerRequests:1});
  expect(wire.state.tenantStates[0].amounts).toContainEqual({workerRequests:1,d1RowsRead:0});
  expect(wire.state.tenantStates[0].grants[0][10]).toBe(wire.state.tenantStates[0].grants[1][10]);
  expect(decodeCoordinatorState(JSON.stringify(wire))).toEqual(changed);
 });
 for(const bad of [-1,0.5,999,'0',null])it('rejects invalid amount reference '+String(bad),()=>{
  const wire=JSON.parse(encodeCoordinatorState(fixture()));wire.state.tenantStates[0].grants[0][10]=bad;
  expect(()=>decodeCoordinatorState(JSON.stringify(wire))).toThrow('dictionary is invalid');
 });
 it('rejects unsafe amount keys and invalid proof indices',()=>{
  const wire=JSON.parse(encodeCoordinatorState(fixture()));
  wire.state.tenantStates[0].amounts[0]=JSON.parse('{"__proto__":1}');
  expect(()=>decodeCoordinatorState(JSON.stringify(wire))).toThrow();
  const proof=JSON.parse(encodeCoordinatorState(fixture()));proof.state.tenantStates[0].grants[0][16]=0;
  expect(()=>decodeCoordinatorState(JSON.stringify(proof))).toThrow();
 });
 it('keeps standalone grant accounting independent of dictionary sharing',()=>{
  const state=fixture(),before=state.tenantStates[0].grants.map(encodedGrantBytes);
  expect(decodeCoordinatorState(encodeCoordinatorState(state)).tenantStates[0].grants.map(encodedGrantBytes)).toEqual(before);
 });
 it('preserves certified replay, mismatches, expiry and charge rollups',()=>{
  const state=fixture(),g=state.tenantStates[0].grants[0];
  const input={tenantId:'tenant-a',reservationId:g.reservationId,holderId:g.holderId,expectedPolicyId:'owner-policy',
   expectedPolicyRevision:7,expectedRestrictionRevision:3,terminalEvidenceId:'synthetic-proof',measured:{workerRequests:1},uncertain:{},now:NOW+1,
   certifiedClosure:{operationSetFingerprint:'synthetic-operation',expiresAt:g.expiresAt},certifiedCompletionDigest:'sha256:'+ 'a'.repeat(64)};
  const closed=reconcileOwnerAggregate(state,input);expect(closed.outcome).toBe('reconciled');
  const decoded=decodeCoordinatorState(encodeCoordinatorState(closed.state));
  expect(decoded.tenantStates[0].closedCharges).toEqual(closed.state.tenantStates[0].closedCharges);
  expect(reconcileOwnerAggregate(decoded,input).outcome).toBe('already-reconciled');
  expect(reconcileOwnerAggregate(decoded,{...input,certifiedCompletionDigest:'sha256:'+'b'.repeat(64)}).outcome).toBe('rejected');
  const atExpiry={...input,now:g.expiresAt,certifiedClosure:{...input.certifiedClosure,retireExpired:true as const}};
  expect(reconcileOwnerAggregate(decoded,atExpiry).outcome).toBe(reconcileOwnerAggregate(closed.state,atExpiry).outcome);
  const wire=JSON.parse(encodeCoordinatorState(closed.state));
  expect(wire.state.tenantStates[0].proofs).toEqual(['sha256:'+'a'.repeat(64)]);
 });

 it('rejects out-of-range allocation refs and oversized dictionaries before expansion',()=>{
  const wire=JSON.parse(encodeCoordinatorState(fixture()));
  wire.state.tenantStates[0].grants[0][13]=[-1];
  expect(()=>decodeCoordinatorState(JSON.stringify(wire))).toThrow();
  const oversized=JSON.parse(encodeCoordinatorState(fixture()));
  oversized.state.tenantStates[0].amounts=Array.from({length:10},()=>({}));
  expect(()=>decodeCoordinatorState(JSON.stringify(oversized))).toThrow();
 });

 it('keeps multi-dimension reverse-order reservation and terminal replay equivalent',()=>{
  const base=authority();
  const add=(policy: CostPolicy)=>({...policy,budgets:[...policy.budgets,{...policy.budgets[0],dimension:'d1RowsRead' as const,allocationId:'read-allocation'}]});
  const scoped={...base,ownerPolicy:add(base.ownerPolicy),tenantAllocations:base.tenantAllocations.map(t=>({...t,effectivePolicy:{...t.effectivePolicy,...add(t.effectivePolicy)}}))};
  const input={...reserve('tenant-a','order-holder','order-key',1),envelope:{workerRequests:1,d1RowsRead:2}};
  const first=reserveOwnerAggregate(createBudgetOwnerAggregateState(scoped),input);
  const decoded=decodeCoordinatorState(encodeCoordinatorState(first.state));
  expect(reserveOwnerAggregate(decoded,{...input,envelope:{d1RowsRead:2,workerRequests:1}}).outcome.status).toBe('idempotent');
  const grant=first.outcome.reservation!;
  const terminal={tenantId:'tenant-a',reservationId:grant.reservationId,holderId:grant.holderId,expectedPolicyId:'owner-policy',expectedPolicyRevision:7,expectedRestrictionRevision:3,terminalEvidenceId:'order-proof',measured:{workerRequests:1,d1RowsRead:2},uncertain:{},now:NOW+1};
  const closed=reconcileOwnerAggregate(decoded,terminal);expect(closed.outcome).toBe('reconciled');
  expect(reconcileOwnerAggregate(decodeCoordinatorState(encodeCoordinatorState(closed.state)),{...terminal,measured:{d1RowsRead:2,workerRequests:1}}).outcome).toBe('already-reconciled');
 });

 it('format4 preserves relative, equal and literal keys, old-format reads and replay',()=>{
  let state=createBudgetOwnerAggregateState(authority());
  const inputs=[reserve('tenant-a','holder-a','holder-a:block:1',1),reserve('tenant-a','holder-b','holder-b',1),reserve('tenant-a','holder-c','literal-key',1)];
  for(const input of inputs)state=reserveOwnerAggregate(state,input).state;
  state={...state,tenantStates:state.tenantStates.map(t=>({...t,grants:t.grants.map(g=>({...g,compacted:false}))}))};
  const wire=JSON.parse(encodeCoordinatorState(state));expect(wire.format).toBe(4);
  expect(wire.state.tenantStates[0].grants.map((r:unknown[])=>r[2])).toEqual([[':block:1'],[''],'literal-key']);
  const decoded=decodeCoordinatorState(JSON.stringify(wire));expect(decoded).toEqual(state);
  for(const input of inputs)expect(reserveOwnerAggregate(decoded,input).outcome.status).toBe('idempotent');
  const legacy=structuredClone(wire);legacy.format=3;
  for(const t of [legacy.state.ownerIngress,...legacy.state.tenantStates])for(const row of t.grants)if(Array.isArray(row[2]))row[2]=row[1]+row[2][0];
  expect(decodeCoordinatorState(JSON.stringify(legacy))).toEqual(state);
  expect(decodeCoordinatorState(JSON.stringify(state))).toEqual(state);
  expect(decoded.tenantStates[0].grants.map(encodedGrantBytes)).toEqual(state.tenantStates[0].grants.map(encodedGrantBytes));
  expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(legacy).length);
 });
 it('rejects malformed relative keys and unknown versions without guessing',()=>{
  for(const bad of [[],['x','y'],[1],[null],['x'.repeat(161)],['\u0000']]){
   const wire=JSON.parse(encodeCoordinatorState(fixture()));wire.state.tenantStates[0].grants[0][2]=bad;
   expect(()=>decodeCoordinatorState(JSON.stringify(wire))).toThrow();
  }
  const empty=JSON.parse(encodeCoordinatorState(fixture()));empty.state.tenantStates[0].grants[0][1]='';empty.state.tenantStates[0].grants[0][2]=['suffix'];
  expect(()=>decodeCoordinatorState(JSON.stringify(empty))).toThrow();
  const old=JSON.parse(encodeCoordinatorState(fixture()));old.format=3;old.state.tenantStates[0].grants[0][2]=['suffix'];expect(()=>decodeCoordinatorState(JSON.stringify(old))).toThrow();
  for(const format of [1,5,'4',null]){const wire=JSON.parse(encodeCoordinatorState(fixture()));wire.format=format;expect(()=>decodeCoordinatorState(JSON.stringify(wire))).toThrow();}
 });

});
