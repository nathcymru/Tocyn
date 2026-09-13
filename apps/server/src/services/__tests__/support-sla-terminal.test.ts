import { afterEach, expect, it, vi } from 'vitest';
import { SupportSlaMutationService } from '../support-sla-mutation.service';
import { SupportSlaMutationRepository } from '../../repositories/support-sla-mutation.repository';
import { SessionBudgetAuthorityRepository } from '../../repositories/session-budget-authority.repository';
import { createVerifiedTenantScope } from '../../auth/scope';

afterEach(()=>vi.restoreAllMocks());
function fixture() {
  const scope=createVerifiedTenantScope('fixture','staff',['admin'],1);
  const credential={tenantId:'fixture',actorId:'staff',role:'admin' as const,sessionVersion:1,expiresAt:9999999999,mfaVerified:true};
  vi.spyOn(SessionBudgetAuthorityRepository.prototype,'authorize').mockResolvedValue({} as any);
  const receipt=vi.spyOn(SupportSlaMutationRepository.prototype,'findActive').mockResolvedValue(null);
  const stmt={bind:vi.fn().mockReturnThis()};
  const db={prepare:vi.fn(()=>stmt),batch:vi.fn(async(rows:unknown[])=>rows.map(()=>({success:true,results:[]})))};
  const authority={operationId:'operation',operationFingerprint:'fingerprint',expiresAt:Date.now()+60000} as any;
  const admit=vi.fn().mockResolvedValue({status:'spent',commitAuthority:authority});
  const settle=vi.fn();
  const service=new SupportSlaMutationService(db as any,scope,credential,{service:{admit} as any,repository:{} as any,namespace:{} as any,business:{},settle});
  return {service,receipt,db,authority,settle,admit};
}
it.each(['acknowledged','lost-response','no-batch'] as const)('SLA terminal requires acknowledged batch and clean completion: %s',async(mode)=>{
  const f=fixture();
  const prepared=await f.service.prepareMutation({operation:'dashboard.sla.policy.set',payload:{}},'terminal');
  await f.service.admit(prepared);
  expect(f.admit.mock.calls[0][0].database).toBe(f.db);
  let release!:()=>void;
  const pending=f.service.commit(prepared,200,"'{}'",[],async db=>{
    if(mode!=='no-batch') await db.batch([]);
    f.receipt.mockResolvedValue({response_snapshot:'{}',payload_hash:(f.admit.mock.calls[0][0]).intent.operationFingerprint} as any);
    await new Promise<void>(resolve=>{release=resolve;});
    if(mode==='lost-response')throw new Error('Synthetic acknowledgment uncertainty');
  });
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  expect(f.settle).not.toHaveBeenCalled(); release(); await pending;
  expect(f.settle).not.toHaveBeenCalled();
  f.service.finish(prepared,'committed'); f.service.finish(prepared,'committed');
  expect(f.settle).toHaveBeenCalledTimes(1);
  expect(f.settle.mock.calls[0][0]).toBe(f.authority);
  expect(f.settle.mock.calls[0][1]).toBe(mode==='acknowledged'?'committed':'unknown');
});
it('SLA pre-admission completion is a no-op and cannot promote an early admitted exit',async()=>{
  const f=fixture(), prepared=await f.service.prepareMutation({operation:'dashboard.sla.policy.set',payload:{}},'early');
  f.service.finish(prepared,'committed'); expect(f.settle).not.toHaveBeenCalled();
  await f.service.admit(prepared); f.service.finish(prepared,'committed'); f.service.finish(prepared,'unknown');
  expect(f.settle).toHaveBeenCalledTimes(1); expect(f.settle.mock.calls[0][1]).toBe('unknown');
});
