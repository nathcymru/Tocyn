import type { TicketQueueInclusionReason, TicketQueueKey } from '../types/ticket-queue';

export type TicketQueuePredicate = Readonly<{
  inclusionReason: TicketQueueInclusionReason;
  sql: string;
  values: readonly unknown[];
}>;

/**
 * The support-state projection, not a client clock, classifies queues. Due
 * snoozes remain Snoozed until the controlled resurface worker clears their
 * canonical deadline, so list and count cannot disagree around a browser's
 * notion of "now".
 */
export function ticketQueuePredicate(queue: TicketQueueKey, ticketAlias = 'tickets'): TicketQueuePredicate {
  const state = `ticket_support_state queue_state JOIN support_state_definitions queue_definition
    ON queue_definition.tenant_id=queue_state.tenant_id AND queue_definition.id=queue_state.definition_id
    WHERE queue_state.tenant_id=${ticketAlias}.tenant_id AND queue_state.ticket_id=${ticketAlias}.id`;
  if (queue === 'actionable') {
    return {
      inclusionReason: 'actionable', values: [],
      sql: `EXISTS (SELECT 1 FROM ${state}
        AND queue_definition.legacy_status IN ('open','pending') AND queue_state.snoozed_until IS NULL)`,
    };
  }
  return {
    inclusionReason: 'snoozed', values: [],
    sql: `EXISTS (SELECT 1 FROM ${state} AND queue_state.snoozed_until IS NOT NULL)`,
  };
}
