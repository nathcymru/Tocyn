import { describe, expect, it, vi } from 'vitest';
import { RESOURCE_DIMENSIONS, type EffectiveTenantCostPolicy } from '@luminatick/shared';
import { createBudgetCoordinatorState, reserveBudgetGrant, reconcileBudgetGrant, applyTrustedCoordinatorAuthority } from '../coordinator-state';
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
  const recoverExact = vi.fn(async (sealed: any) => {
    const result=reconcileBudgetGrant(state,{reservationId:sealed.reservationId,holderId:sealed.holderId,
      expectedPolicyId:sealed.policyId,expectedPolicyRevision:sealed.policyRevision,expectedRestrictionRevision:sealed.restrictionRevision,
      terminalEvidenceId:sealed.terminalEvidenceId,measured:{},uncertain:sealed.envelope,now:clock,
      certifiedClosure:{operationSetFingerprint:'synthetic-exact-operation-set',expiresAt:sealed.expiresAt}});
    state=result.state;expect(result.outcome).toBe('reconciled');return 'reconciled';
  });
  const request = (target: string, recover = recoverExact): any => ({
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
  const close=async(target:string)=>{clock++;const sealed=cache.sealIdleApiGrant('tenant',`credential-${target}`,clock,1);expect(sealed).not.toBeNull();await recoverExact(sealed);cache.completeApiGrantRecovery(sealed!);};
  const setPolicy=(id:string,revision=1)=>{Object.assign(policy,{policyId:id,revision});state=applyTrustedCoordinatorAuthority(state,{effectivePolicy:policy,authorityCheckedAt:clock});};
  const originalResolve=repository.resolveForVerifiedPrincipal.getMockImplementation()!;
  repository.resolveForVerifiedPrincipal.mockImplementation(async()=>{const result=await originalResolve();return {...result,commitSnapshot:{...result.commitSnapshot,policy_id:policy.policyId,policy_revision:policy.revision},authority:{...result.authority,tenantAllocations:[{effectivePolicy:structuredClone(policy)}]}};});
  return { cache, request, seed, close, setPolicy, recoverExact, repository, namespace, reserve, coordinator, state:()=>state, setClock: (value: number) => { clock = value; } };
}


function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}

