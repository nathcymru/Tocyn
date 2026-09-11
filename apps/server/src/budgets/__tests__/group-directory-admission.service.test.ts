import { describe,expect,it } from 'vitest';
import { admitGroupDirectory,groupDirectoryEnvelope } from '../group-directory-admission.service';

describe('group directory admission',()=>{
  it('scales complete-list and deletion reservations from maintained populations without a count cap',()=>{
    const members=groupDirectoryEnvelope('directory.group.members.list',{kind:'group-members',groupId:'group',count:2_801});
    expect(members).toMatchObject({workerRequests:1,d1RowsRead:25_480,d1RowsWritten:8});
    const deletion=groupDirectoryEnvelope('directory.group.delete',{kind:'group-members',groupId:'group',count:2_801});
    expect(deletion).toMatchObject({workerRequests:1,d1RowsRead:47_888,d1RowsWritten:44_824});
    expect(groupDirectoryEnvelope('directory.agents.list',{kind:'tenant-users',count:1_000_000})?.d1RowsRead).toBe(8_003_072);
  });

  it('rejects arithmetic overflow instead of silently truncating a population',()=>{
    expect(groupDirectoryEnvelope('directory.group.delete',{kind:'group-members',groupId:'group',count:Number.MAX_SAFE_INTEGER})).toBeNull();
  });

  it('preserves the legacy path only when the policy binding is absent',async()=>{
    const common={deps:{scope:{tenantId:'tenant',actorId:'actor'}} as any,payload:{sub:'actor'} as any,
      operation:'directory.groups.list' as const,target:{},now:()=>Date.now()};
    expect(await admitGroupDirectory({env:{} as any,...common})).toEqual({status:'disabled'});
    expect(await admitGroupDirectory({env:{BUDGET_ADMISSION_POLICY:'malformed'} as any,...common})).toEqual({status:'rejected',reason:'unavailable'});
  });
});
