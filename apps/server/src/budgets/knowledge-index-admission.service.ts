import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export const KNOWLEDGE_INDEX_CHUNK_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  // One admitted chunk execution also reserves its one durable continuation
  // dispatch. Source R2 publication happens before this work item exists.
  workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: 16,
  workflowExecutions: 2, workflowSteps: 2, workflowStorageBytes: 1_024,
  // BGE Large: 18,582 micro-neurons/M tokens × conservative 512-token chunk.
  aiMicroNeurons: 9_513_984, vectorStoredDimensions: 1_024,
  ...estimateDiagnosticEnvelope({ httpRequests: 0, detachedResourceCompositions: 1, credentialAuthRequests: 0, canonicalMutationRequests: 0 }),
});

/** A source preparation callback reads one fixed R2 window and writes no more
 * than 100 indexed D1 rows plus its durable cursor. */
export const KNOWLEDGE_MANIFEST_BATCH_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  // 100 chunk rows maintain both their primary and pending indexes. Cursor
  // and version updates retain room for their indexed rows as well.
  workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: 512,
  d1StorageBytes: 131_072, r2ClassBOperations: 1,
  workflowExecutions: 2, workflowSteps: 2, workflowStorageBytes: 1_024,
  ...estimateDiagnosticEnvelope({ httpRequests: 0, detachedResourceCompositions: 1, credentialAuthRequests: 0, canonicalMutationRequests: 0 }),
});

export const KNOWLEDGE_CLEANUP_BATCH_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  // Claim/release completion touches the same two chunk indexes per row.
  workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: 512,
  workflowExecutions: 2, workflowSteps: 2, workflowStorageBytes: 1_024,
  ...estimateDiagnosticEnvelope({ httpRequests: 0, detachedResourceCompositions: 1, credentialAuthRequests: 0, canonicalMutationRequests: 0 }),
});

export type KnowledgeIndexAdmission = Readonly<{ status: 'disabled' | 'admitted' | 'rejected'; reason?: 'exhausted' | 'unavailable' }>;

async function fingerprint(parts: readonly unknown[]): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
}

/** A workflow spends one current, independently admitted chunk attempt. */
export async function admitKnowledgeIndexChunk(input: { env: Env; deps: TenantRequestDeps; documentId: string; version: number; chunkIndex: number; now: () => number }): Promise<KnowledgeIndexAdmission> {
  const mode = input.env.BUDGET_ADMISSION_POLICY === undefined ? 'disabled' : ticketMutationAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode !== 'combined' || !input.env.BUDGET_COORDINATOR_DO) return { status: 'rejected', reason: 'unavailable' };
  try {
    const outcome = await apiTicketBudgetCache.admit({
      repository: input.deps.repositories.budgetAuthority, namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: input.deps.scope, credentialKey: `knowledge-index:${input.deps.scope.tenantId}:${input.documentId}:${input.version}:${input.chunkIndex}`,
      intent: { operationId: crypto.randomUUID(), operationFingerprint: await fingerprint(['knowledge-index-v1', input.deps.scope.tenantId, input.documentId, input.version, input.chunkIndex]), workScopeKey: 'knowledge.index.chunk' },
      business: KNOWLEDGE_INDEX_CHUNK_ENVELOPE, now: input.now,
      authorization: { authorize: scope => scope.tenantId === input.deps.scope.tenantId && scope.roles.includes('system') && scope.actorId === 'vectorize-workflow'
        ? Promise.resolve({ kind: 'system' as const, actor: 'vectorize-workflow' as const }) : Promise.resolve(null) },
    });
    if (outcome.status === 'spent' || outcome.status === 'idempotent') return { status: 'admitted' };
    return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}

/** The source capture and every manifest continuation are separately charged;
 * a full-size source can never turn one HTTP admission into 20k D1 writes. */
export async function admitKnowledgeManifestBatch(input: { env: Env; deps: TenantRequestDeps; documentId: string; version: number; now: () => number }): Promise<KnowledgeIndexAdmission> {
  const mode = input.env.BUDGET_ADMISSION_POLICY === undefined ? 'disabled' : ticketMutationAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode !== 'combined' || !input.env.BUDGET_COORDINATOR_DO) return { status: 'rejected', reason: 'unavailable' };
  try {
    const outcome = await apiTicketBudgetCache.admit({
      repository: input.deps.repositories.budgetAuthority, namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: input.deps.scope, credentialKey: `knowledge-manifest:${input.deps.scope.tenantId}:${input.documentId}:${input.version}`,
      intent: { operationId: crypto.randomUUID(), operationFingerprint: await fingerprint(['knowledge-manifest-v1', input.deps.scope.tenantId, input.documentId, input.version]), workScopeKey: 'knowledge.manifest.batch' },
      business: KNOWLEDGE_MANIFEST_BATCH_ENVELOPE, now: input.now,
      authorization: { authorize: scope => scope.tenantId === input.deps.scope.tenantId && scope.roles.includes('system') && scope.actorId === 'vectorize-workflow'
        ? Promise.resolve({ kind: 'system' as const, actor: 'vectorize-workflow' as const }) : Promise.resolve(null) },
    });
    if (outcome.status === 'spent' || outcome.status === 'idempotent') return { status: 'admitted' };
    return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}

export async function admitKnowledgeCleanupBatch(input: { env: Env; deps: TenantRequestDeps; documentId: string; now: () => number }): Promise<KnowledgeIndexAdmission> {
  const mode = input.env.BUDGET_ADMISSION_POLICY === undefined ? 'disabled' : ticketMutationAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode !== 'combined' || !input.env.BUDGET_COORDINATOR_DO) return { status: 'rejected', reason: 'unavailable' };
  try {
    const outcome = await apiTicketBudgetCache.admit({ repository: input.deps.repositories.budgetAuthority, namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: input.deps.scope, credentialKey: `knowledge-cleanup:${input.deps.scope.tenantId}:${input.documentId}`,
      intent: { operationId: crypto.randomUUID(), operationFingerprint: await fingerprint(['knowledge-cleanup-v1', input.deps.scope.tenantId, input.documentId]), workScopeKey: 'knowledge.cleanup.batch' },
      business: KNOWLEDGE_CLEANUP_BATCH_ENVELOPE, now: input.now,
      authorization: { authorize: scope => scope.tenantId === input.deps.scope.tenantId && scope.roles.includes('system') && scope.actorId === 'vectorize-workflow'
        ? Promise.resolve({ kind: 'system' as const, actor: 'vectorize-workflow' as const }) : Promise.resolve(null) },
    });
    if (outcome.status === 'spent' || outcome.status === 'idempotent') return { status: 'admitted' };
    return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
