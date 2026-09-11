import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { JWTPayload } from '../types';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import { sessionTicketBudgetAdmission, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { apiTicketBudgetCache } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { KNOWLEDGE_INDEX_CHUNK_BYTES, KNOWLEDGE_INDEX_MAX_CHUNKS } from '../repositories/knowledge-index.repository';
import type { BudgetCommitAuthority } from './isolate-admission.service';
import type { StaffMutationCommit } from '../types/staff-ticket-mutation';

export const KNOWLEDGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
// The HTTP request stores the source and creates one durable preparation job.
// Manifest and cleanup rows are admitted in fixed continuation batches.
// Version, preparation-job and current-document writes each maintain their
// primary/secondary lookup structures. Migration 0057 adds atomic list-counter
// maintenance to current-document publication. Native whole-attempt evidence is
// 24 writes for first-document upload, 23 for article update and 21 for QA
// staging; there is no
// uncharged external retry.
// Migration 0061 adds the document/source-kind index and provider-lease state.
// Native whole-attempt metadata is document 26, article 25 and QA 23.
const KNOWLEDGE_SOURCE_D1_WRITES = Object.freeze({ document: 26, article: 25, qa: 23 });

const sourceEnvelopeBase = (d1RowsWritten: number): Readonly<ResourceAmounts> => Object.freeze({
  workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten,
  r2StorageBytes: KNOWLEDGE_SOURCE_MAX_BYTES, r2ClassAOperations: 1,
  workflowExecutions: 1, workflowSteps: 1, workflowStorageBytes: 1_024,
  ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }),
});

export const KNOWLEDGE_SOURCE_WRITE_ENVELOPES: Readonly<Record<'document'|'article'|'qa',Readonly<ResourceAmounts>>> = Object.freeze({
  document: sourceEnvelopeBase(KNOWLEDGE_SOURCE_D1_WRITES.document),
  article: sourceEnvelopeBase(KNOWLEDGE_SOURCE_D1_WRITES.article),
  qa: sourceEnvelopeBase(KNOWLEDGE_SOURCE_D1_WRITES.qa),
});
/** Compatibility export for callers that need the maximum source-write shape. */
export const KNOWLEDGE_SOURCE_WRITE_ENVELOPE = KNOWLEDGE_SOURCE_WRITE_ENVELOPES.document;

function sourceEnvelope(sourceBytes: number, sourceKind: 'document'|'article'|'qa'): Readonly<ResourceAmounts> {
  return Object.freeze({ ...KNOWLEDGE_SOURCE_WRITE_ENVELOPES[sourceKind], r2StorageBytes: sourceBytes });
}

export type KnowledgeSourceCommitFence = Pick<StaffMutationCommit, 'credential'|'requirements'|'authority'>;
export class KnowledgeSourceAdmissionError extends Error {}

/** One admitted source attempt. The exact authority never crosses the handler
 * response boundary and can be started/settled only once. */
export class KnowledgeSourceCommit {
  private started = false;
  private settled = false;
  readonly fence: KnowledgeSourceCommitFence;
  constructor(private readonly deps: TenantRequestDeps, credential: SessionBudgetCredential,
    authority: BudgetCommitAuthority, private readonly now: () => number) {
    this.fence = Object.freeze({ credential: structuredClone(credential), requirements: Object.freeze({}), authority });
  }
  async start(): Promise<KnowledgeSourceCommitFence> {
    if (this.started || this.settled || this.now() >= this.fence.authority.expiresAt) throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable');
    this.started = true;
    await this.authorizeCurrent();
    return this.fence;
  }
  async authorizeCurrent(): Promise<void> {
    const checkedAt = this.now();
    if (this.settled || checkedAt >= this.fence.authority.expiresAt) throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable');
    const sessions = new SessionBudgetAuthorityRepository(this.deps.database,this.deps.scope);
    const principal = await sessions.authorize(this.fence.credential,this.fence.requirements,checkedAt);
    if (!principal) throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable');
    const current = await this.deps.repositories.budgetAuthority.resolveForVerifiedPrincipal(this.deps.scope,principal,checkedAt);
    if (current.kind !== 'active' || Object.entries(current.commitSnapshot).some(([key,value]) =>
      this.fence.authority.snapshot[key as keyof typeof current.commitSnapshot] !== value)) throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable');
  }
  settle(outcome: 'committed'|'unknown'): void {
    if (this.settled) return;
    this.settled = true;
    apiTicketBudgetCache.settleOperation(this.fence.authority,outcome,this.now());
  }
}

export type KnowledgeSourceAdmission =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'admitted'; commit: KnowledgeSourceCommit }>
  | Readonly<{ status: 'rejected'; reason: 'exhausted' | 'unavailable' }>;

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
      business: sourceEnvelope(input.sourceBytes,input.sourceKind), now: input.now,
    });
    const authority = outcome.status !== 'rejected' ? outcome.commitAuthority : undefined;
    return (outcome.status === 'spent' || outcome.status === 'idempotent') && authority
      ? { status: 'admitted', commit: new KnowledgeSourceCommit(deps,credential,authority,input.now) }
      : { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}

/** Kept beside the envelope so handler bounds cannot drift from manifest bounds. */
export function validKnowledgeSourceText(text: string): boolean {
  return new TextEncoder().encode(text).byteLength <= KNOWLEDGE_SOURCE_MAX_BYTES
    && KNOWLEDGE_INDEX_CHUNK_BYTES === 512;
}
