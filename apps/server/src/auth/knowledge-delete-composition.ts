import type { Env } from '../bindings';
import { createSystemTenantScope } from './scope';
import { createTenantRequestDeps } from '../middleware/tenant.middleware';
import { KnowledgeDeleteRepository } from '../repositories/knowledge-delete.repository';
import { TenantKnowledgeService } from '../services/tenant-knowledge.service';
import { StatelessAiService } from '../services/ai.service';

/** Trusted bounded fallback for lost workflow creation/continuation. Each job
 * performs its own current exact resource admission before business D1. */
export async function runScheduledKnowledgeDeletion(env:Env):Promise<{attempted:number;completed:number}>{
  const pending=await KnowledgeDeleteRepository.pending(env,16);let completed=0;
  for(const job of pending){
    const scope=createSystemTenantScope({tenantId:job.tenantId,actor:'knowledge-delete'});
    const deps=createTenantRequestDeps(scope,env);
    const outcome=await new TenantKnowledgeService(deps,new StatelessAiService(env.AI,deps.emitResourceOperation))
      .runKnowledgeDeleteStep({env,documentId:job.documentId,deleteToken:job.token,purpose:job.purpose});
    if(outcome==='complete')completed++;
  }
  return {attempted:pending.length,completed};
}
