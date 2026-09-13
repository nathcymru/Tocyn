import { describe,expect,it } from 'vitest';
import type { CostPolicy,EffectiveTenantCostPolicy,ResourceAmounts } from '@luminatick/shared';
import { createBudgetCoordinatorState,reserveBudgetGrant,retireExpiredBudgetGrants,expireBudgetGrants,type BudgetCoordinatorState } from '../coordinator-state';
import { createBudgetOwnerAggregateState,retireExpiredOwnerGrants,type BudgetOwnerAggregateState } from '../owner-aggregate';
import { encodeCoordinatorState,decodeCoordinatorState } from '../coordinator-storage';

// Pure fixtures retain both stock and interval liability. No runtime or external state.
function policy():CostPolicy{return{schemaVersion:1,policyId:'policy',revision:1,deploymentId:'synthetic',mode:'conservative',catalogueVersion:'synthetic',maxGrantLifetimeMs:10,
 budgets:[{dimension:'workerRequests',allocationId:'requests',window:{kind:'interval',id:'window',startsAt:0,endsAt:1000},limit:1000,recoveryPercent:20,provenance:'owner-allocation'},
 {dimension:'d1StorageBytes',allocationId:'storage',window:{kind:'stock',id:'storage-stock'},limit:1000,recoveryPercent:20,provenance:'owner-allocation'}]};}
function effective(tenant='tenant-a'):EffectiveTenantCostPolicy{return{...policy(),tenantId:tenant,restrictionRevision:1,disabledFeatures:[]};}
function initial(){return createBudgetCoordinatorState({coordinatorId:'synthetic',maxReservations:64,authority:{effectivePolicy:effective(),authorityCheckedAt:0}});}
function add(state:BudgetCoordinatorState,key:string,purpose:'new-work'|'recovery'='new-work',now=1,envelope:ResourceAmounts={workerRequests:10,d1StorageBytes:20}){
 const result=reserveBudgetGrant(state,{holderId:'holder-'+key,idempotencyKey:key,purpose,envelope,expectedPolicyId:state.policyId,
 expectedPolicyRevision:state.policyRevision,expectedRestrictionRevision:state.restrictionRevision,now});expect(result.outcome.status).toBe('granted');return {...result.state,grants:result.state.grants.map(g=>({...g,compacted:g.compacted??false}))};}
function aggregate():BudgetOwnerAggregateState{return createBudgetOwnerAggregateState({aggregateId:'aggregate',ownerPolicy:policy(),authorityCheckedAt:0,authorityRevision:1,authorityExpiresAt:500,
 maxReservations:64,tenantAllocations:['tenant-a','tenant-b'].map(tenantId=>({reservationNamespace:tenantId,effectivePolicy:effective(tenantId)}))});}
function total(state:BudgetCoordinatorState,dimension:'workerRequests'|'d1StorageBytes'){
 return state.grants.filter(g=>!g.compacted).reduce((sum,g)=>sum+(g.accounted[dimension]??0),0)
  +state.closedCharges.filter(c=>c.dimension===dimension).reduce((sum,c)=>sum+c.units,0);}