describe('confirmed empty target scope lifecycle',()=>{
 it('reclaims more than64 exact acknowledged scopes without refunding central charges or retaining old callbacks',async()=>{
  const f=fixture();let previous=vi.fn();
  for(let i=0;i<70;i++){
   const callback=vi.fn(async(sealed:any)=>f.recoverExact(sealed));await f.seed(f.request('target-'+i,callback));
   if(i>0)expect(callback).toHaveBeenCalledOnce();
   expect(previous).toHaveBeenCalledTimes(i>1?1:0);previous=callback;
   expect(f.cache.inspectForTrustedRuntime()).toMatchObject({scopes:1,holders:1,operations:1,refills:1});
  }
  expect(f.reserve).toHaveBeenCalledTimes(70);
  expect(f.state().grants.filter(g=>g.compacted)).toHaveLength(69);
  expect(f.state().grants.filter(g=>!g.compacted)).toHaveLength(1);
 });
 it('revisiting a cleaned same key requires a new charged grant, never old replay credit',async()=>{
  const f=fixture();const first=await f.seed(f.request('old'));await f.seed(f.request('new'));
  const result=await f.seed(f.request('old'));expect(result.status).toBe('spent');
  expect(result.commitAuthority!.grant!.reservationId).not.toBe(first.commitAuthority!.grant!.reservationId);
  expect(f.reserve).toHaveBeenCalledTimes(3);
 });
 it.each(['unknown','in-flight'] as const)('does not reclaim %s holders while other clean entries retire',async(state)=>{
  const f=fixture();await f.seed(f.request('protected'),state);await f.seed(f.request('first'));await f.seed(f.request('second'));
  expect(f.cache.inspectForTrustedRuntime()).toMatchObject({scopes:2,holders:2,operations:2,refills:2});
  expect(f.recoverExact.mock.calls.some(([s])=>s.credentialKey==='credential-protected')).toBe(false);
 });
 it('retains a lost reservation acknowledgement even with no installed holder',async()=>{
  const f=fixture();const reserve=f.reserve.getMockImplementation()!;
  f.reserve.mockImplementation(async(input)=>{await reserve(input);throw new Error('lost acknowledgement');});
  expect((await f.cache.admit(f.request('lost'))).status).toBe('rejected');
  f.reserve.mockImplementation(reserve);await f.seed(f.request('other'));await f.seed(f.request('next'));
  expect(f.cache.inspectForTrustedRuntime()).toMatchObject({scopes:2,holders:1,refills:2});
  expect(f.state().grants.filter(g=>!g.compacted).length===2).toBe(true);
 });
 it('keeps an initial authority-resolution lease while another request confirms its last holder',async()=>{
  const f=fixture();await f.seed(f.request('old'));
  const entered=deferred(),gate=deferred(),old=f.request('old');
  old.authorization.authorize.mockImplementationOnce(async()=>{entered.release();await gate.promise;return{kind:'session',sessionVersion:1};});
  const pending=f.cache.admit(old);await entered.promise;
  await f.seed(f.request('new'));
  expect(f.cache.inspectForTrustedRuntime().scopes).toBe(2,'empty old scope remains pinned during initial await');
  gate.release();const result=await pending;expect(result.status).toBe('spent');
  expect(f.reserve).toHaveBeenCalledTimes(3);
 });
 it('preserves the post-allocation authority lease while an independent admission completes',async()=>{
  const f=fixture(),input=f.request('first'),entered=deferred(),gate=deferred();let calls=0;
  input.authorization.authorize.mockImplementation(async()=>{if(++calls===2){entered.release();await gate.promise;}return{kind:'session',sessionVersion:1};});
  const pending=f.cache.admit(input);await entered.promise;
  expect(f.cache.inspectForTrustedRuntime()).toMatchObject({scopes:1,holders:1,operations:0});
  await f.seed(f.request('other'));
  expect(f.cache.inspectForTrustedRuntime()).toMatchObject({scopes:2,holders:2});
  gate.release();expect((await pending).status).toBe('spent');expect(f.reserve).toHaveBeenCalledTimes(2);
 });
 it.each(['checkedAt','policy'] as const)('rejects stale %s after the original scope has been cleaned',async(kind)=>{
  const f=fixture();f.setClock(10);f.setPolicy('policy',2);await f.seed(f.request('old'));await f.seed(f.request('new'));
  expect(f.cache.inspectForTrustedRuntime().scopes).toBe(1);
  const resolver=f.repository.resolveForVerifiedPrincipal.getMockImplementation()!;
  f.repository.resolveForVerifiedPrincipal.mockImplementation(async()=>{const a=await resolver();if(kind==='checkedAt')a.authority.authorityCheckedAt=9;else{a.authority.tenantAllocations[0].effectivePolicy.revision=1;a.commitSnapshot.policy_revision=1;}return a;});
  const before=f.reserve.mock.calls.length;expect((await f.cache.admit(f.request('old'))).status).toBe('rejected');expect(f.reserve).toHaveBeenCalledTimes(before);
 });
 it('retains64 group floors and fails closed on a65th group despite empty acknowledged scopes',async()=>{
  const f=fixture();
  for(let i=0;i<64;i++){
   const input=f.request('g'+i);input.sessionRecovery.groupKey='group'+i;input.sessionRecovery.descriptor.recoveryGroupKey='group'+i;
   await f.seed(input);await f.close('g'+i);
  }
  const input=f.request('overflow');input.sessionRecovery.groupKey='group64';input.sessionRecovery.descriptor.recoveryGroupKey='group64';
  const before=f.reserve.mock.calls.length;expect((await f.cache.admit(input)).status).toBe('rejected');expect(f.reserve).toHaveBeenCalledTimes(before);
  const existing=f.request('existing-group');existing.sessionRecovery.groupKey='group0';existing.sessionRecovery.descriptor.recoveryGroupKey='group0';
  expect((await f.cache.admit(existing)).status).toBe('spent','full registry preserves existing groups');
 });
 it('retains nine policy observations and rejects a tenth without resetting the existing floor',async()=>{
  const f=fixture();
  await f.seed(f.request('original'));await f.close('original');
  const resolve=f.repository.resolveForVerifiedPrincipal.getMockImplementation()!;let id='policy';
  f.repository.resolveForVerifiedPrincipal.mockImplementation(async()=>{const a=await resolve();a.commitSnapshot.policy_id=id;a.authority.tenantAllocations[0].effectivePolicy.policyId=id;return a;});
  // The coordinator deliberately rejects these unactivated policies; observing them still must not reset local floors.
  for(let i=1;i<9;i++){id='policy'+i;expect((await f.cache.admit(f.request('p'+i))).status).toBe('rejected');}
  id='policy9';const before=f.reserve.mock.calls.length;
  expect((await f.cache.admit(f.request('p9'))).status).toBe('rejected');expect(f.reserve).toHaveBeenCalledTimes(before);
  id='policy';expect((await f.cache.admit(f.request('valid'))).status).toBe('spent');
 });
 it('rejects a never-before-seen target below the retained group authority floor',async()=>{
  const f=fixture();f.setClock(10);await f.seed();await f.close('old');f.setClock(9);
  const before=f.reserve.mock.calls.length;expect((await f.cache.admit(f.request('never-seen'))).status).toBe('rejected');expect(f.reserve).toHaveBeenCalledTimes(before);
 });
 it('releases the post-pending admission lease when authorization throws',async()=>{
  const f=fixture(),input=f.request('throw');input.authorization.authorize.mockResolvedValueOnce({kind:'session',sessionVersion:1}).mockRejectedValueOnce(new Error('transient authorization'));
  await expect(f.cache.admit(input)).rejects.toThrow('transient authorization');
  expect((f.cache as any).entries.every((entry:any)=>entry.activeAdmissions===0)).toBe(true);
  expect(f.cache.inspectForTrustedRuntime()).toMatchObject({scopes:1,holders:1,refills:1});
  await f.seed(f.request('throw'));await f.seed(f.request('next'));expect(f.cache.inspectForTrustedRuntime().scopes).toBe(1);
 });
 it('keeps the recovery lock until its exact asynchronous acknowledgement finishes',async()=>{
  const f=fixture();await f.seed();const entered=deferred(),gate=deferred();
  const recover=vi.fn(async(sealed:any)=>{await f.recoverExact(sealed);f.cache.completeApiGrantRecovery(sealed);entered.release();await gate.promise;return 'reconciled';});
  const pending=f.cache.admit(f.request('new',recover));await entered.promise;
  await f.seed(f.request('other',vi.fn(async()=> 'pending')));
  expect((f.cache as any).entries.some((entry:any)=>entry.recoveryLock&&entry.holders.length===0)).toBe(true,'acknowledged empty entry cannot unlink under active recovery lock');
  gate.release();expect((await pending).status).toBe('spent');
  expect((f.cache as any).entries.some((entry:any)=>entry.recoveryLock)).toBe(false);
 });
 it('retains the maximum observed group horizon across shorter later authority windows',async()=>{
  const f=fixture();f.setClock(10);await f.seed();await f.close('old');
  const resolve=f.repository.resolveForVerifiedPrincipal.getMockImplementation()!;
  f.repository.resolveForVerifiedPrincipal.mockImplementation(async()=>{const a=await resolve();a.authority.tenantAllocations[0].effectivePolicy.budgets.forEach(budget=>{if(budget.window.kind==='interval')budget.window.endsAt=50;});return a;});
  f.setClock(20);await f.seed(f.request('short'));await f.close('short');
  f.setClock(60);const before=f.reserve.mock.calls.length;
  const current=f.repository.resolveForVerifiedPrincipal.getMockImplementation()!;
  f.repository.resolveForVerifiedPrincipal.mockImplementation(async()=>{const a=await current();a.authority.authorityCheckedAt=15;return a;});
  expect((await f.cache.admit(f.request('new-target'))).status).toBe('rejected');expect(f.reserve).toHaveBeenCalledTimes(before);
  expect((f.cache as any).recoveryFloors[0].expiresAt).toBe(100000);
 });
 it('does not clear a retired/renewed lost allocation simply because it has no installed holder',async()=>{
  const f=fixture();f.reserve.mockRejectedValue(new Error('lost allocation'));const input=f.request('lost');await f.cache.admit(input);
  input.authorization.authorize.mockResolvedValue(null);await f.cache.admit(input);
  input.authorization.authorize.mockResolvedValue({kind:'session',sessionVersion:1});await f.cache.admit(input);
  expect(f.cache.inspectForTrustedRuntime()).toMatchObject({scopes:1,holders:0,refills:2});
 });

 it('retains a centrally allocated grant whose holder installation was not acknowledged',async()=>{
  const f=fixture(),reserve=f.reserve.getMockImplementation()!;
  f.reserve.mockImplementation(async(input)=>{const result=await reserve(input);return result.reservation?{...result,reservation:{...result.reservation,expiresAt:0}}:result;});
  expect((await f.cache.admit(f.request('lost-install'))).status).toBe('rejected');
  f.reserve.mockImplementation(reserve);await f.seed(f.request('other'));await f.seed(f.request('next'));
  expect(f.cache.inspectForTrustedRuntime()).toMatchObject({scopes:2,holders:1,refills:2});
  expect(f.state().grants.filter(g=>!g.compacted)).toHaveLength(2);
 });

});
