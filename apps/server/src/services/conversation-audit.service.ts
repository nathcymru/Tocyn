import type { TenantRequestDeps } from '../middleware/tenant.middleware';

export class ConversationHistoryError extends Error {
  constructor(public status: 400 | 403 | 404, message: string) { super(message); }
}

/** Authorization precedes cursor/event lookup, including current article visibility. */
export class ConversationAuditService {
  constructor(private deps: TenantRequestDeps) {}

  async history(ticketId: string, audience: 'api' | 'staff' | 'customer', options: {limit?: string;cursor?: string}) {
    const limit = options.limit === undefined ? 50 : Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
      (options.cursor !== undefined && !/^[a-f0-9-]{36}$/i.test(options.cursor))) throw new ConversationHistoryError(400,'Invalid history page');
    const ticket = await this.deps.repositories.tickets.get(ticketId);
    if (!ticket) throw new ConversationHistoryError(404,'Ticket not found');
    const publicOnly = audience !== 'staff';
    if (audience === 'customer') {
      const user = await this.deps.repositories.users.get(this.deps.scope.actorId);
      if (!user || user.role !== 'customer' || ticket.customer_email !== user.email ||
        (ticket.customer_id !== null && ticket.customer_id !== user.id)) throw new ConversationHistoryError(404,'Ticket not found');
    } else if (audience === 'staff' && this.deps.scope.roles.includes('agent') && ticket.group_id &&
      !await this.deps.repositories.groups.isMember(ticket.group_id,this.deps.scope.actorId)) {
      throw new ConversationHistoryError(403,'Forbidden');
    }
    const result = await this.deps.conversationAudit.history(ticketId,publicOnly,limit,options.cursor);
    if (!result) throw new ConversationHistoryError(400,'Invalid history cursor');
    return {
      events:result.rows.map(event => ({
        id:event.id,kind:event.kind,recordedAt:event.recorded_at,source:event.source,visibility:event.visibility,
        actor:publicOnly ? {kind:event.actor_kind === 'customer' ? 'requester' : 'support',provenance:event.actor_provenance}
          : {kind:event.actor_kind,id:event.actor_id,provenance:event.actor_provenance},
        facts:publicOnly ? {} : JSON.parse(event.facts) as Record<string,unknown>,articleId:event.article_id,
        ...(publicOnly ? {} : {sequence:event.sequence}),
      })),nextCursor:result.nextCursor,
    };
  }
}
