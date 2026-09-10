import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { Env } from '../bindings';
import { createSystemTenantScope } from '../auth/scope';
import { createTenantRequestDeps } from '../middleware/tenant.middleware';
import { TenantKnowledgeService } from '../services/tenant-knowledge.service';
import { StatelessAiService } from '../services/ai.service';
import { measureResourceOperation } from '../observability/resource-operation';

export type VectorizeJob = {
  tenantId: string;
  action: 'create' | 'update' | 'qa_mark';
  documentId: string;
  qaType?: 'answer' | 'sop' | null;
};

/** Workflow events originate from trusted server-side bindings, never public JSON. */
export class VectorizeWorkflow extends WorkflowEntrypoint<Env, VectorizeJob> {
  async run(event: WorkflowEvent<VectorizeJob>, step: WorkflowStep) {
    if (this.env.LOCAL_BETA_ENABLED !== undefined && this.env.LOCAL_BETA_ENABLED !== 'false') throw new Error('Vector workflows are disabled in the local beta');
    const { tenantId, action, documentId, qaType } = event.payload;
    if (typeof tenantId !== 'string' || !tenantId.trim() || typeof documentId !== 'string' || !documentId.trim()) {
      throw new Error('Scoped workflow identity required; legacy jobs require an explicit migration');
    }
    if (!['create', 'update', 'qa_mark'].includes(action)) throw new Error('Invalid workflow action');
    const scope = createSystemTenantScope({ tenantId, actor: 'vectorize-workflow' });
    const deps = createTenantRequestDeps(scope, this.env);
    const service = new TenantKnowledgeService(deps, new StatelessAiService(this.env.AI, deps.emitResourceOperation));
    // This records the Workflow step invocation. A cached Workflow step can complete
    // without running this callback, so its latency is not callback execution time.
    await measureResourceOperation({ resource: 'workflow', operation: 'run', emit: deps.emitResourceOperation, execute: () => step.do('apply_scoped_vectorization', async () => {
      if (action === 'qa_mark') {
        if (qaType != null && qaType !== 'answer' && qaType !== 'sop') throw new Error('Invalid QA type');
        await service.markArticleAsQA(documentId, qaType ?? null);
      } else {
        const doc = await service.getDocument(documentId);
        if (!doc) throw new Error('Document not found');
        // A background retry must never republish a document withdrawn by an editor.
        if (doc.status === 'published') await service.publishDocument(documentId);
      }
    }) });
  }
}
