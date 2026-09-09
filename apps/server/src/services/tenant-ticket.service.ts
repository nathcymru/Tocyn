import type { ConversationActor } from '../types/conversation-audit';
import type { VerifiedMutationAttachment } from '../types/ticket-mutation-replay';
import { TenantArticleBodyHydrator } from '../storage/adapters';
import { Ticket, Article, Attachment } from '../types';
import { TenantRequestDeps } from '../middleware/tenant.middleware';
import {
  ArticleWithCanonicalAttachments,
  CanonicalConversation,
} from '../types/canonical-conversation';
import { projectCanonicalConversation as project } from './canonical-conversation.service';

export type InitialConversationInput = {
  subject: string;
  customer_email: string;
  source: Ticket['source'];
  body: string;
  sender_type: Article['sender_type'];
  sender_id?: string;
  status?: Ticket['status'];
  priority?: Ticket['priority'];
  assigned_to?: string | null;
  group_id?: string | null;
  customer_id?: string | null;
  source_email?: string | null;
  custom_fields?: Ticket['custom_fields'];
};

export class TenantTicketService {
  constructor(private deps: TenantRequestDeps) {}

  async findTickets({ page, limit, customerEmail }: { page: number, limit: number, customerEmail: string }) {
    return this.deps.repositories.tickets.findCustomerTickets(customerEmail, page, limit);
  }

  async findTicketById(id: string): Promise<Ticket | null> {
    return this.deps.repositories.tickets.get(id);
  }

  async createTicket(data: Omit<Ticket, 'id' | 'created_at' | 'updated_at' | 'ticket_no'>): Promise<Ticket> {
    const observedAt = new Date().toISOString();
    return this.deps.repositories.tickets.create({
      ...data,
      intake_received_at: observedAt,
      intake_processed_at: observedAt,
    });
  }

  async createTicketWithArticle(data: InitialConversationInput, actor?: ConversationActor): Promise<{ ticket: Ticket, article: Article }> {
    const observedAt = new Date().toISOString();
    return this.deps.repositories.tickets.createWithInitialArticle({
      ...(actor ? {audit:actor} : {}),
      ticket: {
        subject: data.subject,
        customer_email: data.customer_email,
        source: data.source,
        status: data.status ?? 'open',
        priority: data.priority ?? 'normal',
        assigned_to: data.assigned_to,
        group_id: data.group_id,
        customer_id: data.customer_id,
        source_email: data.source_email,
        custom_fields: data.custom_fields,
        intake_received_at: observedAt,
        intake_processed_at: observedAt,
      },
      article: {
        body: data.body,
        sender_type: data.sender_type,
        sender_id: data.sender_id,
        is_internal: false,
        intake_source: data.source,
        received_at: observedAt,
        processed_at: observedAt,
      },
    });
  }

  async createAuditedReply(ticketId: string, body: string, internal: boolean, actor: ConversationActor, attachments: VerifiedMutationAttachment[]) {
    const now = new Date().toISOString();
    const raw = await this.deps.ticketMutations.commit({
      ticketId,articleId:crypto.randomUUID(),audit:actor,
      article:{sender_id:actor.id,sender_type:'agent',body,is_internal:internal,intake_source:actor.source,received_at:now,processed_at:now},
      attachments:attachments.map(attachment => ({...attachment,id:crypto.randomUUID()})),
    });
    const result = JSON.parse(raw) as {article:Article;attachments:Attachment[]};
    return {article:{...result.article,is_internal:Boolean(result.article.is_internal)},attachments:result.attachments};
  }

  async getTicketArticles(ticketId: string): Promise<Article[]> {
    return this.deps.repositories.articles.findByTicket(ticketId);
  }

  async hydrateArticles(articles: Article[]): Promise<Article[]> {
    const hydrator = new TenantArticleBodyHydrator(this.deps.attachmentStorage, this.deps.legacyArticleStorage);
    // Bound both each R2 body and the aggregate work for one listing; read sequentially.
    let remainingCharacters = 1024 * 1024;
    for (const article of articles) {
      if (!article.body && article.body_r2_key) {
        article.body = remainingCharacters > 0
          ? await hydrator.hydrate(null, article.body_r2_key, Math.min(64 * 1024, remainingCharacters))
          : '';
        remainingCharacters -= article.body.length;
      }
    }
    return articles;
  }

  async getArticleAttachments(articleId: string): Promise<Attachment[]> {
    return this.deps.repositories.attachments.findByArticle(articleId);
  }

  async createArticle(data: Omit<Article, 'id' | 'created_at'>): Promise<Article> {
    // Only a route/service that explicitly identifies its intake path receives
    // new server-observed facts. Legacy repository callers remain not-recorded.
    if (!data.intake_source) return this.deps.repositories.articles.create(data);
    const observedAt = new Date().toISOString();
    return this.deps.repositories.articles.create({
      ...data,
      received_at: observedAt,
      processed_at: observedAt,
    });
  }

  projectCanonicalConversation(
    ticket: Ticket,
    articles: ArticleWithCanonicalAttachments[],
  ): CanonicalConversation {
    return project(ticket, articles);
  }

  async projectAuditedConversation(ticket: Ticket, articles: ArticleWithCanonicalAttachments[]): Promise<CanonicalConversation> {
    const canonical = project(ticket,articles);
    const references = await this.deps.conversationAudit.references(ticket.id,this.deps.betaAdmission?articles.map(article=>article.id):undefined);
    const visible = new Set(articles.map(article => article.id));
    const byArticle = new Map<string,typeof references[number]>();
    for (const event of references) {
      if (event.article_id && !byArticle.has(event.article_id)) byArticle.set(event.article_id,event);
    }
    const intake = references.find(event => event.kind === 'ticket.intake' && (this.deps.betaAdmission || !event.article_id || visible.has(event.article_id)));
    return {...canonical,
      conversation:{...canonical.conversation,...(intake ? {audit:{status:'known' as const,value:{eventId:intake.id}}} : {})},
      messages:canonical.messages.map(message => {
        const event = byArticle.get(message.id);
        return event ? {...message,audit:{status:'known' as const,value:{eventId:event.id}}} : message;
      }),
    };
  }

  async addAttachment(data: Omit<Attachment, 'id' | 'created_at'>): Promise<Attachment> {
    // The upload predates this operation. A metadata failure must not delete a
    // caller's existing object (which may already be referenced by another article).
    return this.deps.repositories.attachments.create(data);
  }

  async updateTicketTimestamp(id: string): Promise<void> {
    await this.deps.repositories.tickets.touch(id);
  }
}
