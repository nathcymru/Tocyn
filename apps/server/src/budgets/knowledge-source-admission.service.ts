import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { JWTPayload } from '../types';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import { sessionTicketBudgetAdmission, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { KNOWLEDGE_INDEX_CHUNK_BYTES, KNOWLEDGE_INDEX_MAX_CHUNKS } from '../repositories/knowledge-index.repository';

export const KNOWLEDGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
// Version + every manifest row + job + document state. A three-byte UTF-8
// source is the worst chunk packing case, so this is not inferred from an
// average token or character conversion.
const KNOWLEDGE_SOURCE_D1_WRITES = KNOWLEDGE_INDEX_MAX_CHUNKS + 3;

export const KNOWLEDGE_SOURCE_WRITE_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: KNOWLEDGE_SOURCE_D1_WRITES,
  r2StorageBytes: KNOWLEDGE_SOURCE_MAX_BYTES, r2ClassAOperations: 1,
  workflowExecutions: 1, workflowSteps: 1, workflowStorageBytes: 1_024,
  ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }),
});

function sourceEnvelope(sourceBytes: number): Readonly<ResourceAmounts> {
  // Three-byte UTF-8 scalars are the least dense legal chunk packing.
  const chunks = Math.max(1, Math.ceil(sourceBytes / 510));
  return Object.freeze({ ...KNOWLEDGE_SOURCE_WRITE_ENVELOPE, r2StorageBytes: sourceBytes, d1RowsWritten: chunks + 3 });
}

export type KnowledgeSourceAdmission = Readonly<{ status: 'disabled' | 'admitted' | 'rejected'; reason?: 'exhausted' | 'unavailable' }>;

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function fingerprint(parts: readonly unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Current staff authority gates the bounded R2 + manifest write before it begins. */
export async function admitKnowledgeSourceWrite(input: {
  env: Env; deps: TenantRequestDeps; payload: JWTPayload; sourceBytes: number; sourceKind: 'document'|'article'|'qa'; now: () => number;
}): Promise<KnowledgeSourceAdmission> {
  if (!Number.isSafeInteger(input.sourceBytes) || input.sourceBytes < 0 || input.sourceBytes > KNOWLEDGE_SOURCE_MAX_BYTES) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const mode = input.env.BUDGET_ADMISSION_POLICY === undefined ? 'disabled' : ticketMutationAdmissionMode(input.env);
  // Existing off-policy compatibility retains a manual, pending source but
  // never starts a provider workflow. Enabled policy has no unmetered bypass.
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode !== 'combined' || !input.env.BUDGET_COORDINATOR_DO) return { status: 'rejected', reason: 'unavailable' };
  const { deps, payload } = input;
  const sessionVersion = payload.session_version;
  const expiresAt = payload.exp;
  if ((payload.role !== 'admin' && payload.role !== 'agent') || payload.mfa_verified !== true
    || !validIdentity(deps.scope.tenantId) || !validIdentity(deps.scope.actorId)
    || payload.sub !== deps.scope.actorId || payload.tenant_id !== deps.scope.tenantId
    || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(expiresAt)) return { status: 'rejected', reason: 'unavailable' };
  const credential: SessionBudgetCredential = { tenantId: deps.scope.tenantId, actorId: payload.sub, role: payload.role,
    sessionVersion: sessionVersion as number, expiresAt: expiresAt as number, mfaVerified: true };
  try {
    const outcome = await sessionTicketBudgetAdmission.admit({ repository: deps.repositories.budgetAuthority,
      sessions: new SessionBudgetAuthorityRepository(deps.database, deps.scope), namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: deps.scope, credential, requirements: {},
      intent: { operationId: crypto.randomUUID(), operationFingerprint: await fingerprint(['knowledge-source-v1', deps.scope.tenantId, deps.scope.actorId, input.sourceKind, input.sourceBytes]), workScopeKey: 'knowledge.source.write' },
      business: sourceEnvelope(input.sourceBytes), now: input.now,
    });
    return outcome.status === 'spent' || outcome.status === 'idempotent' ? { status: 'admitted' }
      : { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}

/** Kept beside the envelope so handler bounds cannot drift from manifest bounds. */
export function validKnowledgeSourceText(text: string): boolean {
  return new TextEncoder().encode(text).byteLength <= KNOWLEDGE_SOURCE_MAX_BYTES
    && KNOWLEDGE_INDEX_CHUNK_BYTES === 512;
}
