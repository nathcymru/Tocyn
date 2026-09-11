import { CANONICAL_MUTATION_D1_WRITES } from '../budgets/canonical-mutation-envelope';
import type { TicketMutationReplayService, PreparedTicketMutation } from '../services/ticket-mutation-replay.service';
import type { StaffTicketMutationService } from '../services/staff-ticket-mutation.service';
import type { PreparedStaffMutation } from '../types/staff-ticket-mutation';
import type { Context } from 'hono';
import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { AppVariables } from '../types';
import { IsolateBudgetAdmissionCache } from '../budgets/isolate-admission.service';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { estimateNotificationBroadcastWithCleanupEnvelope } from '../durable_objects/notification-resource-envelope';
import { sumResourceEnvelopes } from '../utils/cost-policy';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';

export const API_TICKET_BUDGET_POLICY = 'api-ticket-mutations-v1' as const;
export const STAFF_TICKET_BUDGET_POLICY = 'staff-ticket-mutations-v1' as const;
export const TICKET_MUTATIONS_BUDGET_POLICY = 'ticket-mutations-v1' as const;
export type ApiTicketBudgetOperation = 'api.ticket.create' | 'api.ticket.reply';
export type StaffTicketBudgetOperation = 'dashboard.ticket.create' | 'dashboard.ticket.reply';

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

/**
 * The staff operation reserves its entire bounded local composition: two HTTP
 * attempts, canonical and current-authority checks, ten attachment metadata
 * reads plus ten outbound streaming reads, and the worst permitted three
 * NotificationDO broadcasts with cleanup. Local capture has no external
 * provider unit. A real provider has no universal conversion here, so this
 * intentionally does not claim one.
 */
export const STAFF_TICKET_ENVELOPES: Readonly<Record<StaffTicketBudgetOperation, ResourceAmounts>> = Object.freeze({
  'dashboard.ticket.create': Object.freeze(sumResourceEnvelopes({
    workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
    r2ClassBOperations: 20,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }),
  }, estimateNotificationBroadcastWithCleanupEnvelope())),
  'dashboard.ticket.reply': Object.freeze(sumResourceEnvelopes({
    workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
    r2ClassBOperations: 20,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }),
  }, estimateNotificationBroadcastWithCleanupEnvelope())),
});
/** One bounded registry across binding contexts in this isolate; no request creates a new cache. */
export const apiTicketBudgetCache = new IsolateBudgetAdmissionCache();
/** Session and API operations share the one server-owned isolate registry; identities stay disjoint. */
export const sessionTicketBudgetAdmission = new SessionBudgetAdmissionService(apiTicketBudgetCache);

export function ticketMutationAdmissionMode(env: Env): 'disabled' | 'api' | 'staff' | 'combined' | 'invalid' {
  if (env.BUDGET_ADMISSION_POLICY === 'off') return 'disabled';
  if (env.BUDGET_ADMISSION_POLICY === API_TICKET_BUDGET_POLICY) return 'api';
  if (env.BUDGET_ADMISSION_POLICY === STAFF_TICKET_BUDGET_POLICY) return 'staff';
  if (env.BUDGET_ADMISSION_POLICY === TICKET_MUTATIONS_BUDGET_POLICY) return 'combined';
  return 'invalid';
}

/** Explicitly exposes the policy matrix to dashboard composition. */
export function staffTicketAdmissionMode(env: Env): 'disabled' | 'enabled' | 'invalid' {
  const configured = ticketMutationAdmissionMode(env);
  return configured === 'staff' || configured === 'combined' ? 'enabled'
    : configured === 'disabled' || configured === 'api' ? 'disabled' : 'invalid';
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
  const configured = ticketMutationAdmissionMode(c.env);
  if (configured === 'disabled' || configured === 'staff') return null;
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

/**
 * The dashboard-only counterpart to the API gate. `off` and API-only preserve
 * the documented legacy dashboard path; staff-only and combined modes never
 * fall through when authority is unavailable.
 */
export async function admitConfiguredStaffTicketMutation(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  operation: StaffTicketBudgetOperation,
  mutation: StaffTicketMutationService,
  prepared: PreparedStaffMutation,
): Promise<Response | null> {
  const configured = staffTicketAdmissionMode(c.env);
  if (configured === 'disabled') return null;
  if (configured === 'invalid' || !c.env.BUDGET_COORDINATOR_DO) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  try {
    const outcome = await mutation.admit(prepared);
    if (outcome.status === 'replayed') {
      c.header('Idempotency-Replayed', 'true');
      return c.json(outcome.outcome.body, outcome.outcome.status);
    }
    if ((outcome.status === 'spent' || outcome.status === 'idempotent') && outcome.commitAuthority) return null;
    if (outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted') {
      return c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429);
    }
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  } catch {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
}
