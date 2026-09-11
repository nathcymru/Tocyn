import { CANONICAL_MUTATION_D1_WRITES } from '../budgets/canonical-mutation-envelope';
import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import type { Attachment, Article, Ticket } from '../types';
import type { PreparedStaffMutation, StaffMutationInput, StaffMutationNamespace, StaffMutationOutcome, StaffMutationReceipt } from '../types/staff-ticket-mutation';
import type { VerifiedMutationAttachment } from '../types/ticket-mutation-replay';
import type { CapabilityWriteFence } from '../auth/capability-policy';
import type { BudgetCommitAuthority, CanonicalBudgetIntent } from '../budgets/isolate-admission.service';
import { articleBodyFormat, normalizeCollaborationMentionIds, type ArticleBodyFormat } from '@luminatick/shared';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential, type SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import { TicketMutationReplayRepository, StaffReplyPreconditionConflictError, type MutationCandidate } from '../repositories/ticket-mutation-replay.repository';
import { StaffTicketMutationRepository } from '../repositories/staff-ticket-mutation.repository';
import type { OperatorActivityService } from './operator-activity.service';
import { TicketMutationError, canonicalMutationJson } from './ticket-mutation-replay.service';
import { canonicalBroadcastGrantAfterCommit, type CanonicalBroadcastGrant } from '../budgets/realtime-admission.service';
import { canonicalTicketEmailGrantAfterCommit, type TicketEmailCanonicalGrant } from './email/ticket-email-admission.service';

const unavailable = () => new TicketMutationError(503,'staff_mutation_unavailable','Ticket mutation unavailable; retry with the same key');
const denied = () => new TicketMutationError(403,'staff_mutation_denied','Ticket mutation is not authorized');
const invalid = () => new TicketMutationError(400,'invalid_mutation','Invalid ticket mutation');
const unsupportedFormat = () => new TicketMutationError(400,'unsupported_article_format','Article format is not enabled');
const staleDraft = () => new TicketMutationError(409,'staff_reply_stale','The saved draft or conversation changed. Review and rebase before sending.');
const unavailableMention = () => new TicketMutationError(409,'mention_recipient_unavailable','A mentioned colleague no longer has access to this internal note. Review the mention selection; your draft is retained.');
// Match the current reply capability and dashboard request contract before
// admission; Markdown rendering enforces the same character and byte bounds.
const MAX_ARTICLE_BODY_SIZE = 16_000;
async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2,'0')).join('');
}
function owned<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown) => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(clone); return clone;
}
type Attempt = { input: StaffMutationInput; namespace?: StaffMutationNamespace; requirements: SessionBudgetRequirements;
  intent: CanonicalBudgetIntent; authority?: BudgetCommitAuthority; commitStarted: boolean; keyed: boolean;
  broadcastGrant?: CanonicalBroadcastGrant; ticketEmailGrant?: TicketEmailCanonicalGrant; committedOutcome?: StaffMutationOutcome };

