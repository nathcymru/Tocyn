import { CANONICAL_MUTATION_D1_WRITES } from '../budgets/canonical-mutation-envelope';
import type { TicketMutationReplayService, PreparedTicketMutation } from '../services/ticket-mutation-replay.service';
import type { Context } from 'hono';
import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { AppVariables } from '../types';
import { IsolateBudgetAdmissionCache } from '../budgets/isolate-admission.service';
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
  'api.ticket.create': Object.freeze({ d1RowsRead: 2_560, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }), logEvents: (estimateDiagnosticEnvelope({ httpRequests: 2 }).logEvents ?? 0) + 2 }),
  'api.ticket.reply': Object.freeze({ d1RowsRead: 2_560, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
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
  mutation: TicketMutationReplayService,
  prepared: PreparedTicketMutation,
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
    const outcome = await mutation.admitApiBudget(prepared, {
      cache: apiTicketBudgetCache, repository, namespace: c.env.BUDGET_COORDINATOR_DO,
      operation, business: API_TICKET_ENVELOPES[operation], now: () => c.env.localNow?.() ?? Date.now(),
    });
    if (outcome.status === 'replayed') {
      c.header('Idempotency-Replayed','true');
      return c.json(outcome.outcome.body,outcome.outcome.status);
    }
    // The prepared attempt privately retains the successful fence. An exact
    // second attempt may recover only through the atomic canonical receipt.
    if ((outcome.status === 'spent' || outcome.status === 'idempotent') && outcome.commitAuthority) return null;
    if (outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted') {
      return c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429);
    }
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  } catch {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
}
