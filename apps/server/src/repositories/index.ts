import { SessionBudgetAuthorityRepository } from './session-budget-authority.repository';
import { BudgetAuthorityRepository } from './budget-authority.repository';
import { TicketMutationReplayRepository } from './ticket-mutation-replay.repository';
import type { OperatorWorkspaceSort } from '../types/operator-workspace';
import { OperatorWorkspaceRepository } from './operator-workspace.repository';
import { SupportStateRepository } from './support-state.repository';
import { SlaClockRepository } from './sla-clock.repository';
import type { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import { conversationMutationEvent } from './conversation-audit.repository';
import { normalizeSupportEmail } from '../utils/email-normalize';
import { CapabilityFenceError, capabilityWriteConstraint, requireCapabilityWrite, type CapabilityWriteFence } from '../auth/capability-policy';
import { VerifiedTenantScope } from '../types/tenant';
import { UserRepository, TicketRepository, InitialTicketArticleData, ArticleRepository, AttachmentRepository, ChannelsRepository, ConfigRepository, ApiKeyRepository, AutomationRepository, TicketFieldRepository, GroupRepository, FilterRepository, Repositories } from './interfaces';
import { D1Database } from '@cloudflare/workers-types';
import { User, Ticket, Article, Attachment } from '../types';
import type { RequestCanonicalMutationSli } from '../observability/request-canonical-mutation-sli';

const defaultSlaCalendarJson = JSON.stringify({ timeZone: 'UTC', weekly: Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => [day,[{ startMinute: 0, endMinute: 1440 }]])), exceptions: [], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } });

export class SqlUserRepository implements UserRepository {
  async revokeSessions(id: string): Promise<void> {
    await this.db.prepare('UPDATE users SET session_version = session_version + 1 WHERE tenant_id = ? AND id = ?')
      .bind(this.scope.tenantId, id).run();
  }

  /** A late setup request cannot replace an authenticator enabled in the meantime. */
  async beginMfaEnrollment(id: string, encryptedSecret: string, sessionVersion: number): Promise<boolean> {
    const changed = await this.db.prepare(`UPDATE users SET mfa_secret = ?
      WHERE tenant_id = ? AND id = ? AND mfa_enabled = 0 AND session_version = ?
      RETURNING id`)
      .bind(encryptedSecret, this.scope.tenantId, id, sessionVersion).first<{ id: string }>();
    return changed !== null;
  }

  /** Confirm only the still-pending secret that this request actually verified. */
  async completeMfaEnrollment(id: string, expectedSecret: string, sessionVersion: number): Promise<boolean> {
    const changed = await this.db.prepare(`UPDATE users SET mfa_enabled = 1
      WHERE tenant_id = ? AND id = ? AND mfa_enabled = 0 AND mfa_secret = ? AND session_version = ?
      RETURNING id`)
      .bind(this.scope.tenantId, id, expectedSecret, sessionVersion).first<{ id: string }>();
    return changed !== null;
  }

  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async list(options: {role?: string; page: number; limit: number; staffOnly?: boolean}): Promise<any[]> {
    let query = 'SELECT id, email, full_name, role, mfa_enabled, created_at FROM users WHERE tenant_id = ?';
    const values: any[] = [this.scope.tenantId];
    if (options.staffOnly) query += " AND role IN ('admin','agent')";
    if (options.role) { query += ' AND role = ?'; values.push(options.role); }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    values.push(options.limit, (options.page-1)*options.limit);
    return this.db.prepare(query).bind(...values).all().then(r => r.results);
  }

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

