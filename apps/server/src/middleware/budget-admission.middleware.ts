import { CANONICAL_MUTATION_D1_WRITES } from '../budgets/canonical-mutation-envelope';
import { TicketMutationError, type TicketMutationReplayService, type PreparedTicketMutation } from '../services/ticket-mutation-replay.service';
import type { StaffTicketMutationService } from '../services/staff-ticket-mutation.service';
import { CustomerCurrentCredentialRepository } from '../repositories/customer-current-credential.repository';
import type { PreparedStaffMutation } from '../types/staff-ticket-mutation';
import type { PreparedSupportSlaMutation, SupportSlaMutationOperation } from '../types/support-sla-mutation';
import type { SupportSlaMutationService } from '../services/support-sla-mutation.service';
import type { MutationOutcome } from '../types/ticket-mutation-replay';
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
export const TICKET_MUTATIONS_BUDGET_POLICY = 'ticket-mutations-v1' as const;
export type ApiTicketBudgetOperation = 'api.ticket.create' | 'api.ticket.reply' | 'api.ticket.update';
export type StaffTicketBudgetOperation = 'dashboard.ticket.create' | 'dashboard.ticket.reply' | 'dashboard.ticket.update';
export type CustomerTicketBudgetOperation = 'portal.ticket.create' | 'portal.ticket.reply';
export type SupportSlaBudgetOperation = SupportSlaMutationOperation;

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
  // An update has the same durable authority, receipt, audit and recovery
  // boundary as the other API mutations. It has no external provider work.
  'api.ticket.update': Object.freeze({ d1RowsRead: 2_560, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }), logEvents: (estimateDiagnosticEnvelope({ httpRequests: 2 }).logEvents ?? 0) + 2 }),
});

/**
 * The staff operation reserves these bounded resource dimensions across two HTTP
 * attempts, canonical/current-authority checks, up to two ten-attachment
 * metadata validation passes and one ten-attachment outbound stream pass.
 * It also includes the worst permitted three NotificationDO broadcasts with
 * cleanup. This only covers the listed resource dimensions: CPU/duration,
 * bytes, provider work and billing remain outside this estimate.
 */
export const STAFF_TICKET_ENVELOPES: Readonly<Record<StaffTicketBudgetOperation, ResourceAmounts>> = Object.freeze({
  'dashboard.ticket.create': Object.freeze(sumResourceEnvelopes({
    workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
    r2ClassBOperations: 30,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }),
  }, estimateNotificationBroadcastWithCleanupEnvelope())),
  'dashboard.ticket.reply': Object.freeze(sumResourceEnvelopes({
    workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
    r2ClassBOperations: 30,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }),
  }, estimateNotificationBroadcastWithCleanupEnvelope())),
  // Ticket field changes can write two event categories, their retained system
  // notes, the bounded receipt cleanup, and the dashboard notification.
  'dashboard.ticket.update': Object.freeze(sumResourceEnvelopes({
    workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }),
  }, estimateNotificationBroadcastWithCleanupEnvelope())),
});
/**
 * Customer messages have no outbound email work. Replies validate up to ten
 * attachment references and then broadcast one committed public article with
 * cleanup; creates and widget creates do not broadcast. Provider billing,
 * bytes and CPU remain outside this local reservation estimate.
 */
export const CUSTOMER_TICKET_ENVELOPES: Readonly<Record<CustomerTicketBudgetOperation, ResourceAmounts>> = Object.freeze({
  'portal.ticket.create': Object.freeze({ workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: CANONICAL_MUTATION_D1_WRITES,
    r2ClassBOperations: 30, ...estimateDiagnosticEnvelope({ httpRequests: 2 }) }),
  'portal.ticket.reply': Object.freeze(sumResourceEnvelopes({ workerRequests: 2, d1RowsRead: 2_570,
    d1RowsWritten: CANONICAL_MUTATION_D1_WRITES, r2ClassBOperations: 30,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }),
  }, estimateNotificationBroadcastWithCleanupEnvelope())),
});
/** Bounded support-state/SLA writes have no provider I/O. The remap can touch 100 tickets and its two audits. */
// The complete native 100-ticket SLA remap measured 5,437 reads and 2,810
// writes with 512-ticket same-tenant and foreign-tenant history prefixes,
// plus 150 expired receipts. The two #0049 state indexes add exactly 300 writes at this cap:
// definition update (+100), token set (+100), and token clear (+100).
const SUPPORT_SLA_D1_READS = Object.freeze({ ordinary: 2_570, deactivate: 8_192 });
const SUPPORT_SLA_D1_WRITES = Object.freeze({ ordinary: 2_048, deactivate: 4_096 });
export const SUPPORT_SLA_ENVELOPES: Readonly<Record<SupportSlaBudgetOperation, ResourceAmounts>> = Object.freeze({
  'dashboard.sla.policy.set': Object.freeze({ workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: SUPPORT_SLA_D1_WRITES.ordinary, ...estimateDiagnosticEnvelope({ httpRequests: 2 }) }),
  'dashboard.support-state.create': Object.freeze({ workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: SUPPORT_SLA_D1_WRITES.ordinary, ...estimateDiagnosticEnvelope({ httpRequests: 2 }) }),
  'dashboard.support-state.update': Object.freeze({ workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: SUPPORT_SLA_D1_WRITES.ordinary, ...estimateDiagnosticEnvelope({ httpRequests: 2 }) }),
  'dashboard.support-state.deactivate': Object.freeze({ workerRequests: 2, d1RowsRead: SUPPORT_SLA_D1_READS.deactivate, d1RowsWritten: SUPPORT_SLA_D1_WRITES.deactivate, ...estimateDiagnosticEnvelope({ httpRequests: 2 }) }),
  'dashboard.ticket.sla.initialize': Object.freeze({ workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: SUPPORT_SLA_D1_WRITES.ordinary, ...estimateDiagnosticEnvelope({ httpRequests: 2 }) }),
  'dashboard.ticket.support-state.transition': Object.freeze({ workerRequests: 2, d1RowsRead: 2_570, d1RowsWritten: SUPPORT_SLA_D1_WRITES.ordinary, ...estimateDiagnosticEnvelope({ httpRequests: 2 }) }),
});
/** One bounded registry across binding contexts in this isolate; no request creates a new cache. */
export const apiTicketBudgetCache = new IsolateBudgetAdmissionCache();
/** Session and API operations share the one server-owned isolate registry; identities stay disjoint. */
export const sessionTicketBudgetAdmission = new SessionBudgetAdmissionService(apiTicketBudgetCache);