/** Staff canonical mutations and receipts used by the configured dashboard admission path. */
export class StaffTicketMutationService {
  private readonly receipts: StaffTicketMutationRepository;
  private readonly sessions: SessionBudgetAuthorityRepository;
  private readonly attempts = new WeakMap<PreparedStaffMutation,Attempt>();
  private readonly credential: SessionBudgetCredential;
  private readonly capability?: CapabilityWriteFence;
  constructor(db: D1Database, private readonly scope: VerifiedTenantScope, credential: SessionBudgetCredential,
    private readonly canonical: TicketMutationReplayRepository,
    private readonly budget: { service: SessionBudgetAdmissionService; repository: BudgetAuthorityRepository;
      namespace: DurableObjectNamespace; business: ResourceAmounts; now?: () => number }, capability?: CapabilityWriteFence, private readonly activity?: OperatorActivityService) {
    this.credential = owned(credential); this.capability = capability && owned(capability);
    this.receipts = new StaffTicketMutationRepository(db,scope); this.sessions = new SessionBudgetAuthorityRepository(db,scope);
  }
  private now() { return this.budget.now?.() ?? Date.now(); }
  private async authorize(requirements: SessionBudgetRequirements): Promise<void> {
    if (!await this.sessions.authorize(this.credential,requirements,this.now())) throw denied();
  }
  private normalize(input: StaffMutationInput): StaffMutationInput {
    if (input.operation === 'dashboard.ticket.update') {
      if (typeof input.ticketId !== 'string' || !input.ticketId || !input.data || Object.getPrototypeOf(input.data) !== Object.prototype) throw invalid();
      const allowed = ['status','priority','assigned_to','group_id','custom_fields'];
      const supplied = Object.keys(input.data);
      if (!supplied.length || supplied.some(key => !allowed.includes(key))) throw invalid();
      const data = input.data;
      if (data.status !== undefined && !['open','pending','resolved','closed'].includes(data.status)) throw invalid();
      if (data.priority !== undefined && !['low','normal','high','urgent'].includes(data.priority)) throw invalid();
      if (data.assigned_to !== undefined && data.assigned_to !== null && (typeof data.assigned_to !== 'string' || !data.assigned_to)) throw invalid();
      if (data.group_id !== undefined && data.group_id !== null && (typeof data.group_id !== 'string' || !data.group_id)) throw invalid();
      if (data.custom_fields !== undefined && data.custom_fields !== null && Object.getPrototypeOf(data.custom_fields) !== Object.prototype) throw invalid();
      return { operation: input.operation, ticketId: input.ticketId, data: { ...data } };
    }
    const d = input.data;
    let bodyFormat: ArticleBodyFormat;
    try { bodyFormat = articleBodyFormat(d.bodyFormat); } catch { throw unsupportedFormat(); }
    if (typeof d.body !== 'string' || !d.body.trim()
      || d.body.length > MAX_ARTICLE_BODY_SIZE || new TextEncoder().encode(d.body).byteLength > MAX_ARTICLE_BODY_SIZE) throw invalid();
    if (input.operation === 'dashboard.ticket.create') {
      const data = input.data;
      if (typeof data.subject !== 'string' || !data.subject.trim() || typeof data.customer_email !== 'string' || !data.customer_email.trim()) throw invalid();
      if (data.status && !['open','pending','resolved','closed'].includes(data.status)) throw invalid();
      if (data.priority && !['low','normal','high','urgent'].includes(data.priority)) throw invalid();
      return { operation: input.operation, data: { subject: data.subject, customer_email: data.customer_email.toLowerCase(), body: data.body,
        bodyFormat, status: data.status ?? 'open', priority: data.priority ?? 'normal', group_id: data.group_id ?? null,
        assigned_to: data.assigned_to ?? null, ...(data.custom_fields == null ? {} : { custom_fields: data.custom_fields }) } };
    }
    if (input.operation !== 'dashboard.ticket.reply' || typeof input.ticketId !== 'string' || !input.ticketId) throw invalid();
    const attachments = input.data.attachments ?? [];
    const rawMentions = input.data.mentionedUserIds ?? [];
    if (!Array.isArray(attachments) || attachments.length > 10 || !Array.isArray(rawMentions) || rawMentions.length > 16
      || (input.data.is_internal !== undefined && typeof input.data.is_internal !== 'boolean')) throw invalid();
    if (rawMentions.some(id => typeof id !== 'string')) throw invalid();
    const mentionedUserIds = normalizeCollaborationMentionIds(rawMentions, input.data.is_internal === true ? 'internal' : 'public', this.credential.actorId);
    if (!mentionedUserIds) throw invalid();
    const seen = new Set<string>();
    const draft = input.data.draft;
    if (draft && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft.generation)
      || !Number.isSafeInteger(draft.revision) || draft.revision < 1 || !Number.isSafeInteger(draft.baseConversationRevision) || draft.baseConversationRevision < 0)) throw invalid();
    return { operation: input.operation, ticketId: input.ticketId, data: { body: input.data.body, bodyFormat, is_internal: input.data.is_internal ?? false,
      ...(draft ? { draft } : {}), ...(mentionedUserIds.length ? { mentionedUserIds } : {}), attachments: attachments.map(a => {
        if (!a || typeof a.storageKey !== 'string' || a.storageKey.length > 1024 || !a.storageKey.startsWith(`agent-attachments/${this.credential.actorId}/`)
          || seen.has(a.storageKey) || typeof a.filename !== 'string') throw invalid();
        seen.add(a.storageKey);
        const filename = a.filename.replace(/^.*[\\/]/,'').replace(/[\r\n]/g,'');
        if (!filename || filename.length > 255) throw invalid();
        return { storageKey: a.storageKey, filename };
      }) } };
  }
  private render(raw: string, operation: StaffMutationInput['operation'], replayed: boolean, keyed: boolean): StaffMutationOutcome {
    let snapshot: { staffVersion: number; staffBodyFormat?: unknown; ticket: Ticket; article?: Article; attachments?: Attachment[] };
    try { snapshot = JSON.parse(raw); } catch { throw unavailable(); }
    if (operation === 'dashboard.ticket.update') {
      if (snapshot.staffVersion !== 2 || !snapshot.ticket?.id) throw unavailable();
      // The update route never reads an article. Keep the established common
      // internal outcome shape so create/reply callers stay source-compatible.
      return { status: 200,body:{success:true},ticket:snapshot.ticket,article:null as unknown as Article,attachments:[],replayed,keyed };
    }
    if (snapshot.staffVersion !== 1 || !snapshot.ticket?.id || !snapshot.article?.id || !Array.isArray(snapshot.attachments)) throw unavailable();
    let bodyFormat: ArticleBodyFormat;
    try { bodyFormat = articleBodyFormat(snapshot.article.body_format); } catch { throw unavailable(); }
    // Existing plain receipts remain readable. New snapshots obtain this value
    // from the just-written canonical article, and must agree with it on replay.
    if (snapshot.staffBodyFormat !== undefined && snapshot.staffBodyFormat !== bodyFormat) throw unavailable();
    const article = { ...snapshot.article, body_format: bodyFormat, is_internal: Boolean(snapshot.article.is_internal) } as Article;
    const attachments = snapshot.attachments;
    const body = operation.endsWith('.create') ? { ...snapshot.ticket } : { ...article,
      attachments: attachments.map(a => ({ id: a.id, filename: a.file_name, size: a.file_size, contentType: a.content_type, storageKey: a.r2_key })) };
    return { status: 201,body,ticket:snapshot.ticket,article,attachments,replayed,keyed };
  }
  private async replay(receipt: StaffMutationReceipt, ns: StaffMutationNamespace): Promise<StaffMutationOutcome> {
    await this.authorize({ capability: this.capability });
    if (receipt.payload_hash !== ns.payloadHash) throw new TicketMutationError(409,'idempotency_conflict','Idempotency key was already used with a different payload');
    if (receipt.lifecycle === 'gone') throw new TicketMutationError(410,'idempotency_result_gone','The original mutation result is no longer available');
    const update = ns.operation === 'dashboard.ticket.update';
    if (receipt.fingerprint_version !== 1 || !receipt.result_ticket_id || !receipt.response_snapshot
      || (update ? receipt.response_version !== 2 || receipt.response_status !== 200 || receipt.result_article_id !== null
        : receipt.response_version !== 1 || receipt.response_status !== 201 || !receipt.result_article_id)) throw unavailable();
    const ticket = await this.receipts.ticket(receipt.result_ticket_id);
    if (!ticket) throw denied();
    await this.authorize({ capability: this.capability,ticket:{id:ticket.id,groupId:ticket.group_id ?? null} });
    if (!update && !await this.receipts.articleExists(ticket.id,receipt.result_article_id!)) throw denied();
    return this.render(receipt.response_snapshot,ns.operation,true,true);
  }
  async prepareStaffMutation(input: StaffMutationInput, key?: string): Promise<PreparedStaffMutation> {
    await this.authorize({ capability: this.capability });
    if (key !== undefined && !/^[A-Za-z0-9._~-]{1,128}$/.test(key)) throw invalid();
    const normalized = this.normalize(input);
    const serialized = canonicalMutationJson(normalized);
    if (new TextEncoder().encode(serialized).byteLength > 128 * 1024) throw new TicketMutationError(413,'payload_too_large','Payload too large');
    const requirements: { capability?: CapabilityWriteFence; ticket?: { id: string; groupId: string | null } } = { capability: this.capability };
    if ('ticketId' in normalized) {
      const ticket = await this.receipts.ticket(normalized.ticketId);
      if (!ticket) throw denied();
      requirements.ticket = { id:ticket.id,groupId:ticket.group_id ?? null };
      await this.authorize(requirements);
    }
    const payloadHash = await digest(`staff-ticket-mutation-v1\n${serialized}`);
    const keyed = key !== undefined;
    const ns: StaffMutationNamespace | undefined = key === undefined && normalized.operation !== 'dashboard.ticket.update' ? undefined
      : { principalId:this.credential.actorId,operation:normalized.operation,keyHash:await digest(key ?? `server:${crypto.randomUUID()}`),payloadHash };
    const receipt = ns ? await this.receipts.findActive(ns) : null;
    const prepared = Object.freeze({ replay: receipt && ns ? await this.replay(receipt,ns) : null });
    this.attempts.set(prepared,{ input:owned(normalized),namespace:ns && owned(ns),requirements:owned(requirements),commitStarted:false,keyed,
      intent:Object.freeze({ operationId:ns?.keyHash ?? `server:${crypto.randomUUID()}`,operationFingerprint:payloadHash,
        workScopeKey:`${normalized.operation}:${await digest('ticketId' in normalized ? normalized.ticketId : normalized.data.group_id ?? 'new')}` }) });
    return prepared;
  }
  admissionIntent(prepared: PreparedStaffMutation): CanonicalBudgetIntent {
    const attempt = this.attempts.get(prepared); if (!attempt || prepared.replay) throw unavailable(); return attempt.intent;
  }
  async admit(prepared: PreparedStaffMutation) {
    const attempt = this.attempts.get(prepared); if (!attempt) throw unavailable();
    if (attempt.namespace) {
      const receipt = await this.receipts.findActive(attempt.namespace);
      if (receipt) return { status:'replayed' as const,outcome:await this.replay(receipt,attempt.namespace) };
    }
    const result = await this.budget.service.admit({ repository:this.budget.repository,sessions:this.sessions,namespace:this.budget.namespace,
      scope:this.scope,credential:this.credential,requirements:attempt.requirements,intent:attempt.intent,business:{...this.budget.business,d1RowsWritten:Math.max(this.budget.business.d1RowsWritten ?? 0,CANONICAL_MUTATION_D1_WRITES)},now:() => this.now() });
    const authority = result.status !== 'rejected' ? result.commitAuthority : undefined;
    attempt.authority = authority && authority.operationId === attempt.intent.operationId
      && authority.operationFingerprint === attempt.intent.operationFingerprint ? owned(authority) : undefined;
    return result;
  }
  /**
   * Available only after this exact prepared attempt observed a winning D1
   * commit.  Receipt replays never receive it, so a lost HTTP response cannot
   * create an additional advisory broadcast.
   */
  broadcastGrant(prepared: PreparedStaffMutation, outcome: StaffMutationOutcome): CanonicalBroadcastGrant | null {
    const attempt = this.attempts.get(prepared);
    return attempt && !outcome.replayed ? attempt.broadcastGrant ?? null : null;
  }
  /** One exact public-email capability from this in-memory canonical winner. */
  ticketEmailGrant(prepared: PreparedStaffMutation, outcome: StaffMutationOutcome): TicketEmailCanonicalGrant | null {
    const attempt = this.attempts.get(prepared);
    return attempt?.committedOutcome === outcome && !outcome.replayed ? attempt.ticketEmailGrant ?? null : null;
  }
  private committed(prepared: PreparedStaffMutation, outcome: StaffMutationOutcome): StaffMutationOutcome {
    const attempt = this.attempts.get(prepared);
    if (attempt && !outcome.replayed) {
      attempt.committedOutcome = outcome;
      attempt.broadcastGrant = canonicalBroadcastGrantAfterCommit(attempt.authority, this.scope.tenantId, this.now()) ?? undefined;
      attempt.ticketEmailGrant = canonicalTicketEmailGrantAfterCommit(attempt.authority,this.credential,attempt.input.operation,outcome) ?? undefined;
    }
    return outcome;
  }
  async commit(prepared: PreparedStaffMutation, verified: VerifiedMutationAttachment[] = []): Promise<StaffMutationOutcome> {
    const attempt = this.attempts.get(prepared); if (!attempt) throw unavailable();
    await this.authorize(attempt.requirements);
    if (attempt.namespace) {
      const receipt = await this.receipts.findActive(attempt.namespace);
      if (receipt) return this.replay(receipt,attempt.namespace);
    }
    if (!attempt.authority || this.now() >= attempt.authority.expiresAt || attempt.commitStarted) throw unavailable();
    const input = attempt.input, now = new Date(this.now()).toISOString();
    if (input.operation === 'dashboard.ticket.update') {
      if (verified.length || !attempt.namespace) throw invalid();
      attempt.commitStarted = true;
      try {
        const assignmentEventId = input.data.assigned_to === undefined || input.data.assigned_to === null
          ? undefined : crypto.randomUUID();
        const assignmentActivity = assignmentEventId
          ? await this.activity?.prepareAssignmentFromCanonicalEvent({
            id: crypto.randomUUID(), ticketId: input.ticketId, recipientUserId: input.data.assigned_to!,
            eventId: assignmentEventId, producerId: this.credential.actorId,
          }) : undefined;
        if (assignmentEventId && !assignmentActivity) throw unavailable();
        const raw = await this.canonical.commitStaffUpdate(input.ticketId,input.data,{kind:'staff',id:this.credential.actorId,source:'dashboard'},
          { credential:this.credential,requirements:attempt.requirements,authority:attempt.authority,namespace:attempt.namespace },
          assignmentActivity ? { eventId: assignmentEventId!, statement: assignmentActivity.statement } : undefined);
        return this.committed(prepared,this.render(raw,input.operation,false,attempt.keyed));
      } catch (error) {
        await this.authorize(attempt.requirements);
        const winner = await this.receipts.findActive(attempt.namespace);
        if (winner) return this.replay(winner,attempt.namespace);
        throw unavailable();
      }
    }
    const candidate: MutationCandidate = { ticketId:'ticketId' in input ? input.ticketId : crypto.randomUUID(),articleId:crypto.randomUUID(),
      audit:{kind:'staff',id:this.credential.actorId,source:'dashboard'},attachments:[],
      ...('ticketId' in input ? { mentionedUserIds: input.data.mentionedUserIds ?? [] } : {}) };
    if (input.operation === 'dashboard.ticket.create') {
      if (verified.length) throw invalid();
      const customer = await this.receipts.customer(input.data.customer_email);
      candidate.ticket = { subject:input.data.subject,customer_email:input.data.customer_email,customer_id:customer?.id ?? null,
        source:'dashboard',status:input.data.status ?? 'open',priority:input.data.priority ?? 'normal',group_id:input.data.group_id,
        assigned_to:input.data.assigned_to,custom_fields:input.data.custom_fields,intake_received_at:now,intake_processed_at:now };
      candidate.article = { body:input.data.body,body_format:input.data.bodyFormat,sender_type:'customer',sender_id:customer?.id,is_internal:false,intake_source:'dashboard',received_at:now,processed_at:now };
    } else {
      candidate.article = { body:input.data.body,body_format:input.data.bodyFormat,sender_type:'agent',sender_id:this.credential.actorId,is_internal:input.data.is_internal ?? false,
        intake_source:'dashboard',received_at:now,processed_at:now };
      const requested = input.data.attachments ?? [];
      if (verified.length !== requested.length) throw invalid();
      candidate.attachments = verified.map((a,index) => {
        if (a.storageKey !== requested[index].storageKey || a.filename !== requested[index].filename || !Number.isSafeInteger(a.size)
          || a.size < 0 || a.size > 10*1024*1024 || !['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain','text/csv'].includes(a.contentType)) throw invalid();
        return { ...a,id:crypto.randomUUID() };
      });
    }
    // At most one canonical batch per prepared attempt, after all validation
    // awaits. A retry needs fresh admission; an existing receipt returns above.
    if (input.operation === 'dashboard.ticket.reply' && input.data.mentionedUserIds?.length) {
      const activity = this.activity;
      if (!candidate.article?.is_internal || !activity) throw invalid();
      candidate.activityStatements = await Promise.all(input.data.mentionedUserIds.map(recipientUserId => activity.prepareTrustedAppend({
        id: crypto.randomUUID(), ticketId: candidate.ticketId, recipientUserId, kind: 'mention',
        sourceId: `article:${candidate.articleId}:mention:${recipientUserId}`, producer: { kind: 'staff', id: this.credential.actorId },
        facts: { articleId: candidate.articleId! },
      }).then(prepared => prepared.statement)));
    }
    if (attempt.commitStarted) throw unavailable();
    attempt.commitStarted = true;
    try {
      const raw = await this.canonical.commitStaff(candidate,{ credential:this.credential,requirements:attempt.requirements,authority:attempt.authority,namespace:attempt.namespace },
        input.operation === 'dashboard.ticket.reply' && input.data.draft ? { ticketId: candidate.ticketId, ...input.data.draft } : undefined);
      return this.committed(prepared,this.render(raw,input.operation,false,attempt.keyed));
    } catch (error) {
      await this.authorize(attempt.requirements);
      const winner = attempt.namespace ? await this.receipts.findActive(attempt.namespace) : null;
      if (winner && attempt.namespace) return this.replay(winner,attempt.namespace);
      if (error instanceof StaffReplyPreconditionConflictError) throw staleDraft();
      if (String(error).includes('operator_activity_recipient_unavailable')) throw unavailableMention();
      throw unavailable();
    }
  }
}