  async storeCustomerAuthToken(userId: string, tokenId: string, tokenHash: string, type: string, expiresAt: string): Promise<void> {
    const insert = this.db.prepare(
      'INSERT INTO customer_auth_tokens (tenant_id, id, user_id, token_hash, type, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(this.scope.tenantId, tokenId, userId, tokenHash, type, expiresAt);
    if (type === 'otp') {
      await this.db.batch([
        this.db.prepare("UPDATE customer_auth_tokens SET used_at = ? WHERE tenant_id = ? AND user_id = ? AND type = 'otp' AND used_at IS NULL")
          .bind(new Date().toISOString(), this.scope.tenantId, userId),
        insert,
      ]);
    } else await insert.run();
  }

  async findCustomerAuthTokenUser(tokenHash: string, challengeId?: string): Promise<string | null> {
    // OTP lookup identifies the challenge owner for invitation gating only.
    // Verification below must count a wrong code before comparing its hash;
    // prefiltering this lookup by hash would skip the durable attempt limit.
    const candidate = await this.db.prepare(`SELECT user_id FROM customer_auth_tokens
      WHERE tenant_id=? AND ${challengeId ? 'id=?' : 'token_hash=?'} LIMIT 1`)
      .bind(this.scope.tenantId, challengeId ?? tokenHash).first<{ user_id: string }>();
    return candidate?.user_id ?? null;
  }

  async verifyAndConsumeCustomerAuthToken(tokenHash: string, now: string, challengeId?: string): Promise<User | null> {
    if (challengeId) {
      // Claim one of five attempts atomically before comparing the code.
      const attempt = await this.db.prepare(`UPDATE customer_auth_tokens SET attempts = attempts + 1
        WHERE tenant_id = ? AND id = ? AND type = 'otp' AND used_at IS NULL
          AND expires_at > ? AND attempts < 5 RETURNING id`)
        .bind(this.scope.tenantId, challengeId, now).first();
      if (!attempt) return null;
    }
    // A single conditional write claims the token. Concurrent redemption can return
    // a row to only one caller; the current customer role is checked in that write.
    const claimed = await this.db.prepare(`
      UPDATE customer_auth_tokens SET used_at = ?
      WHERE tenant_id = ? AND id = (
        SELECT t.id FROM customer_auth_tokens t
        JOIN users u ON u.tenant_id = t.tenant_id AND u.id = t.user_id
        WHERE t.tenant_id = ? AND t.token_hash = ? AND t.used_at IS NULL
          AND t.expires_at > ? AND u.role = 'customer'
          AND ((? IS NULL AND t.type = 'magic_link') OR (t.type = 'otp' AND t.id = ?))
        ORDER BY t.id LIMIT 1
      ) AND used_at IS NULL AND expires_at > ?
      RETURNING user_id
    `).bind(now, this.scope.tenantId, this.scope.tenantId, tokenHash, now, challengeId || null, challengeId || null, now)
      .first<{ user_id: string }>();
    if (!claimed) return null;
    const user = await this.get(claimed.user_id);
    if (!user || user.role !== 'customer') return null;
    await this.db.prepare('UPDATE users SET last_login_at = ? WHERE tenant_id = ? AND id = ?')
      .bind(now, this.scope.tenantId, user.id).run();
    user.last_login_at = now;
    return user;
  }
}

export class SqlTicketRepository implements TicketRepository {
  async claimRetention(id: string, cutoff: string): Promise<{ token: string } | null> {
    await this.db.prepare(`INSERT OR IGNORE INTO ticket_cleanup_claims (tenant_id, ticket_id, token, mode)
      SELECT tenant_id, id, ?, 'retention' FROM tickets WHERE tenant_id = ? AND id = ? AND julianday(updated_at) < julianday(?)`)
      .bind(crypto.randomUUID(), this.scope.tenantId, id, cutoff).run();
    const claim = await this.db.prepare("SELECT token FROM ticket_cleanup_claims WHERE tenant_id = ? AND ticket_id = ? AND mode = 'retention'")
      .bind(this.scope.tenantId, id).first<{token: string}>();
    return claim;
  }

  async releaseClaim(id: string, token: string): Promise<void> {
    await this.db.prepare('DELETE FROM ticket_cleanup_claims WHERE tenant_id = ? AND ticket_id = ? AND token = ?')
      .bind(this.scope.tenantId, id, token).run();
  }

  async withExternalWrite<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const token = crypto.randomUUID();
    const result = await this.db.prepare(`INSERT OR IGNORE INTO ticket_cleanup_claims (tenant_id, ticket_id, token, mode)
      SELECT tenant_id, id, ?, 'write' FROM tickets WHERE tenant_id = ? AND id = ?`)
      .bind(token, this.scope.tenantId, id).run();
    if (!result.meta.changes) throw new Error('Ticket busy or unavailable');
    // An ambiguous external failure retains the claim for explicit reconciliation.
    const value = await operation();
    await this.releaseClaim(id, token);
    return value;
  }

