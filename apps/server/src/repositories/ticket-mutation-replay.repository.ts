import { apiBudgetMutationStatements, type ApiMutationCommit } from './budget-commit-fence';
import { customerMutationStatement, type CustomerMutationCommit } from './customer-ticket-mutation.repository';
import type { StaffMutationCommit } from '../types/staff-ticket-mutation';
import { staffMutationStatements, staffMutationReceiptStatement } from './staff-ticket-mutation.repository';
import { StaffReplyPreconditionConflictError, staffReplyPreconditionConstraint, staffReplyPreconditionMatches, type StaffReplyPrecondition } from './staff-reply-precondition.repository';
export { StaffReplyPreconditionConflictError, type StaffReplyPrecondition } from './staff-reply-precondition.repository';
import { BetaAdmissionError } from '../types/local-beta';
import type { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import { auditedTicketUpdateStatements, conversationMutationEvent } from './conversation-audit.repository';
import { customerReplyResurfaceStatements } from './support-state.repository';
import type { AuditedTicketUpdate, ConversationActor } from '../types/conversation-audit';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { InitialTicketArticleData } from './interfaces';
import type { MutationNamespace, MutationReceipt, VerifiedMutationAttachment } from '../types/ticket-mutation-replay';
import type { RequestCanonicalMutationSli } from '../observability/request-canonical-mutation-sli';
import type { OperatorActivityRepository } from './operator-activity.repository';

// Fixed raw-row projections are response-version 1, not a second canonical mapper.
const ticketJson = `json_object('tenant_id',t.tenant_id,'id',t.id,'subject',t.subject,'status',t.status,
  'priority',t.priority,'customer_id',t.customer_id,'customer_email',t.customer_email,'assigned_to',t.assigned_to,
  'group_id',t.group_id,'source',t.source,'source_email',t.source_email,'custom_fields',t.custom_fields,
  'ticket_no',t.ticket_no,'created_at',t.created_at,'updated_at',t.updated_at,
  'intake_received_at',t.intake_received_at,'intake_processed_at',t.intake_processed_at)`;
const articleJson = `json_object('tenant_id',a.tenant_id,'id',a.id,'ticket_id',a.ticket_id,'sender_id',a.sender_id,
  'sender_type',a.sender_type,'body',a.body,'body_r2_key',a.body_r2_key,'snippet',a.snippet,
  'body_format',a.body_format,
  'raw_email_id',a.raw_email_id,'qa_type',a.qa_type,'chunk_count',a.chunk_count,'is_internal',a.is_internal,
  'created_at',a.created_at,'intake_source',a.intake_source,'received_at',a.received_at,'processed_at',a.processed_at)`;
const attachmentJson = `json_object('tenant_id',x.tenant_id,'id',x.id,'article_id',x.article_id,'file_name',x.file_name,
  'file_size',x.file_size,'content_type',x.content_type,'r2_key',x.r2_key,'created_at',x.created_at)`;
const namespaceWhere = 'tenant_id = ? AND principal_kind = ? AND principal_id = ? AND operation = ? AND key_hash = ?';
const defaultSlaCalendarJson = JSON.stringify({ timeZone: 'UTC', weekly: Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => [day,[{ startMinute: 0, endMinute: 1440 }]])), exceptions: [], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } });

export type MutationCandidate = {
  ticketId: string; articleId?: string;
  audit?: ConversationActor;
  ticket?: InitialTicketArticleData['ticket'];
  article?: InitialTicketArticleData['article'];
  attachments: (VerifiedMutationAttachment & { id: string })[];
  /** Prepared #133 projections that must commit with this canonical mutation. */
  activityStatements?: readonly D1PreparedStatement[];
  /** Normalized internal mention IDs bound to the acknowledged draft precondition. */
  mentionedUserIds?: readonly string[];
};

