import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import type { BudgetCommitAuthority } from './isolate-admission.service';

/** One external delete or one bounded Vectorize delete batch. Provider bytes
 * remain outside the catalogue resource dimensions. */
export const RETENTION_STEP_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: 8,
  ...estimateDiagnosticEnvelope({ httpRequests: 0, detachedResourceCompositions: 1, credentialAuthRequests: 0, canonicalMutationRequests: 0 }),
});
export const RETENTION_R2_STEP_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({ ...RETENTION_STEP_ENVELOPE, r2ClassAOperations: 1 });
export type RetentionAdmission = Readonly<{ status: 'disabled' | 'admitted' | 'rejected'; reason?: 'exhausted' | 'unavailable'; authority?: BudgetCommitAuthority }>;

async function digest(parts: readonly unknown[]): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The scheduled scope is constructed only by automation composition. Recovery
 * uses a new, explicitly charged reservation; a missing provider response is
 * never interpreted as a refund or as successful cleanup. */
export async function admitRetentionStep(input: { env: Env; deps: TenantRequestDeps; ticketId: string; itemKey: string; attempt: number;
  resource: 'r2' | 'vector'; now: () => number }): Promise<RetentionAdmission> {
  const mode = input.env.BUDGET_ADMISSION_POLICY === undefined ? 'disabled' : ticketMutationAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode !== 'combined' || !input.env.BUDGET_COORDINATOR_DO || input.attempt < 1 || input.attempt > 1_000_000) return { status: 'rejected', reason: 'unavailable' };
  const operationFingerprint = await digest(['retention-v1', input.deps.scope.tenantId, input.ticketId, input.itemKey, input.attempt]);
  try {
    const outcome = await apiTicketBudgetCache.admit({ repository: input.deps.repositories.budgetAuthority, namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: input.deps.scope, credentialKey: `retention:${input.deps.scope.tenantId}:${input.ticketId}`,
      intent: { operationId: crypto.randomUUID(), operationFingerprint, workScopeKey: `scheduled.retention.${input.resource}` },
      business: input.resource === 'r2' ? RETENTION_R2_STEP_ENVELOPE : RETENTION_STEP_ENVELOPE,
      purpose: input.attempt === 1 ? 'new-work' : 'recovery', now: input.now,
      authorization: { authorize: scope => scope.tenantId === input.deps.scope.tenantId && scope.roles.includes('system') && scope.actorId === 'scheduled-retention'
        ? Promise.resolve({ kind: 'system' as const, actor: 'scheduled-retention' as const }) : Promise.resolve(null) },
    });
    if ((outcome.status === 'spent' || outcome.status === 'idempotent') && outcome.commitAuthority) return { status: 'admitted', authority: outcome.commitAuthority };
    return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
