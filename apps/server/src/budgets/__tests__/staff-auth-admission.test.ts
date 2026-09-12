import {describe,expect,it} from 'vitest';
import {admitStaffAuthEffect,staffAuthEnvelope} from '../staff-auth-admission.service';

const payload={sub:'actor-a',email:'actor@example.test',role:'admin' as const,tenant_id:'tenant-a',mfa_verified:true,
  session_version:1,iat:1,exp:4_000_000_000};
const deps={scope:{tenantId:'tenant-a',actorId:'actor-a',roles:['admin'],authVersion:1}} as any;

describe('staff auth admission configuration',()=>{
  it.each([undefined,'off','api-ticket-mutations-v1'])(`preserves disabled policy %s`,async policy=>{
    await expect(admitStaffAuthEffect({env:{BUDGET_ADMISSION_POLICY:policy} as any,deps,payload,
      operation:'staff.auth.me',now:()=>1_000})).resolves.toEqual({status:'disabled'});
  });

  it('fails closed for an invalid or incomplete strict configuration',async()=>{
    await expect(admitStaffAuthEffect({env:{BUDGET_ADMISSION_POLICY:'unexpected'} as any,deps,payload,
      operation:'staff.auth.me',now:()=>1_000})).resolves.toEqual({status:'rejected',reason:'unavailable'});
    await expect(admitStaffAuthEffect({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1'} as any,deps,payload,
      operation:'staff.auth.me',now:()=>1_000})).resolves.toEqual({status:'rejected',reason:'unavailable'});
  });

  it('omits new stored-byte stock only for an existing pending enrollment',()=>{
    expect(staffAuthEnvelope('staff.auth.mfa.setup',{mfaEnabled:false,pendingSecret:false}).d1StorageBytes).toBe(512);
    expect(staffAuthEnvelope('staff.auth.mfa.setup',{mfaEnabled:false,pendingSecret:true}).d1StorageBytes).toBeUndefined();
    expect(staffAuthEnvelope('staff.auth.me',{mfaEnabled:true,pendingSecret:true}).d1StorageBytes).toBeUndefined();
  });
});