/** Only fixed ticket mutations; all SQL authority comes from the verified scope. */
export class TicketMutationReplayRepository {
  constructor(private db: D1Database, private scope: VerifiedTenantScope, private admission?: LocalBetaAdmissionRepository, private canonicalMutationSli?: RequestCanonicalMutationSli,
    private operatorActivity?: OperatorActivityRepository) {}

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

  /**
   * API ticket updates use the same receipt namespace and current-authority
   * fence as API creates/replies. The receipt is deliberately last so a
   * uniqueness collision rolls back its audit and ticket changes together.
   */
  async commitUpdate(ticketId: string, data: AuditedTicketUpdate, actor: ConversationActor,
    ns: MutationNamespace, api?: ApiMutationCommit): Promise<string> {
    if (actor.kind !== 'api-key' || actor.source !== 'api' || ns.principalKind !== 'api-key' || ns.operation !== 'api.ticket.update'
      || (api && (api.apiKeyId !== actor.id || ns.principalId !== actor.id || ns.keyHash !== api.authority.operationId
        || ns.payloadHash !== api.authority.operationFingerprint))) throw new Error('Invalid API update mutation');
    const statements: D1PreparedStatement[] = [...(api ? apiBudgetMutationStatements(this.db,this.scope,api) : [])];
    statements.push(this.db.prepare(`DELETE FROM ticket_mutation_receipts WHERE ${namespaceWhere} AND expires_at <= unixepoch()`)
      .bind(...this.namespaceValues(ns)));
    statements.push(this.db.prepare(`DELETE FROM ticket_mutation_receipts WHERE rowid IN
      (SELECT rowid FROM ticket_mutation_receipts WHERE tenant_id = ? AND expires_at <= unixepoch() ORDER BY expires_at LIMIT 99)`)
      .bind(this.scope.tenantId));
    const audit = auditedTicketUpdateStatements(this.db,this.scope,this.admission,ticketId,data,actor);
    const updateIndex = audit.updateIndex === undefined ? undefined : statements.length + audit.updateIndex;
    statements.push(...audit.statements);
    const snapshot = `json_object('version',3,'ticket',json((SELECT ${ticketJson} FROM tickets t WHERE t.tenant_id=? AND t.id=?)))`;
    // The same bounded immutable response guard applies with or without an
    // enabled coordinator policy. A failure rolls back the entire batch.
    statements.push(this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN length(CAST(${snapshot} AS BLOB))<=262144 THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId,this.scope.tenantId,ticketId));
    statements.push(this.db.prepare(`INSERT INTO ticket_mutation_receipts
      (tenant_id,principal_kind,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,
       result_ticket_id,result_article_id,response_status,response_snapshot)
      VALUES (?,?,?,?,?,?,1,3,?,?,200,${snapshot}) RETURNING response_snapshot`)
      .bind(...this.namespaceValues(ns),ns.payloadHash,ticketId,null,this.scope.tenantId,ticketId));
    this.canonicalMutationSli?.recordAttempt();
    let results;
    try { results = await this.db.batch<{ response_snapshot: string }>(statements); }
    catch (error) { this.canonicalMutationSli?.recordUncertain(); throw error; }
    const value = results.at(-1)?.results[0]?.response_snapshot;
    if (!value) throw new Error('Update result unavailable');
    if (updateIndex !== undefined && results[updateIndex]?.results[0]) this.canonicalMutationSli?.recordDurablyCompleted();
    else this.canonicalMutationSli?.recordNoOp();
    return value;
  }

  /** Dashboard PATCH uses the staff current-session fence and its own receipt
   * namespace, while sharing the one audited field-update projection. */
  async commitStaffUpdate(ticketId: string, data: AuditedTicketUpdate, actor: ConversationActor,
    staff: StaffMutationCommit, assignmentActivity?: Readonly<{ eventId: string; statement: D1PreparedStatement }>,
    expectedAssignedTo?: string | null): Promise<string> {
    if (actor.kind !== 'staff' || actor.source !== 'dashboard' || actor.id !== staff.credential.actorId
      || !staff.namespace || staff.namespace.operation !== 'dashboard.ticket.update'
      || staff.requirements.ticket?.id !== ticketId
      || staff.authority.operationId !== staff.namespace.keyHash
      || staff.authority.operationFingerprint !== staff.namespace.payloadHash
      || (assignmentActivity && (data.assigned_to === undefined || data.assigned_to === null))
      || (expectedAssignedTo !== undefined && (!staff.responsibleOwner || staff.responsibleOwner.ticketId !== ticketId
        || staff.responsibleOwner.ownerId !== (data.assigned_to ?? null)))
      || (expectedAssignedTo === undefined && staff.responsibleOwner !== undefined)) throw new Error('Invalid staff update mutation');
    const statements: D1PreparedStatement[] = [...staffMutationStatements(this.db,this.scope,staff)];
    const audit = assignmentActivity
      ? auditedTicketUpdateStatements(this.db,this.scope,this.admission,ticketId,data,actor,true,
        { 'ticket.assignment_changed': assignmentActivity.eventId })
      : auditedTicketUpdateStatements(this.db,this.scope,this.admission,ticketId,data,actor,true,expectedAssignedTo);
    const updateIndex = audit.updateIndex === undefined ? undefined : statements.length + audit.updateIndex;
    statements.push(...audit.statements);
    if (expectedAssignedTo !== undefined) {
      // The expected owner check prevents stale dashboard observations from
      // writing audit rows for already-advanced ownership. A request already at
      // its requested owner is a safe, receipted no-op.
      statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN accepted=1 AND EXISTS
        (SELECT 1 FROM tickets WHERE tenant_id=? AND id=? AND assigned_to IS ?) THEN 1 ELSE 0 END WHERE tenant_id=?`)
        .bind(this.scope.tenantId,ticketId,data.assigned_to ?? null,this.scope.tenantId));
    }
    const snapshot = `json_object('staffVersion',2,'ticket',json((SELECT ${ticketJson} FROM tickets t WHERE t.tenant_id=? AND t.id=?)))`;
    statements.push(this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN length(CAST(${snapshot} AS BLOB))<=262144 THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId,this.scope.tenantId,ticketId));
    // The receipt remains last: a same-key race rolls back every audit, note,
    // ticket and local-beta write made by the losing attempt.
    statements.push(staffMutationReceiptStatement(this.db,this.scope,staff.namespace,ticketId,null,2,200,snapshot,[this.scope.tenantId,ticketId]));
    this.canonicalMutationSli?.recordAttempt();
    let results;
    try { results = await this.db.batch<{ response_snapshot: string }>(statements); }
    catch (error) { this.canonicalMutationSli?.recordUncertain(); throw error; }
    const value = results.at(-1)?.results[0]?.response_snapshot;
    if (!value) throw new Error('Staff update result unavailable');
    if (updateIndex !== undefined && results[updateIndex]?.results[0]) this.canonicalMutationSli?.recordDurablyCompleted();
    else this.canonicalMutationSli?.recordNoOp();
    return value;
  }

  async commit(candidate: MutationCandidate, ns?: MutationNamespace, api?: ApiMutationCommit): Promise<string> {
    if (api && (candidate.audit?.kind !== 'api-key' || candidate.audit.id !== api.apiKeyId
      || (ns && (ns.principalKind !== 'api-key' || ns.principalId !== api.apiKeyId
        || ns.keyHash !== api.authority.operationId || ns.payloadHash !== api.authority.operationFingerprint)))) throw new Error('Invalid API mutation');
    return this.commitCanonical(candidate, ns, undefined, api);
  }

  async commitCustomer(candidate: MutationCandidate, ns: MutationNamespace | undefined, customer: CustomerMutationCommit): Promise<string> {
    const portalOperation = candidate.ticket ? 'portal.ticket.create' : 'portal.ticket.reply';
    const email = customer.credential.email.trim().toLowerCase();
    if (candidate.audit?.kind !== 'customer' || candidate.audit.id !== customer.credential.actorId
      || (candidate.audit.source !== 'portal' && candidate.audit.source !== 'widget') || !candidate.articleId || !candidate.article
      || candidate.article.sender_type !== 'customer' || candidate.article.sender_id !== customer.credential.actorId
      || candidate.article.is_internal || (candidate.ticket
        ? candidate.ticket.customer_id !== customer.credential.actorId || candidate.ticket.customer_email.trim().toLowerCase() !== email
        : customer.requirements.ticket?.id !== candidate.ticketId)
      || (ns && (ns.principalKind !== 'customer' || ns.principalId !== customer.credential.actorId || ns.operation !== portalOperation
        || ns.keyHash !== customer.authority.operationId || ns.payloadHash !== customer.authority.operationFingerprint))) {
      throw new Error('Invalid customer mutation');
    }
    return this.commitCanonical(candidate, ns, undefined, undefined, customer);
  }

  async commitStaff(candidate: MutationCandidate, staff: StaffMutationCommit, precondition?: StaffReplyPrecondition): Promise<string> {
    if (candidate.audit?.kind !== 'staff' || candidate.audit.id !== staff.credential.actorId
      || candidate.audit.source !== 'dashboard' || !candidate.articleId || !candidate.article
      || (staff.requirements.ticket?.id !== (candidate.ticket ? undefined : candidate.ticketId))
      || (staff.namespace && (staff.authority.operationId !== staff.namespace.keyHash || staff.authority.operationFingerprint !== staff.namespace.payloadHash))
      || (staff.namespace && staff.namespace.operation !== (candidate.ticket ? 'dashboard.ticket.create' : 'dashboard.ticket.reply'))
      || (candidate.activityStatements && (!candidate.article.is_internal || candidate.activityStatements.length > 16))
      || (candidate.mentionedUserIds?.length && (!candidate.article.is_internal || candidate.mentionedUserIds.length > 16))) {
      throw new Error('Invalid staff mutation');
    }
    return this.commitCanonical(candidate, undefined, staff, undefined, undefined, precondition);
  }

  private async commitCanonical(candidate: MutationCandidate, ns?: MutationNamespace, staff?: StaffMutationCommit,
    api?: ApiMutationCommit, customer?: CustomerMutationCommit, precondition?: StaffReplyPrecondition): Promise<string> {
    // This is after caller authorization/admission preparation and before
    // constructing the authoritative D1 batch. No HTTP response establishes this.
    this.canonicalMutationSli?.recordAttempt();
    const operation=candidate.ticket?'create':'conversation';
    const staffPrecondition = staff && precondition ? staffReplyPreconditionConstraint(this.scope, candidate, precondition) : undefined;
    const statements: D1PreparedStatement[] = [...(api ? apiBudgetMutationStatements(this.db,this.scope,api) : []),
      ...(staff ? staffMutationStatements(this.db,this.scope,staff,staffPrecondition) : []),
      ...(customer ? [customerMutationStatement(this.db,this.scope,customer)] : []), ...(this.admission?.statements(operation)??[])];
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
        (tenant_id,id,ticket_id,sender_id,sender_type,body,body_format,body_r2_key,snippet,raw_email_id,qa_type,is_internal,intake_source,received_at,processed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        this.scope.tenantId, candidate.articleId!, candidate.ticketId, a.sender_id ?? null, a.sender_type,
        a.body || null, a.body_format ?? 'plain', a.body_r2_key ?? null, a.snippet ?? null, a.raw_email_id ?? null, a.qa_type ?? null,
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

    // Clock initialization and the first public staff response share the same
    // canonical mutation batch and, when supplied, its replay receipt. A crash
    // therefore cannot accept a reply without durable SLA evidence.
    statements.push(this.db.prepare(`INSERT OR IGNORE INTO sla_policies
      (tenant_id,calendar_json,response_target_ms,resolution_target_ms,response_reopen_policy,resolution_reopen_policy)
      SELECT ?,?,NULL,NULL,'continue','continue' WHERE EXISTS (SELECT 1 FROM tickets WHERE tenant_id=? AND id=?)`)
      .bind(this.scope.tenantId,defaultSlaCalendarJson,this.scope.tenantId,candidate.ticketId));
    statements.push(this.db.prepare(`INSERT OR IGNORE INTO ticket_sla_clocks
      (tenant_id,ticket_id,response_started_at,resolution_started_at,paused_at,pause_reason,last_support_state_revision,
       policy_revision,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy)
      SELECT t.tenant_id,t.id,t.created_at,t.created_at,
        CASE WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL THEN s.changed_at ELSE NULL END,
        CASE WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL THEN 'waiting' ELSE NULL END,COALESCE(s.revision,0),
        p.revision,p.calendar_json,p.response_target_ms,p.resolution_target_ms,p.response_reopen_policy,p.resolution_reopen_policy
      FROM tickets t LEFT JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
      LEFT JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
      JOIN sla_policies p ON p.tenant_id=t.tenant_id WHERE t.tenant_id=? AND t.id=?`).bind(this.scope.tenantId,candidate.ticketId));
    statements.push(this.db.prepare(`INSERT OR IGNORE INTO ticket_sla_events (tenant_id,id,ticket_id,kind,support_state_revision,facts)
      SELECT tenant_id,lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
        ticket_id,'clock.initialized',last_support_state_revision,json_object('source','canonical-mutation')
      FROM ticket_sla_clocks WHERE tenant_id=? AND ticket_id=?`).bind(this.scope.tenantId,candidate.ticketId));
    if (candidate.article && candidate.article.sender_type === 'agent' && !candidate.article.is_internal) {
      statements.push(this.db.prepare(`UPDATE ticket_sla_clocks SET response_completed_at=(SELECT created_at FROM articles WHERE tenant_id=? AND id=? AND ticket_id=?),
        revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE tenant_id=? AND ticket_id=? AND response_completed_at IS NULL`).bind(this.scope.tenantId,candidate.articleId!,candidate.ticketId,this.scope.tenantId,candidate.ticketId));
      statements.push(this.db.prepare(`INSERT OR IGNORE INTO ticket_sla_events (tenant_id,id,ticket_id,kind,support_state_revision,facts)
        SELECT tenant_id,lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
          ticket_id,'clock.responded',last_support_state_revision,json_object('articleId',?)
        FROM ticket_sla_clocks WHERE tenant_id=? AND ticket_id=? AND response_completed_at=(SELECT created_at FROM articles WHERE tenant_id=? AND id=?)`)
        .bind(candidate.articleId!,this.scope.tenantId,candidate.ticketId,this.scope.tenantId,candidate.articleId!));
    }

    const eventId = candidate.audit ? crypto.randomUUID() : undefined;
    if (candidate.audit && eventId) statements.push(conversationMutationEvent(this.db,this.scope,{
      id:eventId,ticketId:candidate.ticketId,articleId:candidate.articleId,actor:candidate.audit,
      intake:Boolean(candidate.ticket),internal:Boolean(candidate.article?.is_internal),
    }));
    // Public canonical customer replies should both resurface shared snooze state
    // and feed durable operator activity projections. Both are prepared before the
    // durable receipt so idempotent replay rollbacks keep side-effects atomic.
    if ((customer || candidate.audit?.kind === 'customer') && candidate.article?.sender_type === 'customer'
      && !candidate.article.is_internal && eventId && candidate.articleId) {
      statements.push(...customerReplyResurfaceStatements(this.db,this.scope,{
        ticketId:candidate.ticketId,articleId:candidate.articleId,conversationEventId:eventId,
      }));
      const activity = await this.operatorActivity?.prepareCustomerReplyFromCanonicalEvent({
        id: crypto.randomUUID(), ticketId: candidate.ticketId, articleId: candidate.articleId, eventId,
      });
      if (activity) statements.push(activity.statement);
    }
    // Activity statements are prepared only by #133's repository. Keeping them
    // before the mutation receipt makes a losing idempotency race roll back both
    // the note and every durable mention projection.
    if (candidate.activityStatements?.length) statements.push(...candidate.activityStatements);
    const version = candidate.audit ? 2 : 1;
    const attachmentSnapshots = candidate.attachments.map(() => `json((SELECT ${attachmentJson} FROM attachments x WHERE x.tenant_id = ? AND x.id = ?))`);
    // Staff receipts record the format selected from the canonical article row,
    // after the write has passed all transaction fences. This keeps replay tied
    // to persisted content rather than to a request-side default.
    const staffFormatSnapshot = staff ? `,'staffVersion',1,'staffBodyFormat',
      (SELECT a.body_format FROM articles a WHERE a.tenant_id = ? AND a.id = ?)` : '';
    const rawSnapshot = `json_object('version',${version},
      'ticket',json((SELECT ${ticketJson} FROM tickets t WHERE t.tenant_id = ? AND t.id = ?)),
      'article',json((SELECT ${articleJson} FROM articles a WHERE a.tenant_id = ? AND a.id = ?))${staffFormatSnapshot},
      'attachments',json_array(${attachmentSnapshots.join(',')})${eventId ? ", 'audit',json_array(json_object('eventId',?,'articleId',?))" : ''})`;
    const snapshotValues = [this.scope.tenantId, candidate.ticketId, this.scope.tenantId, candidate.articleId ?? null,
      ...(staff ? [this.scope.tenantId, candidate.articleId ?? null] : []), ...candidate.attachments.flatMap(a => [this.scope.tenantId, a.id]), ...(eventId ? [eventId,candidate.articleId ?? null] : [])];
    const snapshot = rawSnapshot;
    if (staff?.namespace) {
      statements.push(staffMutationReceiptStatement(this.db,this.scope,staff.namespace,candidate.ticketId,candidate.articleId!,1,201,snapshot,snapshotValues));
    } else if (ns) {
      // Deliberately last: uniqueness failure rolls back every losing mutation.
      statements.push(this.db.prepare(`INSERT INTO ticket_mutation_receipts
        (tenant_id,principal_kind,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,
         result_ticket_id,result_article_id,response_status,response_snapshot)
        VALUES (?,?,?,?,?,?,1,${version},?,?,201,${snapshot}) RETURNING response_snapshot`)
        .bind(...this.namespaceValues(ns), ns.payloadHash, candidate.ticketId, candidate.articleId ?? null, ...snapshotValues));
    } else {
      if (staff) statements.push(this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN length(CAST(${snapshot} AS BLOB))<=262144 THEN 1 ELSE 0 END WHERE tenant_id=?`).bind(...snapshotValues,this.scope.tenantId));
      statements.push(this.db.prepare(`SELECT ${snapshot} AS response_snapshot`).bind(...snapshotValues));
    }
    let results;
    try { results = await this.db.batch<{ response_snapshot: string }>(statements); }
    catch(error) {
      if (staff && precondition) {
        try {
          if (!await staffReplyPreconditionMatches(this.db, this.scope, candidate, precondition)) throw new StaffReplyPreconditionConflictError();
        } catch (classification) {
          if (classification instanceof StaffReplyPreconditionConflictError) throw classification;
        }
      }
      if (!ns && this.admission) { await this.admission.authorize(operation); throw new BetaAdmissionError('beta_admission_unavailable',503); }
      throw error;
    }
    const value = results[results.length - 1].results[0]?.response_snapshot;
    if (!value) throw new Error('Mutation result unavailable');
    // The full tenant-scoped batch committed and returned its durable receipt.
    this.canonicalMutationSli?.recordDurablyCompleted();
    return value;
  }
}
