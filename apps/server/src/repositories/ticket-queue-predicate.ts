import { DRAFT_EXPIRY_SQL } from '../types/operator-draft-retention';
import type { TicketQueueInclusionReason, TicketQueueKey } from '../types/ticket-queue';

export type TicketQueuePredicate = Readonly<{
  inclusionReason: TicketQueueInclusionReason;
  sql: string;
  values: readonly unknown[];
}>;

/** Only membership is read; recipient activity facts never leave this predicate. */
export function ticketMentionPredicate(ticketAlias: string, actorId: string): TicketQueuePredicate {
  if (!actorId) throw new Error('Mentions queue requires an operator');
  return { inclusionReason: 'mentions', values: [actorId],
    sql: `EXISTS (SELECT 1 FROM operator_activities queue_mention
      WHERE queue_mention.tenant_id=${ticketAlias}.tenant_id AND queue_mention.recipient_user_id=?
        AND queue_mention.ticket_id=${ticketAlias}.id AND queue_mention.kind='mention' AND queue_mention.dismissed_at IS NULL)` };
}

/**
 * Support-state queues use the canonical projection, not a client clock. Due
 * snoozes remain Snoozed until the controlled resurface worker clears their
 * canonical deadline, so list and count cannot disagree around a browser's
 * notion of "now".
 */
export function ticketQueuePredicate(queue: TicketQueueKey, ticketAlias = 'tickets', operator?: Readonly<{ actorId: string; notExpiredAt?: string }>): TicketQueuePredicate {
  if (queue === 'mentions') {
    const actionable=ticketQueuePredicate('actionable',ticketAlias);
    const mention=ticketMentionPredicate(ticketAlias,operator?.actorId ?? '');
    return {inclusionReason:'mentions',sql:`${actionable.sql} AND ${mention.sql}`,values:mention.values};
  }
  if (queue === 'drafts') {
    if (!operator?.actorId) throw new Error('Draft queue requires an operator');
    const expiry = DRAFT_EXPIRY_SQL.replaceAll('expires_at', 'queue_draft.expires_at').replaceAll('updated_at', 'queue_draft.updated_at');
    return { inclusionReason: 'drafts', values: [operator.actorId, ...(operator.notExpiredAt ? [operator.notExpiredAt] : [])],
      sql: `EXISTS (SELECT 1 FROM operator_drafts queue_draft
        WHERE queue_draft.tenant_id=${ticketAlias}.tenant_id AND queue_draft.ticket_id=${ticketAlias}.id
          AND queue_draft.user_id=?${operator.notExpiredAt ? ` AND ${expiry}>?` : ''})` };
  }
  const state = `ticket_support_state queue_state JOIN support_state_definitions queue_definition
    ON queue_definition.tenant_id=queue_state.tenant_id AND queue_definition.id=queue_state.definition_id
    WHERE queue_state.tenant_id=${ticketAlias}.tenant_id AND queue_state.ticket_id=${ticketAlias}.id`;
  if (queue === 'actionable' || queue === 'mine' || queue === 'unassigned') {
    if (queue === 'mine' && !operator?.actorId) throw new Error('Mine queue requires an operator');
    const ownership = queue === 'mine' ? ` AND ${ticketAlias}.assigned_to=?`
      : queue === 'unassigned' ? ` AND ${ticketAlias}.assigned_to IS NULL` : '';
    return {
      inclusionReason: queue, values: queue === 'mine' ? [operator!.actorId] : [],
      sql: `EXISTS (SELECT 1 FROM ${state}
        AND queue_definition.legacy_status IN ('open','pending') AND queue_state.snoozed_until IS NULL)${ownership}`,
    };
  }
  if (queue !== 'snoozed') throw new Error('Unknown ticket queue');
  return {
    inclusionReason: 'snoozed', values: [],
    sql: `EXISTS (SELECT 1 FROM ${state} AND queue_state.snoozed_until IS NOT NULL)`,
  };
}
