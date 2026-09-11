import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export const API_TICKET_DETAIL_OPERATION = 'api.ticket.detail' as const;

/**
 * One admitted detail execution reads a tenant-scoped ticket, at most 51
 * article metadata rows, 501 attachment rows, 50 articles, and 51 public
 * canonical references.  The remaining allowance covers the live key check
 * and the two bounded authority snapshots used by cold grant admission.
 */
export const API_TICKET_DETAIL_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1,
  d1RowsRead: 2_560,
  ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }),
});

export type ApiTicketDetailAdmission = Readonly<{
  status: 'disabled' | 'admitted' | 'rejected';
  reason?: 'exhausted' | 'unavailable';
}>;

type AdmissionInput = Readonly<{
  env: Env;
  deps: TenantRequestDeps;
  apiKeyId: string;
  ticketId: string;
  page: Readonly<{ limit?: string; cursor?: string }>;
  now: () => number;
}>;

async function digest(input: readonly unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result)).map(value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * A detail page is independently charged for every HTTP execution.  Its
 * authorization callback rechecks the current active API key and
 * `tickets:read` permission before any ticket/article business lookup.
 */
export async function admitApiTicketDetail(input: AdmissionInput): Promise<ApiTicketDetailAdmission> {
  // Preserve the historical optional policy binding.  Explicit configuration
  // always fails closed; an absent binding keeps existing installations live.
  if (input.env.BUDGET_ADMISSION_POLICY === undefined) return { status: 'disabled' };
  const mode = ticketMutationAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode === 'invalid' || !input.env.BUDGET_COORDINATOR_DO) return { status: 'rejected', reason: 'unavailable' };
  const { deps, apiKeyId } = input;
  if (deps.scope.actorId !== apiKeyId || !deps.scope.roles.includes('integration')) return { status: 'rejected', reason: 'unavailable' };
  try {
    const outcome = await apiTicketBudgetCache.admit({
      repository: deps.repositories.budgetAuthority,
      namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: deps.scope,
      credentialKey: `api-detail:${deps.scope.tenantId}:${apiKeyId}`,
      intent: {
        operationId: crypto.randomUUID(),
        operationFingerprint: await digest(['api-ticket-detail-v1', deps.scope.tenantId, apiKeyId, input.ticketId,
          input.page.limit ?? null, input.page.cursor ?? null]),
        workScopeKey: API_TICKET_DETAIL_OPERATION,
      },
      business: API_TICKET_DETAIL_ENVELOPE,
      now: input.now,
      authorization: { authorize: scope => scope.tenantId === deps.scope.tenantId && scope.actorId === apiKeyId
        ? deps.repositories.budgetAuthority.authorizeApiKeyTicketRead(scope, deps.scope.tenantId, apiKeyId)
        : Promise.resolve(null) },
    });
    if (outcome.status === 'spent' || outcome.status === 'idempotent') return { status: 'admitted' };
    return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted'
      ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