export function ticketMutationAdmissionMode(env: Env): 'disabled' | 'api' | 'combined' | 'invalid' {
  if (env.BUDGET_ADMISSION_POLICY === 'off') return 'disabled';
  if (env.BUDGET_ADMISSION_POLICY === API_TICKET_BUDGET_POLICY) return 'api';
  if (env.BUDGET_ADMISSION_POLICY === TICKET_MUTATIONS_BUDGET_POLICY) return 'combined';
  return 'invalid';
}

/** Explicitly exposes the policy matrix to dashboard composition. */
export function staffTicketAdmissionMode(env: Env): 'disabled' | 'enabled' | 'invalid' {
  const configured = ticketMutationAdmissionMode(env);
  return configured === 'combined' ? 'enabled'
    : configured === 'disabled' || configured === 'api' ? 'disabled' : 'invalid';
}

/** Customer portal and authenticated widget writes are admitted only in combined mode. */
export function customerTicketAdmissionMode(env: Env): 'disabled' | 'enabled' | 'invalid' {
  const configured = ticketMutationAdmissionMode(env);
  return configured === 'combined' ? 'enabled'
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

/**
 * The dashboard-only counterpart to the API gate. `off` and API-only preserve
 * the documented legacy dashboard path; combined mode never falls through
 * when authority is unavailable.
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

/** Combined-policy admission for the six bounded dashboard support-state/SLA writes. */
export async function admitConfiguredSupportSlaMutation(
  c: Context<{ Bindings: Env; Variables: AppVariables }>, operation: SupportSlaBudgetOperation,
  mutation: SupportSlaMutationService, prepared: PreparedSupportSlaMutation,
): Promise<Response | null> {
  const configured = staffTicketAdmissionMode(c.env);
  if (configured === 'disabled') return null;
  if (configured === 'invalid' || !c.env.BUDGET_COORDINATOR_DO) return c.json({ code:'budget_admission_unavailable', error:'Budget admission authority is unavailable' },503);
  try {
    const outcome=await mutation.admit(prepared);
    if (outcome.status === 'replayed') { c.header('Idempotency-Replayed','true'); return c.json(outcome.outcome.body,outcome.outcome.status); }
    if ((outcome.status === 'spent' || outcome.status === 'idempotent') && outcome.commitAuthority) return null;
    return outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted'
      ? c.json({code:'budget_exhausted',error:'Configured budget capacity is exhausted'},429)
      : c.json({code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'},503);
  } catch (error) {
    if (error instanceof TicketMutationError) throw error;
    return c.json({code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'},503);
  }
}

/**
 * Customer writes use the same preallocated isolate cache, but their own live
 * identity/email/ownership adapter and their own canonical D1 assertion.
 */
export async function admitConfiguredCustomerTicketMutation(
  c: Context<{ Bindings: Env; Variables: AppVariables }>, operation: CustomerTicketBudgetOperation,
  mutation: TicketMutationReplayService, prepared: PreparedTicketMutation,
  projectReplayBody: (outcome: MutationOutcome) => unknown = outcome => outcome.body,
): Promise<Response | null> {
  const configured = customerTicketAdmissionMode(c.env);
  if (configured === 'disabled') return null;
  if (configured === 'invalid' || !c.env.BUDGET_COORDINATOR_DO) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  const deps = c.get('tenantDeps');
  if (!deps?.database || !deps.repositories?.budgetAuthority) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  try {
    const outcome = await mutation.admitCustomerBudget(prepared, {
      cache: apiTicketBudgetCache, repository: deps.repositories.budgetAuthority,
      customers: new CustomerCurrentCredentialRepository(deps.database, deps.scope), namespace: c.env.BUDGET_COORDINATOR_DO,
      operation, business: CUSTOMER_TICKET_ENVELOPES[operation], now: () => c.env.localNow?.() ?? Date.now(),
    });
    if (outcome.status === 'replayed') {
      c.header('Idempotency-Replayed', 'true');
      return c.json(projectReplayBody(outcome.outcome), outcome.outcome.status);
    }
    if (outcome.status === 'spent' || outcome.status === 'idempotent') return null;
    if (outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted') {
      return c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429);
    }
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  } catch {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
}
