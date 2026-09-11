import {describe,expect,it,vi} from 'vitest';
import {admitKnowledgeRead,knowledgeReadEnvelope} from '../knowledge-read-admission.service';

const scope={tenantId:'tenant-a',actorId:'staff-a',roles:['admin'],authVersion:7} as any;
const payload={sub:'staff-a',tenant_id:'tenant-a',role:'admin',email:'staff@example.test',
  session_version:7,exp:2_000_000_000,mfa_verified:true,iat:1} as any;

describe('knowledge read admission',()=>{
  it('prices a complete list from maintained population and projected bytes without a row cap',()=>{
    const envelope=knowledgeReadEnvelope('knowledge.article.list',{documentRows:25_000,projectionBytes:6_400_000,revision:9});
    expect(envelope).toMatchObject({workerRequests:1,d1RowsRead:79_096});
  });

  it('reserves one class-B read and the exact immutable source bytes for versioned content',()=>{
    const envelope=knowledgeReadEnvelope('knowledge.article.content',{
      exists:true,filePath:'knowledge/doc/body.md/versions/4',sourceBytes:10*1024*1024,versioned:true,
    });
    expect(envelope).toMatchObject({workerRequests:1,d1RowsRead:4_096,r2ClassBOperations:1,r2StorageBytes:10*1024*1024});
  });

  it('rejects unsafe accounting rather than truncating retained history',()=>{
    expect(knowledgeReadEnvelope('knowledge.article.list',{
      documentRows:Number.MAX_SAFE_INTEGER,projectionBytes:0,revision:1,
    })).toBeNull();
  });

  it('preserves explicit off-policy behavior without consulting D1 or R2',async()=>{
    const resource=vi.fn();
    const outcome=await admitKnowledgeRead({env:{BUDGET_ADMISSION_POLICY:'off',ATTACHMENTS_BUCKET:{get:resource}} as any,
      deps:{scope,database:{prepare:resource},repositories:{budgetAuthority:{resolveForVerifiedPrincipal:resource}}} as any,
      payload,operation:'knowledge.article.list',now:()=>1_000});
    expect(outcome).toEqual({status:'disabled'});
    expect(resource).not.toHaveBeenCalled();
  });

  it('rejects a mismatched tenant claim before authority, D1, or R2 work',async()=>{
    const resource=vi.fn();
    const outcome=await admitKnowledgeRead({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:{},
      ATTACHMENTS_BUCKET:{get:resource}} as any,
    deps:{scope,database:{prepare:resource},repositories:{budgetAuthority:{resolveForVerifiedPrincipal:resource}}} as any,
    payload:{...payload,tenant_id:'tenant-b'},operation:'knowledge.article.detail',documentId:'doc-a',now:()=>1_000});
    expect(outcome).toEqual({status:'rejected',reason:'unavailable'});
    expect(resource).not.toHaveBeenCalled();
  });
});
