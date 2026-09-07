import { normalizeSupportEmail } from '../utils/email-normalize';
import { VerifiedTenantScope } from '../types/tenant';
import { UserRepository, TicketRepository, ArticleRepository, AttachmentRepository, ChannelsRepository, ConfigRepository, ApiKeyRepository, AutomationRepository, TicketFieldRepository, GroupRepository, FilterRepository, Repositories } from './interfaces';
import { D1Database } from '@cloudflare/workers-types';
import { User, Ticket, Article, Attachment } from '../types';

export class SqlUserRepository implements UserRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.prepare("SELECT * FROM users WHERE tenant_id = ? AND email = ?")
      .bind(this.scope.tenantId, email)
      .first<User>();
    return result || null;
  }

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
    if (data.mfa_secret !== undefined) { sets.push("mfa_secret = ?"); values.push(data.mfa_secret); }
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

  async findBySubject(subject: string): Promise<Ticket | null> {
    return this.db.prepare('SELECT * FROM tickets WHERE tenant_id = ? AND subject = ?').bind(this.scope.tenantId, subject).first<Ticket>();
  }

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
    if (data.assigned_to !== undefined) { sets.push("assigned_to = ?"); values.push(data.assigned_to); }
    if (data.group_id !== undefined) { sets.push("group_id = ?"); values.push(data.group_id); }
    if (data.custom_fields !== undefined) { sets.push("custom_fields = ?"); values.push(typeof data.custom_fields === 'string' ? data.custom_fields : JSON.stringify(data.custom_fields)); }
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
    const total = await this.db.prepare("SELECT COUNT(*) as count FROM tickets WHERE tenant_id = ? AND customer_email = ?")
      .bind(this.scope.tenantId, customerEmail).first<{ count: number }>();
    return { data: items.results || [], total: total?.count || 0 };
  }

  async findTicketsForRetention(cutoffStr: string): Promise<Ticket[]> {
    const { results } = await this.db.prepare(
      "SELECT * FROM tickets WHERE tenant_id = ? AND updated_at < ?"
    ).bind(this.scope.tenantId, cutoffStr).all<Ticket>();
    return results || [];
  }
}

export class SqlArticleRepository implements ArticleRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async findByRawEmailId(rawEmailId: string): Promise<Article | null> {
    const result = await this.db.prepare("SELECT * FROM articles WHERE tenant_id = ? AND raw_email_id = ? LIMIT 1")
      .bind(this.scope.tenantId, rawEmailId)
      .first<Article>();
    return result || null;
  }

  async getRecentCustomerArticleCount(customerId: string, since: string): Promise<number> {
    const result = await this.db.prepare("SELECT count(*) as count FROM articles WHERE tenant_id = ? AND sender_type = 'customer' AND sender_id = ? AND created_at > ?")
      .bind(this.scope.tenantId, customerId, since)
      .first<{count: number}>();
    return result?.count || 0;
  }

  async updateQAState(id: string, type: string | null, chunkCount: number): Promise<void> {
    await this.db.prepare("UPDATE articles SET qa_type = ?, chunk_count = ? WHERE tenant_id = ? AND id = ?")
      .bind(type, chunkCount, this.scope.tenantId, id).run();
  }

  async listByTicket(ticketId: string): Promise<Article[]> {
    return this.db.prepare("SELECT * FROM articles WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at ASC")
      .bind(this.scope.tenantId, ticketId).all<Article>().then(r => r.results);
  }

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


