import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { Env } from '../bindings';
import { createSystemTenantScope } from '../auth/scope';
import { createTenantRequestDeps } from '../middleware/tenant.middleware';
import { TenantKnowledgeService } from '../services/tenant-knowledge.service';
import { StatelessAiService } from '../services/ai.service';
import { measureResourceOperation } from '../observability/resource-operation';
import { KnowledgeIndexRepository } from '../repositories/knowledge-index.repository';
import { admitKnowledgeIndexChunk } from '../budgets/knowledge-index-admission.service';

export type VectorizeJob = {
  tenantId: string;
  action: 'create' | 'update' | 'qa_mark' | 'index' | 'qa_index';
  documentId: string;
  qaType?: 'answer' | 'sop' | null;
  version?: number;
};

function validWorkflowIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Workflow events originate from trusted server-side bindings, never public JSON. */
export class VectorizeWorkflow extends WorkflowEntrypoint<Env, VectorizeJob> {
  async run(event: WorkflowEvent<VectorizeJob>, step: WorkflowStep) {
    if (this.env.LOCAL_BETA_ENABLED !== undefined && this.env.LOCAL_BETA_ENABLED !== 'false') throw new Error('Vector workflows are disabled in the local beta');
    const { tenantId, action, documentId, version } = event.payload;
    if (!validWorkflowIdentity(tenantId) || !validWorkflowIdentity(documentId)) {
      throw new Error('Scoped workflow identity required; legacy jobs require an explicit migration');
    }
    if (!['create', 'update', 'qa_mark', 'index', 'qa_index'].includes(action)) throw new Error('Invalid workflow action');
    if (action !== 'index' && action !== 'qa_index') {
      // The binding remains deployed for job delivery, but legacy jobs do not
      // carry a bounded source/version or an admitted provider envelope.
      throw new Error('Legacy vector jobs require a durable manifest migration');
    }
    const scope = createSystemTenantScope({ tenantId, actor: 'vectorize-workflow' });
    const deps = createTenantRequestDeps(scope, this.env);
    const service = new TenantKnowledgeService(deps, new StatelessAiService(this.env.AI, deps.emitResourceOperation));
    // This records the Workflow step invocation. A cached Workflow step can complete
    // without running this callback, so its latency is not callback execution time.
    await measureResourceOperation({ resource: 'workflow', operation: 'run', emit: deps.emitResourceOperation, execute: () => step.do('apply_scoped_vectorization', async () => {
      if (action === 'index' || action === 'qa_index') {
        if (!Number.isSafeInteger(version) || version! < 1) throw new Error('Knowledge index version required');
        const index = new KnowledgeIndexRepository(deps.database, scope);
        const chunkIndex = await index.next(documentId, version!);
        if (chunkIndex === null) { await index.completeIfFinished(documentId, version!); return; }
        const admission = await admitKnowledgeIndexChunk({ env: this.env, deps, documentId, version: version!, chunkIndex,
          now: () => this.env.localNow?.() ?? Date.now() });
        // Disabled/exhausted authority deliberately leaves a durable pending
        // job. It does not invoke a provider or turn source capture into loss.
        if (admission.status !== 'admitted') return;
        const outcome = action === 'index'
          ? await service.indexManifestChunk(documentId, version!, chunkIndex)
          : await service.indexQaManifestChunk(documentId, version!, chunkIndex);
        if (outcome === 'next') {
          // The next claim is durable before dispatch. A lost create response
          // can produce a duplicate workflow, but never a second provider claim.
          if (await index.reserveDispatch(documentId, version!)) {
            await this.env.VECTORIZE_WORKFLOW.create({ params: { tenantId, action, documentId, version } });
          }
        }
        return;
      }
    }) });
  }
}
