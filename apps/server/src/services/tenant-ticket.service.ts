import { TenantArticleBodyHydrator } from '../storage/adapters';
import { Ticket, Article, Attachment } from '../types';
import { TenantRequestDeps } from '../middleware/tenant.middleware';

export class TenantTicketService {
  constructor(private deps: TenantRequestDeps) {}

  async findTickets({ page, limit, customerEmail }: { page: number, limit: number, customerEmail: string }) {
    return this.deps.repositories.tickets.findCustomerTickets(customerEmail, page, limit);
  }

  async findTicketById(id: string): Promise<Ticket | null> {
    return this.deps.repositories.tickets.get(id);
  }

  async createTicketWithArticle(data: any): Promise<{ ticket: Ticket, article: Article }> {
    const ticket = await this.deps.repositories.tickets.create({
      subject: data.subject,
      customer_email: data.customer_email,
      source: data.source,
      status: data.status ?? 'open',
      priority: data.priority ?? 'normal',
      assigned_to: data.assigned_to,
      group_id: data.group_id,
      customer_id: data.customer_id,
      source_email: data.source_email,
      custom_fields: data.custom_fields
    });

    const article = await this.deps.repositories.articles.create({
      ticket_id: ticket.id,
      body: data.body,
      sender_type: data.sender_type,
      sender_id: data.sender_id,
      is_internal: false
    });

    return { ticket, article };
  }

  async getTicketArticles(ticketId: string): Promise<Article[]> {
    return this.deps.repositories.articles.findByTicket(ticketId);
  }

  async hydrateArticles(articles: Article[]): Promise<Article[]> {
    const hydrator = new TenantArticleBodyHydrator(this.deps.attachmentStorage, this.deps.legacyArticleStorage);
    await Promise.all(articles.map(async article => {
      if (!article.body && article.body_r2_key) article.body = await hydrator.hydrate(null, article.body_r2_key, 1024 * 1024);
    }));
    return articles;
  }

  async getArticleAttachments(articleId: string): Promise<Attachment[]> {
    return this.deps.repositories.attachments.findByArticle(articleId);
  }

  async createArticle(data: Omit<Article, 'id' | 'created_at'>): Promise<Article> {
    return this.deps.repositories.articles.create(data);
  }

  async addAttachment(data: Omit<Attachment, 'id' | 'created_at'>): Promise<Attachment> {
    try {
      return await this.deps.repositories.attachments.create(data);
    } catch (error) {
      console.error("D1 attachment metadata insert failed. Attempting compensating R2 delete...", error);
      try {
        await this.deps.attachmentStorage.deleteAttachment(data.r2_key);
        console.error(`Successfully cleaned up orphaned R2 object: ${data.r2_key}`);
      } catch (cleanupError) {
        console.error(`CRITICAL: Failed to clean up orphaned R2 object: ${data.r2_key}`, cleanupError);
      }
      throw error;
    }
  }

  async updateTicketTimestamp(id: string): Promise<void> {
    await this.deps.repositories.tickets.touch(id);
  }
}
