import type { Ticket } from '../types';
import type { TicketRepository } from './interfaces';
import type { OperatorWorkspaceSort } from '../types/operator-workspace';
import type { TicketQueueInclusionReason, TicketQueueKey, TicketQueuePage } from '../types/ticket-queue';
import type { TicketListCurrentCredential, TicketListScanSnapshot } from './ticket-list-scan.repository';

export type TicketQueueListOptions = Readonly<{
  queue: TicketQueueKey;
  page?: number;
  limit?: number;
  filterId?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  groupId?: string;
  ticketNo?: string;
  search?: string;
  sort?: OperatorWorkspaceSort;
  viewer?: Readonly<{ role: 'admin' | 'agent'; actorId: string }>;
  /** Optional existing list admission fence; queue reads never bypass it. */
  scanFence?: TicketListScanSnapshot;
  currentCredential?: TicketListCurrentCredential;
}>;

function reasonFor(queue: TicketQueueKey): TicketQueueInclusionReason {
  return queue;
}

/**
 * Queue reads intentionally delegate to the established ticket-list contract.
 * That keeps saved filters, visibility rules, page limits, and the count/page
 * predicate in one implementation while the queue key adds only its
 * authoritative support-state condition.
 */
export class TicketQueueRepository {
  constructor(private readonly tickets: TicketRepository) {}

  async list(options: TicketQueueListOptions): Promise<TicketQueuePage<Ticket>> {
    const page = await this.tickets.list(options);
    const inclusionReason = reasonFor(options.queue);
    return {
      items: page.data.map(ticket => ({ ticket, inclusionReason })),
      total: page.total,
      page: page.meta.page,
      limit: page.meta.limit,
      totalPages: page.meta.total_pages,
    };
  }

  /** Count and list share TicketRepository.list's single queue predicate. */
  async count(options: Omit<TicketQueueListOptions, 'page' | 'limit'>): Promise<number> {
    return (await this.tickets.list({ ...options, page: 1, limit: 1 })).total;
  }
}
