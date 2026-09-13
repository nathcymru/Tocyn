import { DRAFT_EXPIRY_SQL } from '../types/operator-draft-retention';
import type { TicketQueueInclusionReason, TicketQueueKey } from '../types/ticket-queue';

export type TicketQueuePredicate = Readonly<{
  inclusionReason: TicketQueueInclusionReason;
  sql: string;
  values: readonly unknown[];
}>;

/**
 * Support-state queues use the canonical projection, not a client clock. Due
 * snoozes remain Snoozed until the controlled resurface worker clears their
 * canonical deadline, so list and count cannot disagree around a browser's
 * notion of "now".
 */
export function ticketQueuePredicate(queue: TicketQueueKey, ticketAlias = 'tickets', draft?: Readonly<{ actorId: string; notExpiredAt?: string }>): TicketQueuePredicate {
  if (queue === 'drafts') {
    if (!draft?.actorId) throw new Error('Draft queue requires an operator');
    const expiry = DRAFT_EXPIRY_SQL.replaceAll('expires_at', 'queue_draft.expires_at').replaceAll('updated_at', 'queue_draft.updated_at');
    return { inclusionReason: 'drafts', values: [draft.actorId, ...(draft.notExpiredAt ? [draft.notExpiredAt] : [])],
      sql: `EXISTS (SELECT 1 FROM operator_drafts queue_draft
        WHERE queue_draft.tenant_id=${ticketAlias}.tenant_id AND queue_draft.ticket_id=${ticketAlias}.id
          AND queue_draft.user_id=?${draft.notExpiredAt ? ` AND ${expiry}>?` : ''})` };
  }
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
  if (queue !== 'snoozed') throw new Error('Unknown ticket queue');
  return {
    inclusionReason: 'snoozed', values: [],
    sql: `EXISTS (SELECT 1 FROM ${state} AND queue_state.snoozed_until IS NOT NULL)`,
  };
}