  async completeRetention(id: string, token: string): Promise<boolean> {
    // A transaction-local finalizing state permits only the matching claim to
    // delete ownership. Failure rolls the freeze and all ownership rows back.
    const guard = "EXISTS (SELECT 1 FROM ticket_cleanup_claims WHERE tenant_id = ? AND ticket_id = ? AND token = ? AND mode = 'finalizing')";
    const results = await this.db.batch([
      this.db.prepare("UPDATE ticket_cleanup_claims SET mode = 'finalizing' WHERE tenant_id = ? AND ticket_id = ? AND token = ? AND mode = 'retention'").bind(this.scope.tenantId, id, token),
      this.db.prepare(`DELETE FROM attachments WHERE tenant_id = ? AND article_id IN (SELECT id FROM articles WHERE tenant_id = ? AND ticket_id = ?) AND ${guard}`).bind(this.scope.tenantId, this.scope.tenantId, id, this.scope.tenantId, id, token),
      this.db.prepare(`DELETE FROM articles WHERE tenant_id = ? AND ticket_id = ? AND ${guard}`).bind(this.scope.tenantId, id, this.scope.tenantId, id, token),
      this.db.prepare(`DELETE FROM tickets WHERE tenant_id = ? AND id = ? AND ${guard}`).bind(this.scope.tenantId, id, this.scope.tenantId, id, token),
    ]);
    return results[3].meta.changes > 0;
  }

  constructor(private scope: VerifiedTenantScope, private db: D1Database, private betaAdmission?: LocalBetaAdmissionRepository, private canonicalMutationSli?: RequestCanonicalMutationSli) {}

