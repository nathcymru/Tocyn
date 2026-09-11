import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export const API_TICKET_HISTORY_OPERATION = 'api.ticket.history' as const;

/**
 * The business read is bounded by one tenant ticket lookup, one optional
 * cursor lookup and at most 51 public events.  The conservative D1 allowance
 * also covers the live API-key recheck and two bounded authority snapshots
 * (including the post-cold-grant recheck); cold coordinator work is prepaid
 * separately by the isolate cache.  The measured native proof asserts the
 * route stays below this ceiling for full pages and cursors.
 */
export const API_TICKET_HISTORY_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1,
  d1RowsRead: 2_560,
  ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }),
});

export type ApiTicketHistoryAdmission = Readonly<{
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
 * Every HTTP execution receives a server-generated operation id.  Reads have
 * no durable replay receipt: a client retry can repeat the bounded query and
 * must consume another prepaid operation rather than inheriting an old spend.
 */
export async function admitApiTicketHistory(input: AdmissionInput): Promise<ApiTicketHistoryAdmission> {
  // The binding was optional before #64. Preserve that deployed contract;
  // an explicit malformed value still fails closed below.
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
      credentialKey: `api-history:${deps.scope.tenantId}:${apiKeyId}`,
      intent: {
        operationId: crypto.randomUUID(),
        operationFingerprint: await digest(['api-ticket-history-v1', deps.scope.tenantId, apiKeyId, input.ticketId,
          input.page.limit ?? null, input.page.cursor ?? null]),
        workScopeKey: API_TICKET_HISTORY_OPERATION,
      },
      business: API_TICKET_HISTORY_ENVELOPE,
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
