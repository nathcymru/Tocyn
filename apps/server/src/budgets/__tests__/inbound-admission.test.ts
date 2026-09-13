import { beforeEach,describe,expect,it,vi } from 'vitest';
import { createSystemTenantScope } from '../../auth/scope';
import { admitInboundAttempt,settleInboundAttempt } from '../inbound-admission.service';
const mocks=vi.hoisted(()=>({admit:vi.fn(),settle:vi.fn(),mode:vi.fn()}));
vi.mock('../../middleware/budget-admission.middleware',()=>({apiTicketBudgetCache:{admit:mocks.admit,settleOperation:mocks.settle},ticketMutationAdmissionMode:mocks.mode}));
type Input=Parameters<typeof admitInboundAttempt>[0];
const fixture=():Input=>({env:{BUDGET_COORDINATOR_DO:{}} as Input['env'],deps:{scope:createSystemTenantScope({tenantId:'synthetic',actor:'inbound-email'}),repositories:{budgetAuthority:{}}} as Input['deps'],
  identity:{from:'sender@example.invalid',to:'support@example.invalid',subject:'Synthetic',messageId:'<one@example.invalid>',rawSize:12,sourceHash:'a'.repeat(64),envelopeHash:'b'.repeat(64)},attempt:1,business:{d1RowsRead:8192},now:()=>1000});
beforeEach(()=>{vi.resetAllMocks();mocks.mode.mockReturnValue('combined');});
describe('internal inbound budget adapter',()=>{
  it('fails closed before reservation when disabled, missing authority or invalid intent',async()=>{
    const variants=[{...fixture(),attempt:4},{...fixture(),attempt:1.5},{...fixture(),env:{}},
      {...fixture(),identity:{...fixture().identity,sourceHash:'invalid'}},
      {...fixture(),deps:{...fixture().deps,scope:createSystemTenantScope({tenantId:'synthetic',actor:'scheduled-retention'})}}] as Input[];
    for(const input of variants)expect(await admitInboundAttempt(input)).toEqual({status:'rejected',reason:'unavailable'});
    for(const mode of ['disabled','api','invalid']){mocks.mode.mockReturnValue(mode);expect(await admitInboundAttempt(fixture())).toEqual({status:'rejected',reason:'unavailable'});}
    expect(mocks.admit).not.toHaveBeenCalled();
  });
  it.each([1,2,3])('binds attempt %s and reauthorizes exact system/tenant scope',async attempt=>{
    const input={...fixture(),attempt};const authority={synthetic:true};
    mocks.admit.mockResolvedValue({status:'spent',commitAuthority:authority});
    expect(await admitInboundAttempt(input)).toEqual({status:'admitted',authority});
    const request=mocks.admit.mock.calls[0][0];
    expect(request.intent).toEqual({operationId:`inbound:${input.identity.sourceHash}:${attempt}`,operationFingerprint:input.identity.envelopeHash,workScopeKey:'email.inbound'});
    expect(request.purpose).toBe(attempt===1?'new-work':'recovery');
    expect(request.business).toEqual(input.business);expect(request.business).not.toBe(input.business);
    expect(await request.authorization.authorize(input.deps.scope)).toEqual({kind:'system',actor:'inbound-email'});
    expect(await request.authorization.authorize(createSystemTenantScope({tenantId:'other',actor:'inbound-email'}))).toBeNull();
    expect(await request.authorization.authorize(createSystemTenantScope({tenantId:'synthetic',actor:'scheduled-retention'}))).toBeNull();
  });
  it('distinguishes capacity rejection, missing authority and uncertain failures',async()=>{
    for(const reason of ['exhausted','capacity-exhausted']){mocks.admit.mockResolvedValue({status:'rejected',reason});expect(await admitInboundAttempt(fixture())).toEqual({status:'rejected',reason:'exhausted'});}
    mocks.admit.mockResolvedValue({status:'idempotent'});expect(await admitInboundAttempt(fixture())).toEqual({status:'rejected',reason:'unavailable'});
    mocks.admit.mockRejectedValue(new Error('synthetic reservation interruption'));expect(await admitInboundAttempt(fixture())).toEqual({status:'rejected',reason:'unavailable'});
    const authority={synthetic:true};mocks.admit.mockResolvedValue({status:'idempotent',commitAuthority:authority});expect(await admitInboundAttempt(fixture())).toEqual({status:'admitted',authority});
  });
  it('preserves unknown settlement without requesting a refund',()=>{
    const authority={} as Parameters<typeof settleInboundAttempt>[0];
    settleInboundAttempt(authority,'unknown',1000);
    expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(authority,'unknown',1000);
  });
});
