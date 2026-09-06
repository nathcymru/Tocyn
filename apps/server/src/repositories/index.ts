import { VerifiedTenantScope } from '../types/tenant';
import { UserRepository, TicketRepository, ArticleRepository, AttachmentRepository, Repositories } from './interfaces';
import { D1Database } from '@cloudflare/workers-types';
import { User, Ticket, Article, Attachment } from '../types';

export class SqlUserRepository implements UserRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async get(id: string): Promise<User | null> {
    const result = await this.db.prepare("SELECT * FROM users WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id)
      .first<User>();
    return result || null;
  }

  async create(data: Omit<User, 'id' | 'created_at' | 'last_login_at'>): Promise<User> {
    const id = crypto.randomUUID();
    const result = await this.db.prepare(
      "INSERT INTO users (tenant_id, id, email, full_name, role, mfa_enabled, mfa_secret) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).bind(
      this.scope.tenantId, id, data.email, data.full_name, data.role, data.mfa_enabled ? 1 : 0, data.mfa_secret || null
    ).first<User>();
    if (!result) throw new Error("Failed to create user");
    return result;
  }

  async update(id: string, data: Partial<User>): Promise<void> {
    const sets: string[] = [];
    const values: any[] = [];
    if (data.full_name !== undefined) { sets.push("full_name = ?"); values.push(data.full_name); }
    if (data.mfa_enabled !== undefined) { sets.push("mfa_enabled = ?"); values.push(data.mfa_enabled ? 1 : 0); }
    if (sets.length === 0) return;

    values.push(this.scope.tenantId, id);
    const query = `UPDATE users SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`;
    await this.db.prepare(query).bind(...values).run();
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM users WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id)
      .run();
  }
}

export class SqlTicketRepository implements TicketRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async get(id: string): Promise<Ticket | null> {
    const result = await this.db.prepare("SELECT * FROM tickets WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id)
      .first<Ticket>();
    return result || null;
  }

  async create(data: Omit<Ticket, 'id' | 'created_at' | 'updated_at' | 'ticket_no'>): Promise<Ticket> {
    const id = crypto.randomUUID();
    const result = await this.db.prepare(
      "INSERT INTO tickets (tenant_id, id, subject, status, priority, customer_id, customer_email, assigned_to, group_id, source, source_email, custom_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).bind(
      this.scope.tenantId, id, data.subject, data.status, data.priority, data.customer_id || null, data.customer_email, data.assigned_to || null, data.group_id || null, data.source, data.source_email || null, data.custom_fields ? JSON.stringify(data.custom_fields) : null
    ).first<Ticket>();
    if (!result) throw new Error("Failed to create ticket");
    return result;
  }

  async touch(id: string): Promise<void> {
    await this.db.prepare("UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id).run();
  }

  async update(id: string, data: Partial<Ticket>): Promise<void> {
    const sets: string[] = [];
    const values: any[] = [];
    if (data.status !== undefined) { sets.push("status = ?"); values.push(data.status); }
    if (data.priority !== undefined) { sets.push("priority = ?"); values.push(data.priority); }
    if (sets.length === 0) return;

    values.push(this.scope.tenantId, id);
    const query = `UPDATE tickets SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?`;
    await this.db.prepare(query).bind(...values).run();
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM tickets WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id)
      .run();
  }

  async findCustomerTickets(customerEmail: string, page: number, limit: number): Promise<{ data: Ticket[], total: number }> {
    const offset = (page - 1) * limit;
    const items = await this.db.prepare("SELECT * FROM tickets WHERE tenant_id = ? AND customer_email = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .bind(this.scope.tenantId, customerEmail, limit, offset).all<Ticket>();
    const count = await this.db.prepare("SELECT COUNT(*) as total FROM tickets WHERE tenant_id = ? AND customer_email = ?")
      .bind(this.scope.tenantId, customerEmail).first<{total: number}>();
    return { data: items.results || [], total: count?.total || 0 };
  }
}

export class SqlArticleRepository implements ArticleRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async get(id: string): Promise<Article | null> {
    const result = await this.db.prepare("SELECT * FROM articles WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id)
      .first<Article>();
    return result || null;
  }

  async create(data: Omit<Article, 'id' | 'created_at'>): Promise<Article> {
    const id = crypto.randomUUID();
    const result = await this.db.prepare(
      "INSERT INTO articles (tenant_id, id, ticket_id, sender_id, sender_type, body, body_r2_key, snippet, raw_email_id, qa_type, is_internal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).bind(
      this.scope.tenantId, id, data.ticket_id, data.sender_id || null, data.sender_type, data.body || null, data.body_r2_key || null, data.snippet || null, data.raw_email_id || null, data.qa_type || null, data.is_internal ? 1 : 0
    ).first<Article>();
    if (!result) throw new Error("Failed to create article");
    return {
      ...result,
      is_internal: Boolean(result.is_internal)
    } as Article;
  }

  async update(id: string, data: Partial<Article>): Promise<void> {
    const sets: string[] = [];
    const values: any[] = [];
    if (data.body !== undefined) { sets.push("body = ?"); values.push(data.body); }
    if (sets.length === 0) return;

    values.push(this.scope.tenantId, id);
    const query = `UPDATE articles SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`;
    await this.db.prepare(query).bind(...values).run();
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM articles WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id)
      .run();
  }

  async findByTicket(ticketId: string): Promise<Article[]> {
    const result = await this.db.prepare("SELECT * FROM articles WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at ASC")
      .bind(this.scope.tenantId, ticketId)
      .all<Article>();
    return result.results.map(r => ({ ...r, is_internal: Boolean(r.is_internal) })) || [];
  }
}

export class SqlAttachmentRepository implements AttachmentRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async get(id: string): Promise<Attachment | null> {
    const result = await this.db.prepare("SELECT * FROM attachments WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id)
      .first<Attachment>();
    return result || null;
  }

  async create(data: Omit<Attachment, 'id' | 'created_at'>): Promise<Attachment> {
    const id = crypto.randomUUID();
    const result = await this.db.prepare(
      "INSERT INTO attachments (tenant_id, id, article_id, file_name, file_size, content_type, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).bind(
      this.scope.tenantId, id, data.article_id, data.file_name, data.file_size, data.content_type, data.r2_key
    ).first<Attachment>();
    if (!result) throw new Error("Failed to create attachment");
    return result;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM attachments WHERE tenant_id = ? AND id = ?")
      .bind(this.scope.tenantId, id)
      .run();
  }

  async findByArticle(articleId: string): Promise<Attachment[]> {
    const result = await this.db.prepare("SELECT * FROM attachments WHERE tenant_id = ? AND article_id = ?")
      .bind(this.scope.tenantId, articleId)
      .all<Attachment>();
    return result.results || [];
  }

  async getAttachmentWithMeta(id: string): Promise<any> {
    return this.db.prepare(`
      SELECT a.r2_key, a.file_name, a.content_type, t.customer_email 
      FROM attachments a
      JOIN articles art ON a.article_id = art.id AND a.tenant_id = art.tenant_id
      JOIN tickets t ON art.ticket_id = t.id AND art.tenant_id = t.tenant_id
      WHERE a.tenant_id = ? AND a.id = ?
    `).bind(this.scope.tenantId, id).first<any>();
  }
}

export function createRepositories(scope: VerifiedTenantScope, db: D1Database): Repositories {
  return {
    users: new SqlUserRepository(scope, db),
    tickets: new SqlTicketRepository(scope, db),
    articles: new SqlArticleRepository(scope, db),
    attachments: new SqlAttachmentRepository(scope, db),
  };
}