  async list(
    options: {
      page?: number;
      limit?: number;
      filterId?: string;
      status?: string;
      priority?: string;
      assignedTo?: string;
      groupId?: string;
      ticketNo?: string;
      search?: string;
      customerEmail?: string;
      sort?: OperatorWorkspaceSort;
    }
  ): Promise<{ data: Ticket[]; total: number; meta: { total: number; page: number; limit: number; total_pages: number } }> {
    const page = Math.max(1, Number.isFinite(options.page) ? options.page! : 1);
    const limit = Math.min(100, Math.max(1, Number.isFinite(options.limit) ? options.limit! : 50));
    const offset = (page - 1) * limit;

    let query = "SELECT tickets.*, (SELECT snippet FROM articles WHERE articles.tenant_id = tickets.tenant_id AND ticket_id = tickets.id ORDER BY created_at DESC LIMIT 1) as snippet FROM tickets WHERE tenant_id = ?";
    let countQuery = "SELECT COUNT(*) as total FROM tickets WHERE tenant_id = ?";
    const params: any[] = [this.scope.tenantId];

    if (options.customerEmail) {
      query += " AND customer_email = ?";
      countQuery += " AND customer_email = ?";
      params.push(options.customerEmail);
    }

    if (options.search) {
      const numericMatch = options.search.match(/\d+/);
      const searchPattern = `%${options.search}%`;

      let searchCondition = "(subject LIKE ? OR customer_email LIKE ? OR id LIKE ? OR EXISTS (SELECT 1 FROM articles WHERE articles.tenant_id = tickets.tenant_id AND ticket_id = tickets.id AND (snippet LIKE ? OR body LIKE ?)))";
      const searchParams = [searchPattern, searchPattern, searchPattern, searchPattern, searchPattern];

      if (numericMatch) {
        searchCondition = `(${searchCondition} OR CAST(ticket_no AS TEXT) LIKE ?)`;
        const numPattern = `%${numericMatch[0]}%`;
        searchParams.push(numPattern);
      }

      query += ` AND ${searchCondition}`;
      countQuery += ` AND ${searchCondition}`;
      params.push(...searchParams);
    }

    if (options.filterId) {
      const filter = await this.db.prepare("SELECT conditions FROM ticket_filters WHERE tenant_id = ? AND id = ?")
        .bind(this.scope.tenantId, options.filterId)
        .first<{ conditions: string }>();

      if (filter) {
        try {
          const conditions = JSON.parse(filter.conditions);
          if (Array.isArray(conditions)) {
            for (const condition of conditions) {
              const { field, operator, value } = condition;
              // Prevent SQL injection by allowing only specific fields
              const allowedFields = ["status", "priority", "assigned_to", "group_id", "source", "subject", "customer_email", "ticket_no"];
              if (allowedFields.includes(field)) {
                if (operator === "in" && typeof value === "string" && value.length > 0) {
                  const vals = value.split(",");
                  query += ` AND ${field} IN (${vals.map(() => "?").join(",")})`;
                  countQuery += ` AND ${field} IN (${vals.map(() => "?").join(",")})`;
                  params.push(...vals);
                } else if (operator === "in" && Array.isArray(value) && value.length > 0) {
                  query += ` AND ${field} IN (${value.map(() => "?").join(",")})`;
                  countQuery += ` AND ${field} IN (${value.map(() => "?").join(",")})`;
                  params.push(...value);
                } else if (operator === "equals" && value !== undefined && value !== null) {
                  query += ` AND ${field} = ?`;
                  countQuery += ` AND ${field} = ?`;
                  params.push(value);
                } else if (operator === "not_equals" && value !== undefined && value !== null) {
                  query += ` AND ${field} != ?`;
                  countQuery += ` AND ${field} != ?`;
                  params.push(value);
                } else if (operator === "contains" && typeof value === "string" && value.length > 0) {
                  query += ` AND ${field} LIKE ?`;
                  countQuery += ` AND ${field} LIKE ?`;
                  params.push(`%${value}%`);
                }
              }
            }
          }
        } catch (e) {
          throw new Error("Invalid saved filter");
        }
      } else {
        query += " AND 0=1"; countQuery += " AND 0=1";
      }
    } else {
      if (options.status) {
        const statuses = options.status.split(",");
        query += ` AND status IN (${statuses.map(() => "?").join(",")})`;
        countQuery += ` AND status IN (${statuses.map(() => "?").join(",")})`;
        params.push(...statuses);
      }
      if (options.priority) {
        const priorities = options.priority.split(",");
        query += ` AND priority IN (${priorities.map(() => "?").join(",")})`;
        countQuery += ` AND priority IN (${priorities.map(() => "?").join(",")})`;
        params.push(...priorities);
      }
      if (options.assignedTo) {
        query += " AND assigned_to = ?";
        countQuery += " AND assigned_to = ?";
        params.push(options.assignedTo);
      }
      if (options.groupId) {
        query += " AND group_id = ?";
        countQuery += " AND group_id = ?";
        params.push(options.groupId);
      }
      if (options.ticketNo) {
        query += " AND ticket_no = ?";
        countQuery += " AND ticket_no = ?";
        params.push(parseInt(options.ticketNo));
      }
    }

    const countResult = await this.db.prepare(countQuery)
      .bind(...params)
      .first<{ total: number }>();
    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    const sortClauses: Record<OperatorWorkspaceSort, string> = {
      updated_desc: 'tickets.updated_at DESC', updated_asc: 'tickets.updated_at ASC',
      created_desc: 'tickets.created_at DESC', created_asc: 'tickets.created_at ASC',
      priority_desc: "CASE tickets.priority WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END DESC",
      priority_asc: "CASE tickets.priority WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END ASC",
    };
    const sort = options.sort ?? 'updated_desc';
    if (!Object.prototype.hasOwnProperty.call(sortClauses, sort)) throw new Error('Invalid ticket sort');
    query += ` ORDER BY ${sortClauses[sort]}, tickets.id ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const { results } = await this.db.prepare(query)
      .bind(...params)
      .all<Ticket & { custom_fields?: string | Record<string, any> }>();

    const data = results.map((ticket) => {
      if (typeof ticket.custom_fields === 'string') {
        try {
          ticket.custom_fields = JSON.parse(ticket.custom_fields);
        } catch (e) {
          ticket.custom_fields = {};
        }
      }
      return ticket as Ticket;
    });

    return {
      data,
      total,
      meta: {
        total,
        page,
        limit,
        total_pages: totalPages,
      },
    };
  }

  async dashboardStats() {
    const [statuses, priorities, users, groups] = await Promise.all([
      this.db.prepare('SELECT status, COUNT(*) as count FROM tickets WHERE tenant_id = ? GROUP BY status').bind(this.scope.tenantId).all(),
      this.db.prepare('SELECT priority, COUNT(*) as count FROM tickets WHERE tenant_id = ? GROUP BY priority').bind(this.scope.tenantId).all(),
      this.db.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(this.scope.tenantId).first<{count:number}>(),
      this.db.prepare('SELECT COUNT(*) as count FROM groups WHERE tenant_id = ?').bind(this.scope.tenantId).first<{count:number}>()
    ]);
    return {ticketsByStatus:statuses.results,ticketsByPriority:priorities.results,totalUsers:users?.count || 0,totalGroups:groups?.count || 0};
  }

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
      "INSERT INTO tickets (tenant_id, id, subject, status, priority, customer_id, customer_email, assigned_to, group_id, source, source_email, custom_fields, intake_received_at, intake_processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).bind(
      this.scope.tenantId, id, data.subject, data.status, data.priority, data.customer_id || null, data.customer_email, data.assigned_to || null, data.group_id || null, data.source, data.source_email || null, data.custom_fields ? (typeof data.custom_fields === 'string' ? data.custom_fields : JSON.stringify(data.custom_fields)) : null,
      data.intake_received_at ?? null, data.intake_processed_at ?? null,
    ).first<Ticket>();
    if (!result) throw new Error("Failed to create ticket");
    return result;
  }

  async createWithInitialArticle(data: InitialTicketArticleData): Promise<{ ticket: Ticket; article: Article }> {
    const ticketId = crypto.randomUUID();
    const articleId = crypto.randomUUID();
    const { ticket, article } = data;
    if (this.betaAdmission) {
      const raw=await new TicketMutationReplayRepository(this.db,this.scope,this.betaAdmission,this.canonicalMutationSli).commit({ticketId,articleId,ticket,article,audit:data.audit,attachments:[]});
      const snapshot=JSON.parse(raw) as {ticket:Ticket;article:Article};
      return {ticket:snapshot.ticket,article:{...snapshot.article,is_internal:Boolean(snapshot.article.is_internal)}};
    }
    // D1 executes the batch as one transaction. A failed article insert rolls
    // back the ticket too; neither tenant nor parent IDs come from the input.
    this.canonicalMutationSli?.recordAttempt();
    let results;
    try { results = await this.db.batch<Ticket | Article>([
      this.db.prepare(`INSERT INTO tickets
        (tenant_id, id, subject, status, priority, customer_id, customer_email, assigned_to, group_id, source, source_email, custom_fields, intake_received_at, intake_processed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).bind(
        this.scope.tenantId, ticketId, ticket.subject, ticket.status, ticket.priority,
        ticket.customer_id || null, ticket.customer_email, ticket.assigned_to || null,
        ticket.group_id || null, ticket.source, ticket.source_email || null,
        ticket.custom_fields ? (typeof ticket.custom_fields === 'string' ? ticket.custom_fields : JSON.stringify(ticket.custom_fields)) : null,
        ticket.intake_received_at, ticket.intake_processed_at,
      ),
      this.db.prepare(`INSERT INTO articles
        (tenant_id, id, ticket_id, sender_id, sender_type, body, body_r2_key, snippet, raw_email_id, qa_type, is_internal, intake_source, received_at, processed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).bind(
        this.scope.tenantId, articleId, ticketId, article.sender_id || null, article.sender_type,
        article.body || null, article.body_r2_key || null, article.snippet || null,
        article.raw_email_id || null, article.qa_type || null, article.is_internal ? 1 : 0,
        article.intake_source, article.received_at, article.processed_at,
      ),
      // The ordinary dashboard intake batch is canonical too. Keep its
      // configured policy snapshot and initialized clock in this transaction.
      this.db.prepare(`INSERT OR IGNORE INTO sla_policies
        (tenant_id,calendar_json,response_target_ms,resolution_target_ms,response_reopen_policy,resolution_reopen_policy)
        VALUES (?, ?, NULL, NULL, 'continue', 'continue')`).bind(this.scope.tenantId, defaultSlaCalendarJson),
      this.db.prepare(`INSERT INTO ticket_sla_clocks
        (tenant_id,ticket_id,response_started_at,resolution_started_at,last_support_state_revision,
         policy_revision,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy)
        SELECT ?,?,t.created_at,t.created_at,0,p.revision,p.calendar_json,p.response_target_ms,p.resolution_target_ms,
          p.response_reopen_policy,p.resolution_reopen_policy
        FROM tickets t JOIN sla_policies p ON p.tenant_id=t.tenant_id WHERE t.tenant_id=? AND t.id=?`)
        .bind(this.scope.tenantId,ticketId,this.scope.tenantId,ticketId),
      this.db.prepare(`INSERT INTO ticket_sla_events (tenant_id,id,ticket_id,kind,support_state_revision,facts)
        VALUES (?,lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),?,
          'clock.initialized',0,json_object('source','canonical-dashboard-intake'))`)
        .bind(this.scope.tenantId,ticketId),
      ...(data.audit ? [conversationMutationEvent(this.db,this.scope,{id:crypto.randomUUID(),ticketId,articleId,actor:data.audit,intake:true,internal:false})] : []),
    ]); } catch (error) { this.canonicalMutationSli?.recordUncertain(); throw error; }
    const createdTicket = results[0].results[0] as Ticket | undefined;
    const createdArticle = results[1].results[0] as Article | undefined;
    if (!createdTicket || !createdArticle) {
      this.canonicalMutationSli?.recordUncertain();
      throw new Error('Failed to create ticket and initial article');
    }
    this.canonicalMutationSli?.recordDurablyCompleted();
    return { ticket: createdTicket, article: { ...createdArticle, is_internal: Boolean(createdArticle.is_internal) } };
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
      "SELECT * FROM tickets WHERE tenant_id = ? AND julianday(updated_at) < julianday(?)"
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
      "INSERT INTO articles (tenant_id, id, ticket_id, sender_id, sender_type, body, body_r2_key, snippet, raw_email_id, qa_type, is_internal, intake_source, received_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).bind(
      this.scope.tenantId, id, data.ticket_id, data.sender_id || null, data.sender_type, data.body || null, data.body_r2_key || null, data.snippet || null, data.raw_email_id || null, data.qa_type || null, data.is_internal ? 1 : 0,
      data.intake_source ?? null, data.received_at ?? null, data.processed_at ?? null,
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
      SELECT a.r2_key, a.file_name, a.content_type, art.is_internal, t.customer_email
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

  async findReplySender(groupId?: string | null): Promise<{ email_address: string } | null> {
    if (groupId) {
      const group = await this.db.prepare(`SELECT email_address FROM support_emails
        WHERE tenant_id = ? AND group_id = ? ORDER BY created_at ASC, id ASC LIMIT 1`)
        .bind(this.scope.tenantId, groupId).first<{ email_address: string }>();
      if (group) return group;
    }
    return this.db.prepare(`SELECT email_address FROM support_emails
      WHERE tenant_id = ? AND is_default = 1 ORDER BY created_at ASC, id ASC LIMIT 1`)
      .bind(this.scope.tenantId).first<{ email_address: string }>();
  }

  async createSupportEmail(data: { id: string, email_address: string, name?: string, group_id?: string, is_default: boolean }, fence?: CapabilityWriteFence): Promise<any> {
    const normalized_email = normalizeSupportEmail(data.email_address);
    const guard = capabilityWriteConstraint(fence);
    if (data.is_default) {
      const results = await this.db.batch([
        this.db.prepare(`UPDATE support_emails SET is_default = 0 WHERE tenant_id = ? AND ${guard.sql}`).bind(this.scope.tenantId, ...guard.values),
        this.db.prepare(
          `INSERT INTO support_emails (tenant_id, id, email_address, normalized_email, name, group_id, is_default)
           SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`
        ).bind(this.scope.tenantId, data.id, data.email_address, normalized_email, data.name || null, data.group_id || null, 1, ...guard.values)
      ]);
      requireCapabilityWrite(results[1], fence);
    } else {
      const result = await this.db.prepare(
        `INSERT INTO support_emails (tenant_id, id, email_address, normalized_email, name, group_id, is_default)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`
      ).bind(this.scope.tenantId, data.id, data.email_address, normalized_email, data.name || null, data.group_id || null, 0, ...guard.values).run();
      requireCapabilityWrite(result, fence);
    }
    return this.getSupportEmail(data.id);
  }

  async deleteSupportEmail(id: string, fence?: CapabilityWriteFence): Promise<void> {
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(`DELETE FROM support_emails WHERE tenant_id = ? AND id = ? AND ${guard.sql}`).bind(this.scope.tenantId, id, ...guard.values).run();
    requireCapabilityWrite(result, fence);
  }

  async getSupportEmail(id: string): Promise<any> {
    return this.db.prepare("SELECT * FROM support_emails WHERE tenant_id = ? AND id = ?").bind(this.scope.tenantId, id).first();
  }

  async findByEmail(email_address: string): Promise<any> {
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

  async set(key: string, value: string, fence?: CapabilityWriteFence): Promise<void> {
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(`INSERT INTO tenant_config (tenant_id, key, value, updated_at)
      SELECT ?, ?, ?, CURRENT_TIMESTAMP WHERE ${guard.sql}
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
      .bind(this.scope.tenantId, key, value, ...guard.values).run();
    requireCapabilityWrite(result, fence);
  }
}

