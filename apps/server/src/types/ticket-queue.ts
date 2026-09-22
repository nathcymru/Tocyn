/**
 * Queue keys are server-owned classifications. They are deliberately separate
 * from saved filter IDs: a saved filter can refine a queue but cannot replace
 * its support-state predicate.
 */
export const TICKET_QUEUE_KEYS = ['actionable', 'snoozed', 'drafts', 'mine', 'unassigned', 'mentions'] as const;
export type TicketQueueKey = typeof TICKET_QUEUE_KEYS[number];

export type TicketQueueInclusionReason = TicketQueueKey;

export type TicketQueueItem<T> = Readonly<{
  ticket: T;
  inclusionReason: TicketQueueInclusionReason;
}>;

export type TicketQueuePage<T> = Readonly<{
  items: readonly TicketQueueItem<T>[];
  /** Exact for this bounded ticket-list contract and its supplied filters. */
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}>;

export type TicketQueueCounts = Readonly<{
  scope: 'standard_queues';
  counts: Readonly<Record<TicketQueueKey | 'all', number>>;
  /** Visible, active fixed-hour clocks strictly past their deadline at the server's read instant. */
  triageOverdueCount: number;
}>;
