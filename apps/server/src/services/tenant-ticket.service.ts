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
      status: 'open',
      priority: 'normal'
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
    await Promise.all(
      articles.map(async (article) => {
        if (!article.body && article.body_r2_key) {
          try {
            // body_r2_key is assumed to be fully migrated to tenant scope if created through new boundary
            let obj;
            // Legacy keys do not have the tenant- scope prefix in them yet. 
            // In the new system, we expect the tenant scope to be implicitly managed.
            const legacyPattern = /^tickets\/[a-zA-Z0-9-]+\/articles\/[a-zA-Z0-9-]+\/body\.txt$/;
            if (legacyPattern.test(article.body_r2_key)) {
              if (this.deps.legacyArticleStorage) {
                obj = await this.deps.legacyArticleStorage.getLegacyUnscopedAttachment(article.body_r2_key);
              } else {
                throw new Error("Legacy article body hydration is not permitted for this tenant.");
              }
            } else {
              obj = await this.deps.attachmentStorage.getAttachment(article.body_r2_key);
            }
            article.body = obj ? await obj.text() : '';
          } catch (err) {
            console.error('Failed to fetch article body from R2', err);
            article.body = '';
          }
        }
      })
    );
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
