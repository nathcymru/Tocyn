import {describe,expect,it,vi} from 'vitest';
import {createSystemTenantScope} from '../../auth/scope';
import {admitInboundAttempt,settleInboundAttempt,INBOUND_RESERVATION_CONTROL_ENVELOPE} from '../../budgets/inbound-admission.service';
type Input=Parameters<typeof admitInboundAttempt>[0];
function fixture(){
  const snapshot={deployment_id:'deployment',tenant_id:'synthetic',authority_revision:1,policy_id:'policy',policy_revision:1,
    policy_json:'{}',restriction_json:'{}',reservation_namespace:'namespace',coordinator_id:'aggregate',max_reservations:64,authority_max_age_ms:60000};
  const active={kind:'active',commitSnapshot:snapshot,authority:{aggregateId:'aggregate',authorityExpiresAt:60000,
    tenantAllocations:[{effectivePolicy:{tenantId:'synthetic',policyId:'policy',revision:1,restrictionRevision:1,budgets:['workerRequests','d1RowsRead','d1RowsWritten','doRequests','doRowsRead','doRowsWritten','logEvents'].map(dimension=>({dimension,allocationId:dimension,window:{id:'window'}}))}}]}};
  const resolve=vi.fn().mockResolvedValue(active);
  const coordinator={refreshFromTrustedAuthority:vi.fn(),revokeFromTrustedAuthority:vi.fn(),reserveFromTrustedAuthority:vi.fn(async(request)=>({status:'granted',reservation:{
    reservationId:'reservation',holderId:request.holderId,idempotencyKey:request.idempotencyKey,purpose:request.purpose,
    policyRevision:request.expectedPolicyRevision,restrictionRevision:request.expectedRestrictionRevision,
    status:'reserved',expiresAt:50000,allocations:Object.keys(request.envelope).map(dimension=>({dimension,allocationId:dimension,windowId:'window'})),envelope:{...request.envelope},remaining:{...request.envelope},accounted:{...request.envelope},
  }}))};
  const input:Input={env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:{idFromName:vi.fn(x=>x),get:vi.fn(()=>coordinator)}} as unknown as Input['env'],
    deps:{scope:createSystemTenantScope({tenantId:'synthetic',actor:'inbound-email'}),repositories:{budgetAuthority:{resolveForVerifiedPrincipal:resolve}}} as unknown as Input['deps'],
    identity:{from:'sender@example.invalid',to:'support@example.invalid',subject:'Synthetic',messageId:'<one@example.invalid>',rawSize:12,sourceHash:'a'.repeat(64),envelopeHash:'b'.repeat(64)},
    attempt:1,business:{d1RowsRead:8192,d1RowsWritten:64},now:()=>1000};
  return {input,active,resolve,coordinator};
}
describe('deterministic inbound direct reservation',()=>{
  it('rejects invalid scope/attempt/policy before any authority lookup',async()=>{
    const f=fixture();for(const change of [{attempt:4},{attempt:1.5},{env:{}},
      {deps:{...f.input.deps,scope:createSystemTenantScope({tenantId:'synthetic',actor:'scheduled-retention'})}}]){
      expect(await admitInboundAttempt({...f.input,...change} as Input)).toEqual({status:'rejected',reason:'unavailable'});
    }expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each([1,2,3])('reserves one operation for attempt %s and rechecks current authority',async attempt=>{
    const f=fixture();f.input.attempt=attempt;const result=await admitInboundAttempt(f.input);
    expect(result.status).toBe('admitted');expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.resolve).toHaveBeenCalledWith(f.input.deps.scope,{kind:'system',actor:'inbound-email'},1000);
    const request=f.coordinator.reserveFromTrustedAuthority.mock.calls[0][0];
    expect(request.holderId).toMatch(/^inbound:[a-f0-9]{64}$/);expect(request.idempotencyKey).toBe(`inbound:${f.input.identity.sourceHash}:${attempt}`);
    expect(request.purpose).toBe(attempt===1?'new-work':'recovery');
    expect(request.envelope.d1RowsWritten).toBe(64);expect(request.envelope.d1RowsRead).toBe(8192+INBOUND_RESERVATION_CONTROL_ENVELOPE.d1RowsRead!);
    if(result.status==='admitted')expect(result.authority.grant?.operationEnvelope).toEqual(request.envelope);
  });
  it('keeps reservation identity stable across callers and changed envelope fingerprints',async()=>{
    const f=fixture();await admitInboundAttempt(f.input);await admitInboundAttempt({...f.input,identity:{...f.input.identity,envelopeHash:'c'.repeat(64)}});
    const [a,b]=f.coordinator.reserveFromTrustedAuthority.mock.calls.map(call=>call[0]);expect(a.holderId).toBe(b.holderId);expect(a.idempotencyKey).toBe(b.idempotencyKey);
    await admitInboundAttempt({...f.input,attempt:2});expect(f.coordinator.reserveFromTrustedAuthority.mock.calls[2][0].holderId).not.toBe(a.holderId);
  });
  it('rejects a policy change after reservation and forwards revocation',async()=>{
    const f=fixture();f.resolve.mockResolvedValueOnce(f.active).mockResolvedValueOnce({...f.active,commitSnapshot:{...f.active.commitSnapshot,authority_revision:2}});
    expect(await admitInboundAttempt(f.input)).toEqual({status:'rejected',reason:'unavailable'});
    const revoked={kind:'revoked',revocation:{aggregateId:'aggregate',authorityRevision:2,authorityCheckedAt:1000}};
    f.resolve.mockResolvedValue(revoked);expect(await admitInboundAttempt(f.input)).toEqual({status:'rejected',reason:'unavailable'});
    expect(f.coordinator.revokeFromTrustedAuthority).toHaveBeenCalledWith(revoked.revocation);
  });
  it.each(['holderId','purpose','policyRevision','expiresAt','envelope','remaining','accounted','allocations'] as const)('rejects mismatched grant %s',async field=>{
    const f=fixture();const original=f.coordinator.reserveFromTrustedAuthority.getMockImplementation()!;
    f.coordinator.reserveFromTrustedAuthority.mockImplementation(async request=>{
      const result=await original(request);Object.assign(result.reservation,{[field]:field==='expiresAt'?999:field==='policyRevision'?2:['envelope','remaining','accounted'].includes(field)?{}:field==='allocations'?[]:'wrong'});return result;
    });expect(await admitInboundAttempt(f.input)).toEqual({status:'rejected',reason:'unavailable'});
  });
  it('snapshots source and fingerprint before the first asynchronous boundary',async()=>{
    const f=fixture();const pending=admitInboundAttempt(f.input);
    f.input.identity.sourceHash='c'.repeat(64);f.input.identity.envelopeHash='d'.repeat(64);
    const result=await pending;expect(result.status).toBe('admitted');
    if(result.status==='admitted'){
      expect(result.authority.operationId).toBe(`inbound:${'a'.repeat(64)}:1`);
      expect(result.authority.operationFingerprint).toBe('b'.repeat(64));
    }
  });
  it('does not retry an uncertain reservation response or release on settlement',async()=>{
    const f=fixture();f.coordinator.reserveFromTrustedAuthority.mockRejectedValue(new Error('lost response'));
    expect(await admitInboundAttempt(f.input)).toEqual({status:'rejected',reason:'unavailable'});expect(f.coordinator.reserveFromTrustedAuthority).toHaveBeenCalledTimes(1);
    settleInboundAttempt({} as Parameters<typeof settleInboundAttempt>[0],'unknown',1000);
    settleInboundAttempt({} as Parameters<typeof settleInboundAttempt>[0],'committed',1000);
    expect(f.coordinator.reserveFromTrustedAuthority).toHaveBeenCalledTimes(1);
  });
});
