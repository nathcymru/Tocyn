import { CANONICAL_MUTATION_D1_WRITES } from '../budgets/canonical-mutation-envelope';
import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import type { Attachment, Article, Ticket } from '../types';
import type { PreparedStaffMutation, StaffMutationInput, StaffMutationNamespace, StaffMutationOutcome, StaffMutationReceipt } from '../types/staff-ticket-mutation';
import type { VerifiedMutationAttachment } from '../types/ticket-mutation-replay';
import type { CapabilityWriteFence } from '../auth/capability-policy';
import type { BudgetCommitAuthority, CanonicalBudgetIntent } from '../budgets/isolate-admission.service';
import { articleBodyFormat, type ArticleBodyFormat } from '@luminatick/shared';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential, type SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import { TicketMutationReplayRepository, type MutationCandidate } from '../repositories/ticket-mutation-replay.repository';
import { StaffTicketMutationRepository } from '../repositories/staff-ticket-mutation.repository';
import { TicketMutationError, canonicalMutationJson } from './ticket-mutation-replay.service';

const unavailable = () => new TicketMutationError(503,'staff_mutation_unavailable','Ticket mutation unavailable; retry with the same key');
const denied = () => new TicketMutationError(403,'staff_mutation_denied','Ticket mutation is not authorized');
const invalid = () => new TicketMutationError(400,'invalid_mutation','Invalid ticket mutation');
const unsupportedFormat = () => new TicketMutationError(400,'unsupported_article_format','Article format is not enabled');
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
  intent: CanonicalBudgetIntent; authority?: BudgetCommitAuthority; commitStarted: boolean };

