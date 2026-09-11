import {describe,expect,it,vi} from 'vitest';
import {admitKnowledgeDelete,KNOWLEDGE_DELETE_HTTP_ENVELOPE,KNOWLEDGE_DELETE_STEP_ENVELOPE} from '../knowledge-delete-admission.service';

describe('knowledge delete admission',()=>{
  it('reserves bounded calls without charging positive storage stock',()=>{
    expect(KNOWLEDGE_DELETE_HTTP_ENVELOPE).toMatchObject({workerRequests:1,d1RowsWritten:64,workflowExecutions:1});
    expect(KNOWLEDGE_DELETE_STEP_ENVELOPE).toMatchObject({workerRequests:1,d1RowsWritten:512,r2ClassAOperations:1});
    expect(KNOWLEDGE_DELETE_HTTP_ENVELOPE.r2StorageBytes??0).toBe(0);
    expect(KNOWLEDGE_DELETE_STEP_ENVELOPE.r2StorageBytes??0).toBe(0);
    expect(KNOWLEDGE_DELETE_STEP_ENVELOPE.vectorStoredDimensions??0).toBe(0);
  });

  it('rejects a cross-tenant principal before authority or storage work',async()=>{
    const resource=vi.fn(),deps={scope:{tenantId:'tenant-a',actorId:'staff-a',roles:['admin']},database:{prepare:resource},
      repositories:{budgetAuthority:{resolveForVerifiedPrincipal:resource}}} as any;
    const outcome=await admitKnowledgeDelete({env:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:{}} as any,deps,
      payload:{sub:'staff-a',tenant_id:'tenant-b',role:'admin',session_version:1,mfa_verified:true,exp:2_000_000_000} as any,
      documentId:'doc-a',now:()=>1_000});
    expect(outcome).toEqual({status:'rejected',reason:'unavailable'});
    expect(resource).not.toHaveBeenCalled();
  });
});
