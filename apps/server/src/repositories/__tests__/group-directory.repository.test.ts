import { describe,expect,it,vi } from 'vitest';
import { GroupDirectoryRepository } from '../group-directory.repository';

function database(){
  const prepared:{sql:string;values:unknown[]}[]=[];
  const db={prepare:vi.fn((sql:string)=>{const statement:any={sql,values:[],bind:(...values:unknown[])=>{statement.values=values;prepared.push(statement);return statement;}};return statement;}),
    batch:vi.fn(async(statements:any[])=>statements.map(()=>({results:[],meta:{changes:0}})))};
  return{db:db as any,prepared};
}

const scope={tenantId:'tenant',actorId:'actor',roles:['admin'],authVersion:1} as any;
const authority={purpose:'new-work',operationId:'operation',operationFingerprint:'fingerprint',expiresAt:9_999_999_999_999,
  snapshot:{tenant_id:'tenant',deployment_id:'deployment',authority_revision:1,policy_id:'policy',policy_revision:1,
    reservation_namespace:'tenant',restriction_json:'{}',coordinator_id:'coordinator',max_reservations:64,authority_max_age_ms:30_000,policy_json:'{}'}} as any;
const credential={tenantId:'tenant',actorId:'actor',role:'admin',sessionVersion:1,expiresAt:9_999_999_999,mfaVerified:true} as const;

describe('GroupDirectoryRepository',()=>{
  it('binds an immutable operation target into the atomic guard',async()=>{
    const f=database();const repository=new GroupDirectoryRepository(scope,f.db);
    await repository.removeMember('group','different-user',{operation:'directory.group.member.remove',requestKey:'fingerprint',
      target:{groupId:'group',userId:'admitted-user'},credential,capability:{tenantId:'tenant',actorId:'actor',role:'admin',sessionVersion:1,
        capability:'groups.manage',policyFingerprint:'fingerprint'},authority});
    const guard=f.prepared.find(statement=>statement.sql.includes('INSERT INTO budget_mutation_assertion'))!;
    expect(guard.values[1]).toBe(0);
  });

  it('deletes the entire admitted membership population and probes tickets with indexed EXISTS semantics',async()=>{
    const f=database();const repository=new GroupDirectoryRepository(scope,f.db);
    await repository.deleteGroup('group',{operation:'directory.group.delete',requestKey:'fingerprint',target:{groupId:'group'},credential,
      capability:{tenantId:'tenant',actorId:'actor',role:'admin',sessionVersion:1,capability:'groups.manage',policyFingerprint:'fingerprint'},
      population:{kind:'group-members',groupId:'group',count:2_801},authority});
    const sql=f.prepared.map(statement=>statement.sql).join('\n');
    expect(sql).toContain('DELETE FROM user_groups WHERE tenant_id=? AND group_id=?');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM tickets WHERE tenant_id=? AND group_id=? LIMIT 1)');
  });
});