/** Staff-only prerequisite; no dashboard handler is wired by this module. */
export class StaffTicketMutationService {
  private readonly receipts: StaffTicketMutationRepository;
  private readonly sessions: SessionBudgetAuthorityRepository;
  private readonly attempts = new WeakMap<PreparedStaffMutation,Attempt>();
  private readonly credential: SessionBudgetCredential;
  private readonly capability?: CapabilityWriteFence;
  constructor(db: D1Database, private readonly scope: VerifiedTenantScope, credential: SessionBudgetCredential,
    private readonly canonical: TicketMutationReplayRepository,
    private readonly budget: { service: SessionBudgetAdmissionService; repository: BudgetAuthorityRepository;
      namespace: DurableObjectNamespace; business: ResourceAmounts; now?: () => number }, capability?: CapabilityWriteFence) {
    this.credential = owned(credential); this.capability = capability && owned(capability);
    this.receipts = new StaffTicketMutationRepository(db,scope); this.sessions = new SessionBudgetAuthorityRepository(db,scope);
  }
  private now() { return this.budget.now?.() ?? Date.now(); }
  private async authorize(requirements: SessionBudgetRequirements): Promise<void> {
    if (!await this.sessions.authorize(this.credential,requirements,this.now())) throw denied();
  }
  private normalize(input: StaffMutationInput): StaffMutationInput {
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
    if (!Array.isArray(attachments) || attachments.length > 10 || (input.data.is_internal !== undefined && typeof input.data.is_internal !== 'boolean')) throw invalid();
    const seen = new Set<string>();
    return { operation: input.operation, ticketId: input.ticketId, data: { body: input.data.body, bodyFormat, is_internal: input.data.is_internal ?? false,
      attachments: attachments.map(a => {
        if (!a || typeof a.storageKey !== 'string' || a.storageKey.length > 1024 || !a.storageKey.startsWith(`agent-attachments/${this.credential.actorId}/`)
          || seen.has(a.storageKey) || typeof a.filename !== 'string') throw invalid();
        seen.add(a.storageKey);
        const filename = a.filename.replace(/^.*[\\/]/,'').replace(/[\r\n]/g,'');
        if (!filename || filename.length > 255) throw invalid();
        return { storageKey: a.storageKey, filename };
      }) } };
  }
  private render(raw: string, operation: StaffMutationInput['operation'], replayed: boolean, keyed: boolean): StaffMutationOutcome {
    let snapshot: { staffVersion: number; staffBodyFormat?: unknown; ticket: Ticket; article: Article; attachments: Attachment[] };
    try { snapshot = JSON.parse(raw); } catch { throw unavailable(); }
    if (snapshot.staffVersion !== 1 || !snapshot.ticket?.id || !snapshot.article?.id || !Array.isArray(snapshot.attachments)) throw unavailable();
    let bodyFormat: ArticleBodyFormat;
    try { bodyFormat = articleBodyFormat(snapshot.article.body_format); } catch { throw unavailable(); }
    // Existing plain receipts remain readable. New snapshots obtain this value
    // from the just-written canonical article, and must agree with it on replay.
    if (snapshot.staffBodyFormat !== undefined && snapshot.staffBodyFormat !== bodyFormat) throw unavailable();
    const article = { ...snapshot.article, body_format: bodyFormat, is_internal: Boolean(snapshot.article.is_internal) };
    const attachments = snapshot.attachments;
    const body = operation.endsWith('.create') ? { ...snapshot.ticket } : { ...article,
      attachments: attachments.map(a => ({ id: a.id, filename: a.file_name, size: a.file_size, contentType: a.content_type, storageKey: a.r2_key })) };
    return { status: 201,body,ticket:snapshot.ticket,article,attachments,replayed,keyed };
  }
  private async replay(receipt: StaffMutationReceipt, ns: StaffMutationNamespace): Promise<StaffMutationOutcome> {
    await this.authorize({ capability: this.capability });
    if (receipt.payload_hash !== ns.payloadHash) throw new TicketMutationError(409,'idempotency_conflict','Idempotency key was already used with a different payload');
    if (receipt.lifecycle === 'gone') throw new TicketMutationError(410,'idempotency_result_gone','The original mutation result is no longer available');
    if (receipt.fingerprint_version !== 1 || receipt.response_version !== 1 || !receipt.result_ticket_id || !receipt.result_article_id || !receipt.response_snapshot) throw unavailable();
    const ticket = await this.receipts.ticket(receipt.result_ticket_id);
    if (!ticket) throw denied();
    await this.authorize({ capability: this.capability,ticket:{id:ticket.id,groupId:ticket.group_id ?? null} });
    if (!await this.receipts.articleExists(ticket.id,receipt.result_article_id)) throw denied();
    return this.render(receipt.response_snapshot,ns.operation,true,true);
  }
  async prepare(input: StaffMutationInput, key?: string): Promise<PreparedStaffMutation> {
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
    const ns: StaffMutationNamespace | undefined = key === undefined ? undefined : { principalId:this.credential.actorId,operation:normalized.operation,keyHash:await digest(key),payloadHash };
    const receipt = ns ? await this.receipts.findActive(ns) : null;
    const prepared = Object.freeze({ replay: receipt && ns ? await this.replay(receipt,ns) : null });
    this.attempts.set(prepared,{ input:owned(normalized),namespace:ns && owned(ns),requirements:owned(requirements),commitStarted:false,
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
  async commit(prepared: PreparedStaffMutation, verified: VerifiedMutationAttachment[] = []): Promise<StaffMutationOutcome> {
    const attempt = this.attempts.get(prepared); if (!attempt) throw unavailable();
    await this.authorize(attempt.requirements);
    if (attempt.namespace) {
      const receipt = await this.receipts.findActive(attempt.namespace);
      if (receipt) return this.replay(receipt,attempt.namespace);
    }
    if (!attempt.authority || this.now() >= attempt.authority.expiresAt || attempt.commitStarted) throw unavailable();
    const input = attempt.input, now = new Date(this.now()).toISOString();
    const candidate: MutationCandidate = { ticketId:'ticketId' in input ? input.ticketId : crypto.randomUUID(),articleId:crypto.randomUUID(),
      audit:{kind:'staff',id:this.credential.actorId,source:'dashboard'},attachments:[] };
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
    if (attempt.commitStarted) throw unavailable();
    attempt.commitStarted = true;
    try {
      const raw = await this.canonical.commitStaff(candidate,{ credential:this.credential,requirements:attempt.requirements,authority:attempt.authority,namespace:attempt.namespace });
      return this.render(raw,input.operation,false,Boolean(attempt.namespace));
    } catch {
      await this.authorize(attempt.requirements);
      const winner = attempt.namespace ? await this.receipts.findActive(attempt.namespace) : null;
      if (winner && attempt.namespace) return this.replay(winner,attempt.namespace);
      throw unavailable();
    }
  }
}