import { SqlKnowledgeRepository } from './knowledge.repository';

export class SqlApiKeyRepository implements ApiKeyRepository {
  private static readonly PREFIX = 'lt_';
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}

  async recordUsage(id: string): Promise<void> {
    await this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE tenant_id = ? AND id = ?')
      .bind(new Date().toISOString(), this.scope.tenantId, id).run();
  }

  async list(): Promise<any[]> {
    const { results } = await this.db.prepare(
      "SELECT id, name, prefix, is_active, created_at, last_used_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC"
    ).bind(this.scope.tenantId).all();
    return results;
  }

  async create(name: string, permissionsList: string[] = ['tickets:read'], fence?: CapabilityWriteFence): Promise<{ apiKey: string; id: string; name: string; prefix: string; permissions: string[] }> {
    const id = crypto.randomUUID();
    const prefix = this.generateRandomString(8);
    const secret = this.generateRandomString(32);
    const apiKey = `${SqlApiKeyRepository.PREFIX}${prefix}.${secret}`;
    const keyHash = await this.hashKey(apiKey);
    const now = new Date().toISOString();
    const permissionsStr = permissionsList.join(',');

    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `INSERT INTO api_keys (tenant_id, id, name, key_hash, prefix, permissions, is_active, created_at)
       SELECT ?, ?, ?, ?, ?, ?, 1, ? WHERE ${guard.sql}`
    ).bind(this.scope.tenantId, id, name, keyHash, prefix, permissionsStr, now, ...guard.values).run();
    requireCapabilityWrite(result, fence);

    return { apiKey, id, name, prefix, permissions: permissionsList };
  }

  async get(id: string): Promise<any | null> {
    return this.db.prepare(
      "SELECT id, name, prefix, is_active, created_at, last_used_at FROM api_keys WHERE tenant_id = ? AND id = ?"
    ).bind(this.scope.tenantId, id).first();
  }

  async delete(id: string, fence?: CapabilityWriteFence): Promise<void> {
    const guard = capabilityWriteConstraint(fence);
    const deletion = this.db.prepare(
      `DELETE FROM api_keys WHERE tenant_id = ? AND id = ? AND ${guard.sql}`
    ).bind(this.scope.tenantId, id, ...guard.values);
    if (!fence) { await deletion.run(); return; }
    // Both statements observe one atomic batch: distinguish denied authority
    // from an authorized idempotent deletion without a read/write race.
    const [authorization, result] = await this.db.batch<{ allowed: number }>([
      this.db.prepare(`SELECT (${guard.sql}) AS allowed`).bind(...guard.values),
      deletion,
    ]);
    const changes = result?.meta?.changes;
    if (authorization?.results?.[0]?.allowed !== 1 || !Number.isInteger(changes) || changes < 0) {
      throw new CapabilityFenceError();
    }
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

  async create(data: { name: string; event_type: string; conditions?: string; action_type: string; action_config?: string; is_active: boolean }, fence?: CapabilityWriteFence): Promise<any> {
    const id = crypto.randomUUID();
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `INSERT INTO automation_rules (tenant_id, id, name, event_type, conditions, action_type, action_config, is_active)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`
    ).bind(
      this.scope.tenantId, id, data.name, data.event_type,
      data.conditions || null, data.action_type, data.action_config || null,
      data.is_active ? 1 : 0
    , ...guard.values).run();
    requireCapabilityWrite(result, fence);

    return this.get(id);
  }

  async update(id: string, data: Record<string, any>, fence?: CapabilityWriteFence): Promise<any | null> {
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
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `UPDATE automation_rules SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ? AND ${guard.sql}`
    ).bind(...params, ...guard.values).run();
    requireCapabilityWrite(result, fence);

    return this.get(id);
  }

  async delete(id: string, fence?: CapabilityWriteFence): Promise<void> {
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `DELETE FROM automation_rules WHERE tenant_id = ? AND id = ? AND ${guard.sql}`
    ).bind(this.scope.tenantId, id, ...guard.values).run();
    requireCapabilityWrite(result, fence);
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

  async create(data: { name: string; label: string; field_type: string; options?: string | null; is_active: boolean }, fence?: CapabilityWriteFence): Promise<any> {
    const id = crypto.randomUUID();
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `INSERT INTO ticket_fields (tenant_id, id, name, label, field_type, options, is_active)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`
    ).bind(this.scope.tenantId, id, data.name, data.label, data.field_type, data.options || null, data.is_active ? 1 : 0, ...guard.values).run();
    requireCapabilityWrite(result, fence);

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

  async create(data: { name: string; description?: string | null }, fence?: CapabilityWriteFence): Promise<any> {
    const id = crypto.randomUUID();
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `INSERT INTO groups (tenant_id, id, name, description) SELECT ?, ?, ?, ? WHERE ${guard.sql}`
    ).bind(this.scope.tenantId, id, data.name, data.description || null, ...guard.values).run();
    requireCapabilityWrite(result, fence);

    return this.get(id);
  }

  async delete(id: string, fence?: CapabilityWriteFence): Promise<void> {
    const guard = capabilityWriteConstraint(fence);
    const results = await this.db.batch([
      this.db.prepare(`DELETE FROM user_groups WHERE tenant_id = ? AND group_id = ? AND ${guard.sql}`).bind(this.scope.tenantId, id, ...guard.values),
      this.db.prepare(`DELETE FROM groups WHERE tenant_id = ? AND id = ? AND ${guard.sql}`).bind(this.scope.tenantId, id, ...guard.values)
    ]);
    requireCapabilityWrite(results[1], fence);
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

  async addMember(groupId: string, userId: string, fence?: CapabilityWriteFence): Promise<void> {
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `INSERT INTO user_groups (tenant_id, user_id, group_id) SELECT ?, ?, ? WHERE ${guard.sql}`
    ).bind(this.scope.tenantId, userId, groupId, ...guard.values).run();
    requireCapabilityWrite(result, fence);
  }

  async removeMember(groupId: string, userId: string, fence?: CapabilityWriteFence): Promise<void> {
    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `DELETE FROM user_groups WHERE tenant_id = ? AND user_id = ? AND group_id = ? AND ${guard.sql}`
    ).bind(this.scope.tenantId, userId, groupId, ...guard.values).run();
    requireCapabilityWrite(result, fence);
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

  async create(data: { name: string; conditions: any }, fence?: CapabilityWriteFence): Promise<any> {
    const id = `filter_${crypto.randomUUID()}`;
    const conditionsStr = typeof data.conditions === 'string' ? data.conditions : JSON.stringify(data.conditions);
    const now = new Date().toISOString();

    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `INSERT INTO ticket_filters (tenant_id, id, name, conditions, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, 0, ?, ? WHERE ${guard.sql}`
    ).bind(this.scope.tenantId, id, data.name, conditionsStr, now, now, ...guard.values).run();
    requireCapabilityWrite(result, fence);

    return this.get(id);
  }

  async update(id: string, data: { name: string; conditions: any }, fence?: CapabilityWriteFence): Promise<any | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    if (existing.is_system) {
      throw new Error("Cannot modify system filters");
    }

    const conditionsStr = typeof data.conditions === 'string' ? data.conditions : JSON.stringify(data.conditions);
    const now = new Date().toISOString();

    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `UPDATE ticket_filters SET name = ?, conditions = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND ${guard.sql}`
    ).bind(data.name, conditionsStr, now, this.scope.tenantId, id, ...guard.values).run();
    requireCapabilityWrite(result, fence);

    return this.get(id);
  }

  async delete(id: string, fence?: CapabilityWriteFence): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    if (existing.is_system) {
      throw new Error("Cannot delete system filters");
    }

    const guard = capabilityWriteConstraint(fence);
    const result = await this.db.prepare(
      `DELETE FROM ticket_filters WHERE tenant_id = ? AND id = ? AND ${guard.sql}`
    ).bind(this.scope.tenantId, id, ...guard.values).run();
    requireCapabilityWrite(result, fence);
  }
}

