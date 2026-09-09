import { BetaAdmissionError } from '../types/local-beta';
import type { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import { conversationMutationEvent } from './conversation-audit.repository';
import type { ConversationActor } from '../types/conversation-audit';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { InitialTicketArticleData } from './interfaces';
import type { MutationNamespace, MutationReceipt, VerifiedMutationAttachment } from '../types/ticket-mutation-replay';

// Fixed raw-row projections are response-version 1, not a second canonical mapper.
const ticketJson = `json_object('tenant_id',t.tenant_id,'id',t.id,'subject',t.subject,'status',t.status,
  'priority',t.priority,'customer_id',t.customer_id,'customer_email',t.customer_email,'assigned_to',t.assigned_to,
  'group_id',t.group_id,'source',t.source,'source_email',t.source_email,'custom_fields',t.custom_fields,
  'ticket_no',t.ticket_no,'created_at',t.created_at,'updated_at',t.updated_at,
  'intake_received_at',t.intake_received_at,'intake_processed_at',t.intake_processed_at)`;
const articleJson = `json_object('tenant_id',a.tenant_id,'id',a.id,'ticket_id',a.ticket_id,'sender_id',a.sender_id,
  'sender_type',a.sender_type,'body',a.body,'body_r2_key',a.body_r2_key,'snippet',a.snippet,
  'raw_email_id',a.raw_email_id,'qa_type',a.qa_type,'chunk_count',a.chunk_count,'is_internal',a.is_internal,
  'created_at',a.created_at,'intake_source',a.intake_source,'received_at',a.received_at,'processed_at',a.processed_at)`;
const attachmentJson = `json_object('tenant_id',x.tenant_id,'id',x.id,'article_id',x.article_id,'file_name',x.file_name,
  'file_size',x.file_size,'content_type',x.content_type,'r2_key',x.r2_key,'created_at',x.created_at)`;
const namespaceWhere = 'tenant_id = ? AND principal_kind = ? AND principal_id = ? AND operation = ? AND key_hash = ?';

export type MutationCandidate = {
  ticketId: string; articleId?: string;
  audit?: ConversationActor;
  ticket?: InitialTicketArticleData['ticket'];
  article?: InitialTicketArticleData['article'];
  attachments: (VerifiedMutationAttachment & { id: string })[];
};

/** Only fixed ticket mutations; all SQL authority comes from the verified scope. */
export class TicketMutationReplayRepository {
  constructor(private db: D1Database, private scope: VerifiedTenantScope, private admission?: LocalBetaAdmissionRepository) {}

  private namespaceValues(ns: MutationNamespace) {
    return [this.scope.tenantId, ns.principalKind, ns.principalId, ns.operation, ns.keyHash];
  }

  async findActive(ns: MutationNamespace): Promise<MutationReceipt | null> {
    return this.db.prepare(`SELECT * FROM ticket_mutation_receipts WHERE ${namespaceWhere} AND expires_at > unixepoch()`)
      .bind(...this.namespaceValues(ns)).first<MutationReceipt>();
  }

  async purgeExpired(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Cleanup batch must contain 1 to 100 rows');
    const result = await this.db.prepare(`DELETE FROM ticket_mutation_receipts WHERE rowid IN
      (SELECT rowid FROM ticket_mutation_receipts WHERE tenant_id = ? AND expires_at <= unixepoch() ORDER BY expires_at LIMIT ?)`)
      .bind(this.scope.tenantId, limit).run();
    return result.meta.changes;
  }

  async activeApiKey(id: string) {
    return this.db.prepare('SELECT permissions FROM api_keys WHERE tenant_id = ? AND id = ? AND is_active = 1')
      .bind(this.scope.tenantId, id).first<{ permissions: string }>();
  }

  async currentCustomer(id: string) {
    return this.db.prepare('SELECT email, role, session_version FROM users WHERE tenant_id = ? AND id = ?')
      .bind(this.scope.tenantId, id).first<{ email: string; role: string; session_version: number }>();
  }

  async ticketOwnership(id: string) {
    return this.db.prepare('SELECT customer_email, customer_id FROM tickets WHERE tenant_id = ? AND id = ?')
      .bind(this.scope.tenantId, id).first<{ customer_email: string; customer_id: string | null }>();
  }

  async articleVisibility(id: string, ticketId: string) {
    return this.db.prepare('SELECT is_internal FROM articles WHERE tenant_id = ? AND id = ? AND ticket_id = ?')
      .bind(this.scope.tenantId, id, ticketId).first<{ is_internal: number }>();
  }

  async commit(candidate: MutationCandidate, ns?: MutationNamespace): Promise<string> {
    const operation=candidate.ticket?'create':'conversation';
    const statements: D1PreparedStatement[] = [...(this.admission?.statements(operation)??[])];
    if (ns) {
      // Exact expired-key reuse and at most 99 other expired rows: bounded 100.
      statements.push(this.db.prepare(`DELETE FROM ticket_mutation_receipts WHERE ${namespaceWhere} AND expires_at <= unixepoch()`)
        .bind(...this.namespaceValues(ns)));
      statements.push(this.db.prepare(`DELETE FROM ticket_mutation_receipts WHERE rowid IN
        (SELECT rowid FROM ticket_mutation_receipts WHERE tenant_id = ? AND expires_at <= unixepoch() ORDER BY expires_at LIMIT 99)`)
        .bind(this.scope.tenantId));
    }
    if (candidate.ticket) {
      const t = candidate.ticket;
      statements.push(this.db.prepare(`INSERT INTO tickets
        (tenant_id,id,subject,status,priority,customer_id,customer_email,assigned_to,group_id,source,source_email,custom_fields,intake_received_at,intake_processed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        this.scope.tenantId, candidate.ticketId, t.subject, t.status, t.priority, t.customer_id ?? null,
        t.customer_email, t.assigned_to ?? null, t.group_id ?? null, t.source, t.source_email ?? null,
        t.custom_fields === undefined ? null : typeof t.custom_fields === 'string' ? t.custom_fields : JSON.stringify(t.custom_fields),
        t.intake_received_at, t.intake_processed_at,
      ));
    }
    if (candidate.article) {
      const a = candidate.article;
      statements.push(this.db.prepare(`INSERT INTO articles
        (tenant_id,id,ticket_id,sender_id,sender_type,body,body_r2_key,snippet,raw_email_id,qa_type,is_internal,intake_source,received_at,processed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        this.scope.tenantId, candidate.articleId!, candidate.ticketId, a.sender_id ?? null, a.sender_type,
        a.body || null, a.body_r2_key ?? null, a.snippet ?? null, a.raw_email_id ?? null, a.qa_type ?? null,
        a.is_internal ? 1 : 0, a.intake_source, a.received_at, a.processed_at,
      ));
    }
    for (const a of candidate.attachments) {
      statements.push(this.db.prepare(`INSERT INTO attachments
        (tenant_id,id,article_id,file_name,file_size,content_type,r2_key) VALUES (?,?,?,?,?,?,?)`)
        .bind(this.scope.tenantId, a.id, candidate.articleId!, a.filename, a.size, a.contentType, a.storageKey));
    }
    if (!candidate.ticket) statements.push(this.db.prepare('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?')
      .bind(this.scope.tenantId, candidate.ticketId));

    const eventId = candidate.audit ? crypto.randomUUID() : undefined;
    if (candidate.audit && eventId) statements.push(conversationMutationEvent(this.db,this.scope,{
      id:eventId,ticketId:candidate.ticketId,articleId:candidate.articleId,actor:candidate.audit,
      intake:Boolean(candidate.ticket),internal:Boolean(candidate.article?.is_internal),
    }));
    const version = candidate.audit ? 2 : 1;
    const attachmentSnapshots = candidate.attachments.map(() => `json((SELECT ${attachmentJson} FROM attachments x WHERE x.tenant_id = ? AND x.id = ?))`);
    const snapshot = `json_object('version',${version},
      'ticket',json((SELECT ${ticketJson} FROM tickets t WHERE t.tenant_id = ? AND t.id = ?)),
      'article',json((SELECT ${articleJson} FROM articles a WHERE a.tenant_id = ? AND a.id = ?)),
      'attachments',json_array(${attachmentSnapshots.join(',')})${eventId ? ", 'audit',json_array(json_object('eventId',?,'articleId',?))" : ''})`;
    const snapshotValues = [this.scope.tenantId, candidate.ticketId, this.scope.tenantId, candidate.articleId ?? null,
      ...candidate.attachments.flatMap(a => [this.scope.tenantId, a.id]), ...(eventId ? [eventId,candidate.articleId ?? null] : [])];
    if (ns) {
      // Deliberately last: uniqueness failure rolls back every losing mutation.
      statements.push(this.db.prepare(`INSERT INTO ticket_mutation_receipts
        (tenant_id,principal_kind,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,
         result_ticket_id,result_article_id,response_status,response_snapshot)
        VALUES (?,?,?,?,?,?,1,${version},?,?,201,${snapshot}) RETURNING response_snapshot`)
        .bind(...this.namespaceValues(ns), ns.payloadHash, candidate.ticketId, candidate.articleId ?? null, ...snapshotValues));
    } else {
      statements.push(this.db.prepare(`SELECT ${snapshot} AS response_snapshot`).bind(...snapshotValues));
    }
    let results;
    try { results = await this.db.batch<{ response_snapshot: string }>(statements); }
    catch(error) {
      if (!ns && this.admission) { await this.admission.authorize(operation); throw new BetaAdmissionError('beta_admission_unavailable',503); }
      throw error;
    }
    const value = results[results.length - 1].results[0]?.response_snapshot;
    if (!value) throw new Error('Mutation result unavailable');
    return value;
  }
}
