import type { Context } from 'hono';
import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { AppVariables } from '../types';
import { IsolateBudgetAdmissionCache, type CanonicalBudgetIntent } from '../budgets/isolate-admission.service';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export const API_TICKET_BUDGET_POLICY = 'api-ticket-mutations-v1' as const;
export type ApiTicketBudgetOperation = 'api.ticket.create' | 'api.ticket.reply';

/**
 * Conservative estimated business/retry envelope, excluding the separately
 * prepaid warm credential controls and cold allocation overhead. The extra
 * 1,536 reads cover a current-authority recheck after awaiting a shared cold
 * grant; 1,024 cover canonical authorization, receipt and mutation reads.
 * Diagnostic events include two request compositions plus invocation margin.
 * Provider metering is unmeasured; no billing guarantee is claimed.
 */
export const API_TICKET_ENVELOPES: Readonly<Record<ApiTicketBudgetOperation, ResourceAmounts>> = Object.freeze({
  'api.ticket.create': Object.freeze({ d1RowsRead: 2_560, d1RowsWritten: 64,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }), logEvents: (estimateDiagnosticEnvelope({ httpRequests: 2 }).logEvents ?? 0) + 2 }),
  'api.ticket.reply': Object.freeze({ d1RowsRead: 2_560, d1RowsWritten: 64,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }), logEvents: (estimateDiagnosticEnvelope({ httpRequests: 2 }).logEvents ?? 0) + 2 }),
});
/** One bounded registry across binding contexts in this isolate; no request creates a new cache. */
export const apiTicketBudgetCache = new IsolateBudgetAdmissionCache();

function mode(env: Env): 'disabled' | 'enabled' | 'invalid' {
  if (env.BUDGET_ADMISSION_POLICY === 'off') return 'disabled';
  return env.BUDGET_ADMISSION_POLICY === API_TICKET_BUDGET_POLICY ? 'enabled' : 'invalid';
}

/**
 * Server-owned active admission for two API-key mutation routes only. An
 * explicit configured policy enables it; malformed configuration or missing
 * authority/bindings is a 503 and never falls through to a mutation commit.
 */
export async function admitConfiguredApiTicketMutation(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  operation: ApiTicketBudgetOperation,
  canonicalIntent: () => Promise<CanonicalBudgetIntent>,
): Promise<Response | null> {
  const configured = mode(c.env);
  if (configured === 'disabled') return null;
  if (configured === 'invalid' || !c.env.BUDGET_COORDINATOR_DO) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  const scope = c.get('tenantScope');
  const resolution = c.get('apiKeyResolution');
  const repository = c.get('tenantDeps')?.repositories.budgetAuthority;
  if (!scope || !resolution || !repository) return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  try {
    const intent = await canonicalIntent();
    const outcome = await apiTicketBudgetCache.admit({
      repository, namespace: c.env.BUDGET_COORDINATOR_DO,
      authorization: { authorize: current => repository.authorizeApiKeyTicket(current, resolution.tenantId, resolution.apiKeyId) }, scope,
      credentialKey: `api-key:${resolution.apiKeyId}:tickets:write`, intent,
      business: API_TICKET_ENVELOPES[operation], now: () => c.env.localNow?.() ?? Date.now(),
    });
    if (outcome.status === 'spent') return null;
    // An in-flight or failed canonical mutation must not execute again merely
    // because a local budget receipt exists. A durable completed replay is
    // handled by the mutation service before this admission boundary.
    if (outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted') {
      return c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429);
    }
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  } catch {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
}