describe('expired unknown accounting retirement',()=>{
 it.each(['reserved','uncertain'] as const)('rolls expired %s full liability once while retaining every retry identity',status=>{
  const original=add(initial(),'old');const grant={...original.grants[0],status};const state={...original,grants:[grant]};
  const result=retireExpiredBudgetGrants(state,11,2);expect(result.retired).toBe(1);
  expect(result.state.grants[0]).toMatchObject({reservationId:grant.reservationId,holderId:grant.holderId,idempotencyKey:grant.idempotencyKey,
   purpose:grant.purpose,policyRevision:grant.policyRevision,restrictionRevision:grant.restrictionRevision,createdAt:grant.createdAt,expiresAt:grant.expiresAt,
   holderSeedAttempts:grant.holderSeedAttempts,envelope:grant.envelope,accounted:grant.accounted,remaining:grant.remaining,allocations:grant.allocations,
   status:'uncertain',compacted:true});
  expect(result.state.grants[0].reconciliation).toBeUndefined();
  expect(total(result.state,'workerRequests')).toBe(total(state,'workerRequests'));expect(total(result.state,'d1StorageBytes')).toBe(total(state,'d1StorageBytes'));
  expect(result.state.closedCharges).toEqual(expect.arrayContaining([expect.objectContaining({dimension:'workerRequests',units:10,purpose:'new-work'}),expect.objectContaining({dimension:'d1StorageBytes',units:20,purpose:'new-work'})]));
  const repeated=retireExpiredBudgetGrants(result.state,12,2);expect(repeated.retired).toBe(0);expect(repeated.state.closedCharges).toEqual(result.state.closedCharges);
  expect(state.grants[0].compacted).not.toBe(true);expect(state.closedCharges).toHaveLength(0);
 });
 it('aggregates into existing charges without counting compacted envelopes twice',()=>{
  let state=add(add(initial(),'a'),'b');state=retireExpiredBudgetGrants(state,11,1).state;
  expect(total(state,'workerRequests')).toBe(20);expect(total(state,'d1StorageBytes')).toBe(40);
  const result=retireExpiredBudgetGrants(state,11,1);expect(result.retired).toBe(1);
  expect(result.state.closedCharges).toHaveLength(2);expect(result.state.closedCharges.find(c=>c.dimension==='workerRequests')?.units).toBe(20);
  expect(result.state.closedCharges.find(c=>c.dimension==='d1StorageBytes')?.units).toBe(40);
 });
 it.each(['unexpired','recovery','reconciled','consumed','mismatched','defect'] as const)('does not retire excluded %s grant',kind=>{
  let state=add(initial(),'excluded',kind==='recovery'?'recovery':'new-work');
  if(kind==='reconciled'||kind==='consumed')state={...state,grants:[{...state.grants[0],status:kind}]};
  if(kind==='mismatched')state={...state,grants:[{...state.grants[0],accounted:{workerRequests:9,d1StorageBytes:20}}]};
  if(kind==='defect')state={...state,capacityDefects:[{reservationId:state.grants[0].reservationId,observedAt:2,envelope:state.grants[0].envelope,measured:{workerRequests:11},uncertain:{},overrun:{workerRequests:1}}]};
  const result=retireExpiredBudgetGrants(state,kind==='unexpired'?10:11,2);expect(result.retired).toBe(0);expect(result.state.closedCharges).toEqual(state.closedCharges);
  expect(result.state.grants[0].compacted).not.toBe(true);
 });
 it('enforces max2 independently of eligible population and a zero-work request',()=>{
  let state=initial();for(let i=0;i<5;i++)state=add(state,'g'+i);
  const zero=retireExpiredBudgetGrants(state,11,0);expect(zero.retired).toBe(0);expect(zero.state.closedCharges).toHaveLength(0);
  const result=retireExpiredBudgetGrants(state,11,2);expect(result.retired).toBe(2);expect(result.state.grants.filter(g=>g.compacted)).toHaveLength(2);
  expect(total(result.state,'workerRequests')).toBe(50);expect(total(result.state,'d1StorageBytes')).toBe(100);
 });
 it('shares one total2 allowance across owner ingress and both tenant ledgers',()=>{
  let state=aggregate();state={...state,ownerIngress:add(state.ownerIngress,'owner'),tenantStates:state.tenantStates.map((t,i)=>add(add(t,'a'+i),'b'+i))};
  const before=[state.ownerIngress,...state.tenantStates].map(t=>[total(t,'workerRequests'),total(t,'d1StorageBytes')]);
  const next=retireExpiredOwnerGrants(state,11);const ledgers=[next.ownerIngress,...next.tenantStates];
  expect(ledgers.flatMap(t=>t.grants).filter(g=>g.compacted)).toHaveLength(2);
  expect(ledgers.map(t=>[total(t,'workerRequests'),total(t,'d1StorageBytes')])).toEqual(before);
  const decoded=decodeCoordinatorState(encodeCoordinatorState(next));expect(decoded).toEqual(next);
  const second=retireExpiredOwnerGrants(decoded,12);expect([second.ownerIngress,...second.tenantStates].flatMap(t=>t.grants).filter(g=>g.compacted)).toHaveLength(4);
  const third=retireExpiredOwnerGrants(second,13);expect([third.ownerIngress,...third.tenantStates].flatMap(t=>t.grants).filter(g=>g.compacted)).toHaveLength(5);
  const repeated=retireExpiredOwnerGrants(decodeCoordinatorState(encodeCoordinatorState(third)),14);expect(repeated).toEqual(third);
 });
 it('preserves stock lifetime charge while expired interval charges age out by existing rules',()=>{
  const state=retireExpiredBudgetGrants(add(initial(),'stock'),11,2).state;
  const later=expireBudgetGrants(retireExpiredBudgetGrants(state,1001,2).state,1001);
  expect(later.closedCharges.find(c=>c.dimension==='d1StorageBytes')?.units).toBe(20);
  expect(total(later,'d1StorageBytes')).toBe(20);expect(later.closedCharges.some(c=>c.dimension==='workerRequests')).toBe(false);
 });
 it('compares full amounts independent of insertion order',()=>{
  const original=add(initial(),'reordered');const state={...original,grants:[{...original.grants[0],accounted:{d1StorageBytes:20,workerRequests:10}}]};
  expect(retireExpiredBudgetGrants(state,11,2).retired).toBe(1);
 });
 it('leaves every ledger unchanged when owner aggregate has a capacity defect',()=>{
  const original=aggregate();const owner=add(original.ownerIngress,'owner');const grant=owner.grants[0];
  const state={...original,ownerIngress:owner,tenantStates:original.tenantStates.map((t,i)=>add(t,'tenant'+i)),capacityDefects:[{tenantId:null,
   defect:{reservationId:grant.reservationId,observedAt:2,envelope:grant.envelope,measured:{workerRequests:11},uncertain:{},overrun:{workerRequests:1}}}]};
  expect(retireExpiredOwnerGrants(state,11)).toBe(state);
 });
 it.each([-1,3,NaN])('rejects out-of-contract limit %s',limit=>{
  expect(()=>retireExpiredBudgetGrants(add(initial(),'limit'),11,limit)).toThrow('retirement limit');
 });

});