export class SqlRequestLimitRepository {
  constructor(private scope: VerifiedTenantScope, private db: D1Database) {}
  async consume(bucket: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) return false;
    const window = Math.floor(now / windowMs) * windowMs;
    const result = await this.db.prepare(`INSERT INTO tenant_request_limits (tenant_id, bucket, window_start, count)
      VALUES (?, ?, ?, 1) ON CONFLICT (tenant_id, bucket) DO UPDATE SET
      count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
      window_start = excluded.window_start
      WHERE window_start <> excluded.window_start OR count < ? RETURNING count`)
      .bind(this.scope.tenantId, bucket, window, limit).first();
    return Boolean(result);
  }
}

export function createRepositories(scope: VerifiedTenantScope, db: D1Database, betaAdmission?: LocalBetaAdmissionRepository, canonicalMutationSli?: RequestCanonicalMutationSli, budgetBindingIdentity: object = db): Repositories {
  return {
    budgetAuthority: new BudgetAuthorityRepository(db, scope, budgetBindingIdentity),
    sessionBudgetAuthority: new SessionBudgetAuthorityRepository(db, scope),
    requestLimits: new SqlRequestLimitRepository(scope, db),
    knowledge: new SqlKnowledgeRepository(scope, db),
    users: new SqlUserRepository(scope, db),
    tickets: new SqlTicketRepository(scope, db, betaAdmission, canonicalMutationSli),
    articles: new SqlArticleRepository(scope, db),
    attachments: new SqlAttachmentRepository(scope, db),
    channels: new SqlChannelsRepository(scope, db),
    config: new SqlConfigRepository(scope, db),
    apiKeys: new SqlApiKeyRepository(scope, db),
    automations: new SqlAutomationRepository(scope, db),
    ticketFields: new SqlTicketFieldRepository(scope, db),
    groups: new SqlGroupRepository(scope, db),
    ticketFilters: new SqlFilterRepository(scope, db),
    supportStates: new SupportStateRepository(db, scope, betaAdmission),
    slaClocks: new SlaClockRepository(db, scope),
    operatorWorkspace: new OperatorWorkspaceRepository(scope, db, betaAdmission)
  };
}