export class SqlChannelsRepository implements ChannelsRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async listSupportEmails(): Promise<any[]> {
    return this.db.prepare("SELECT * FROM support_emails WHERE tenant_id = ? ORDER BY created_at ASC").bind(this.scope.tenantId).all().then(r => r.results);
  }

  async createSupportEmail(data: { id: string, email_address: string, name?: string, group_id?: string, is_default: boolean }): Promise<any> {
    const { normalizeSupportEmail } = require('../utils/email-normalize');
    const normalized_email = normalizeSupportEmail(data.email_address);
    if (data.is_default) {
      await this.db.batch([
        this.db.prepare("UPDATE support_emails SET is_default = 0 WHERE tenant_id = ?").bind(this.scope.tenantId),
        this.db.prepare(
          "INSERT INTO support_emails (tenant_id, id, email_address, normalized_email, name, group_id, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(this.scope.tenantId, data.id, data.email_address, normalized_email, data.name || null, data.group_id || null, 1)
      ]);
    } else {
      await this.db.prepare(
        "INSERT INTO support_emails (tenant_id, id, email_address, normalized_email, name, group_id, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(this.scope.tenantId, data.id, data.email_address, normalized_email, data.name || null, data.group_id || null, 0).run();
    }
    return this.getSupportEmail(data.id);
  }

  async deleteSupportEmail(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM support_emails WHERE tenant_id = ? AND id = ?").bind(this.scope.tenantId, id).run();
  }

  async getSupportEmail(id: string): Promise<any> {
    return this.db.prepare("SELECT * FROM support_emails WHERE tenant_id = ? AND id = ?").bind(this.scope.tenantId, id).first();
  }

  async findByEmail(email_address: string): Promise<any> {
    const { normalizeSupportEmail } = require('../utils/email-normalize');
    const normalized = normalizeSupportEmail(email_address);
    return this.db.prepare("SELECT * FROM support_emails WHERE tenant_id = ? AND normalized_email = ?").bind(this.scope.tenantId, normalized).first();
  }
}

export class SqlConfigRepository implements ConfigRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async get(key: string): Promise<string | null> {
    const result = await this.db.prepare("SELECT value FROM tenant_config WHERE tenant_id = ? AND key = ?").bind(this.scope.tenantId, key).first<{value: string}>();
    return result ? result.value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.prepare("INSERT INTO tenant_config (tenant_id, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(this.scope.tenantId, key, value).run();
  }
}

import { SqlKnowledgeRepository } from './knowledge.repository';

export class SqlApiKeyRepository implements ApiKeyRepository {
  private static readonly PREFIX = 'lt_';
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async list(): Promise<any[]> {
    const { results } = await this.db.prepare(
      "SELECT id, name, prefix, is_active, created_at, last_used_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC"
    ).bind(this.scope.tenantId).all();
    return results;
  }

  async create(name: string, permissionsList: string[] = ['tickets:read']): Promise<{ apiKey: string; id: string; name: string; prefix: string; permissions: string[] }> {
    const id = crypto.randomUUID();
    const prefix = this.generateRandomString(8);
    const secret = this.generateRandomString(32);
    const apiKey = `${SqlApiKeyRepository.PREFIX}${prefix}.${secret}`;
    const keyHash = await this.hashKey(apiKey);
    const now = new Date().toISOString();
    const permissionsStr = permissionsList.join(',');

    await this.db.prepare(
      "INSERT INTO api_keys (tenant_id, id, name, key_hash, prefix, permissions, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
    ).bind(this.scope.tenantId, id, name, keyHash, prefix, permissionsStr, now).run();

    return { apiKey, id, name, prefix, permissions: permissionsList };
  }

  async get(id: string): Promise<any | null> {
    return this.db.prepare(
      "SELECT id, name, prefix, is_active, created_at, last_used_at FROM api_keys WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).first();
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare(
      "DELETE FROM api_keys WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).run();
  }

  private async hashKey(apiKey: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private generateRandomString(length: number): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const values = new Uint8Array(length);
    crypto.getRandomValues(values);
    return Array.from(values).map(x => charset[x % charset.length]).join('');
  }
}

export class SqlAutomationRepository implements AutomationRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async list(): Promise<any[]> {
    const { results } = await this.db.prepare(
      "SELECT * FROM automation_rules WHERE tenant_id = ? ORDER BY created_at DESC"
    ).bind(this.scope.tenantId).all();
    return results;
  }

  async get(id: string): Promise<any | null> {
    return this.db.prepare(
      "SELECT * FROM automation_rules WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).first();
  }

  async create(data: { name: string; event_type: string; conditions?: string; action_type: string; action_config?: string; is_active: boolean }): Promise<any> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      "INSERT INTO automation_rules (tenant_id, id, name, event_type, conditions, action_type, action_config, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      this.scope.tenantId, id, data.name, data.event_type,
      data.conditions || null, data.action_type, data.action_config || null,
      data.is_active ? 1 : 0
    ).run();

    return this.get(id);
  }

  async update(id: string, data: Record<string, any>): Promise<any | null> {
    const allowedFields = ['name', 'event_type', 'conditions', 'action_type', 'action_config', 'is_active'];
    const updates: string[] = [];
    const params: any[] = [];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = ?`);
        if (field === 'is_active') {
          params.push(data[field] ? 1 : 0);
        } else {
          params.push(data[field]);
        }
      }
    }

    if (updates.length === 0) return this.get(id);

    params.push(this.scope.tenantId, id);
    await this.db.prepare(
      `UPDATE automation_rules SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`
    ).bind(...params).run();

    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare(
      "DELETE FROM automation_rules WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).run();
  }

  async getActiveRules(eventType: string): Promise<any[]> {
    const { results } = await this.db.prepare(
      "SELECT * FROM automation_rules WHERE tenant_id = ? AND event_type = ? AND is_active = 1"
    ).bind(this.scope.tenantId, eventType).all();
    return results;
  }
}

export class SqlTicketFieldRepository implements TicketFieldRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async list(): Promise<any[]> {
    const { results } = await this.db.prepare(
      "SELECT * FROM ticket_fields WHERE tenant_id = ? ORDER BY name ASC"
    ).bind(this.scope.tenantId).all();
    return results;
  }

  async create(data: { name: string; label: string; field_type: string; options?: string | null; is_active: boolean }): Promise<any> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      "INSERT INTO ticket_fields (tenant_id, id, name, label, field_type, options, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(this.scope.tenantId, id, data.name, data.label, data.field_type, data.options || null, data.is_active ? 1 : 0).run();

    return this.db.prepare(
      "SELECT * FROM ticket_fields WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).first();
  }
}

export class SqlGroupRepository implements GroupRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async list(): Promise<any[]> {
    const { results } = await this.db.prepare(
      "SELECT * FROM groups WHERE tenant_id = ?"
    ).bind(this.scope.tenantId).all();
    return results;
  }

  async get(id: string): Promise<any | null> {
    return this.db.prepare(
      "SELECT * FROM groups WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).first();
  }

  async create(data: { name: string; description?: string | null }): Promise<any> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      "INSERT INTO groups (tenant_id, id, name, description) VALUES (?, ?, ?, ?)"
    ).bind(this.scope.tenantId, id, data.name, data.description || null).run();

    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM user_groups WHERE tenant_id = ? AND group_id = ?").bind(this.scope.tenantId, id),
      this.db.prepare("DELETE FROM groups WHERE tenant_id = ? AND id = ?").bind(this.scope.tenantId, id)
    ]);
  }

  async getMembers(groupId: string): Promise<any[]> {
    const { results } = await this.db.prepare(
      `SELECT u.id, u.email, u.full_name, u.role
       FROM users u
       JOIN user_groups ug ON u.tenant_id = ug.tenant_id AND u.id = ug.user_id
       WHERE ug.tenant_id = ? AND ug.group_id = ?`
    ).bind(this.scope.tenantId, groupId).all();
    return results;
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const result = await this.db.prepare(
      "SELECT 1 FROM user_groups WHERE tenant_id = ? AND user_id = ? AND group_id = ?"
    ).bind(this.scope.tenantId, userId, groupId).first();
    return !!result;
  }

  async addMember(groupId: string, userId: string): Promise<void> {
    await this.db.prepare(
      "INSERT INTO user_groups (tenant_id, user_id, group_id) VALUES (?, ?, ?)"
    ).bind(this.scope.tenantId, userId, groupId).run();
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.db.prepare(
      "DELETE FROM user_groups WHERE tenant_id = ? AND user_id = ? AND group_id = ?"
    ).bind(this.scope.tenantId, userId, groupId).run();
  }

  async hasTickets(groupId: string): Promise<boolean> {
    const result = await this.db.prepare(
      "SELECT COUNT(*) as count FROM tickets WHERE tenant_id = ? AND group_id = ?"
    ).bind(this.scope.tenantId, groupId).first<{ count: number }>();
    return (result?.count || 0) > 0;
  }
}

export class SqlFilterRepository implements FilterRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async list(): Promise<any[]> {
    const { results } = await this.db.prepare(
      "SELECT * FROM ticket_filters WHERE tenant_id = ? ORDER BY is_system DESC, created_at ASC"
    ).bind(this.scope.tenantId).all();

    return results.map((filter: any) => ({
      ...filter,
      conditions: typeof filter.conditions === 'string' ? JSON.parse(filter.conditions) : filter.conditions
    }));
  }

  async get(id: string): Promise<any | null> {
    const filter = await this.db.prepare(
      "SELECT * FROM ticket_filters WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).first<any>();

    if (!filter) return null;
    return {
      ...filter,
      conditions: typeof filter.conditions === 'string' ? JSON.parse(filter.conditions) : filter.conditions
    };
  }

  async create(data: { name: string; conditions: any }): Promise<any> {
    const id = `filter_${crypto.randomUUID()}`;
    const conditionsStr = typeof data.conditions === 'string' ? data.conditions : JSON.stringify(data.conditions);
    const now = new Date().toISOString();

    await this.db.prepare(
      "INSERT INTO ticket_filters (tenant_id, id, name, conditions, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
    ).bind(this.scope.tenantId, id, data.name, conditionsStr, now, now).run();

    return this.get(id);
  }

  async update(id: string, data: { name: string; conditions: any }): Promise<any | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    if (existing.is_system) {
      throw new Error("Cannot modify system filters");
    }

    const conditionsStr = typeof data.conditions === 'string' ? data.conditions : JSON.stringify(data.conditions);
    const now = new Date().toISOString();

    await this.db.prepare(
      "UPDATE ticket_filters SET name = ?, conditions = ?, updated_at = ? WHERE tenant_id = ? AND id = ?"
    ).bind(data.name, conditionsStr, now, this.scope.tenantId, id).run();

    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    if (existing.is_system) {
      throw new Error("Cannot delete system filters");
    }

    await this.db.prepare(
      "DELETE FROM ticket_filters WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).run();
  }
}

export function createRepositories(scope: VerifiedTenantScope, db: D1Database): Repositories {
  return {
    knowledge: new SqlKnowledgeRepository(scope, db),
    users: new SqlUserRepository(scope, db),
    tickets: new SqlTicketRepository(scope, db),
    articles: new SqlArticleRepository(scope, db),
    attachments: new SqlAttachmentRepository(scope, db),
    channels: new SqlChannelsRepository(scope, db),
    config: new SqlConfigRepository(scope, db),
    apiKeys: new SqlApiKeyRepository(scope, db),
    automations: new SqlAutomationRepository(scope, db),
    ticketFields: new SqlTicketFieldRepository(scope, db),
    groups: new SqlGroupRepository(scope, db),
    ticketFilters: new SqlFilterRepository(scope, db)
  };
}
