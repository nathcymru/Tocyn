import { describe, expect, it, vi } from 'vitest';
import { CapabilityPolicyService } from '../capability-policy.repository';
import { createVerifiedTenantScope } from '../../auth/scope';
const principal = { tenantId:'tenant-a', actorId:'admin-a', role:'admin', sessionVersion:0 };
describe('capability repository authority boundary', () => {
  it.each([
    {...principal, tenantId:'tenant-b'},
    {...principal, actorId:'admin-b'},
    {...principal, role:'agent'},
  ])('denies mismatched authenticated scope before accessing policy rows', async wrong => {
    const prepare=vi.fn();const repository=new CapabilityPolicyService({prepare} as any,createVerifiedTenantScope('tenant-a','admin-a',['admin'],1));
    expect((await repository.authorize(wrong,'permissions.manage')).allowed).toBe(false);
    expect(await repository.updateAgentPolicy(1,{general:true},{...wrong,capability:'permissions.manage'})).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('cannot use an unrelated capability fence to administer permissions', async () => {
    const prepare=vi.fn();const repository=new CapabilityPolicyService({prepare} as any,createVerifiedTenantScope('tenant-a','admin-a',['admin'],1));
    expect(await repository.updateAgentPolicy(1,{general:true},{...principal,capability:'settings.general.manage'})).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });
});
