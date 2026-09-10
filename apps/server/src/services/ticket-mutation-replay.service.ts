import { BetaAdmissionError } from '../types/local-beta';
import type { LocalBetaAdmissionRepository } from '../repositories/local-beta-admission.repository';
import type { ConversationAuditReference } from '../types/conversation-audit';
import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { MutationNamespace, MutationOutcome, MutationPrincipal, MutationReceipt, MutationSnapshotV1,
  PreparedTicketMutation, TicketMutationInput, VerifiedMutationAttachment } from '../types/ticket-mutation-replay';
import { TicketMutationReplayRepository, type MutationCandidate } from '../repositories/ticket-mutation-replay.repository';
import type { RequestCanonicalMutationSli } from '../observability/request-canonical-mutation-sli';
import { projectCanonicalConversation } from './canonical-conversation.service';

export type { MutationOperation, MutationOutcome, MutationPrincipal, PreparedTicketMutation, TicketMutationInput,
  RequestedMutationAttachment, VerifiedMutationAttachment } from '../types/ticket-mutation-replay';

export class TicketMutationError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 503, public code: string, message: string) { super(message); }
}
const invalid = () => new TicketMutationError(400, 'invalid_mutation', 'Invalid ticket mutation');
const unavailable = () => new TicketMutationError(503, 'mutation_unavailable', 'Ticket mutation unavailable; retry with the same key');
const notFound = () => new TicketMutationError(404, 'not_found', 'Ticket not found');
const unauthorized = () => new TicketMutationError(401, 'unauthorized', 'Invalid or inactive credentials');

/** Deterministic semantic JSON: property order is irrelevant, array order is not. */
export function canonicalMutationJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalMutationJson).join(',')}]`;
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalMutationJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw invalid();
}
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

type Attempt = { input: TicketMutationInput; namespace?: MutationNamespace };

/**
 * Version 1 renders the fixed original-row snapshot for both first success and
 * replay. Keep this renderer AND its canonical projector compatibility-frozen
 * for live v1 receipts; changed response behavior requires a new version.
 */
export function renderMutationSnapshotV1(raw: string, operation: TicketMutationInput['operation'], replayed: boolean, keyed: boolean): MutationOutcome {
  let snapshot: MutationSnapshotV1;
  try { snapshot = JSON.parse(raw) as MutationSnapshotV1; } catch { throw unavailable(); }
  if (snapshot.version !== 1 || !snapshot.ticket?.id || !Array.isArray(snapshot.attachments)) throw unavailable();
  const ticket = snapshot.ticket;
  const article = snapshot.article ? { ...snapshot.article, is_internal: Boolean(snapshot.article.is_internal) } : null;
  let body: Record<string, unknown>;
  if (operation.endsWith('.create')) {
    const canonical = projectCanonicalConversation(ticket, article ? [{ ...article, attachments: snapshot.attachments }] : []);
    body = operation === 'api.ticket.create' ? { ...ticket, canonical } : { ticket, article, canonical };
  } else {
    if (!article) throw unavailable();
    body = operation === 'api.ticket.reply' ? { ...article } : {
      ...article,
      attachments: snapshot.attachments.map(a => ({ id: a.id, filename: a.file_name, size: a.file_size, contentType: a.content_type, storageKey: a.r2_key })),
    };
  }
  return { status: 201, body, replayed, keyed, ticketId: ticket.id, ...(article ? { articleId: article.id } : {}) };
}

/** V2 adds only immutable local event references; V1 rendering remains frozen. */
export function renderMutationSnapshotV2(raw: string, operation: TicketMutationInput['operation'], replayed: boolean, keyed: boolean): MutationOutcome {
  let snapshot: Omit<MutationSnapshotV1, 'version'> & { version: 2; audit: ConversationAuditReference[] };
  try {
    snapshot = JSON.parse(raw);
  } catch {
    throw unavailable();
  }
  const validAudit = snapshot && snapshot.version === 2 && Array.isArray(snapshot.audit)
    && snapshot.audit.length === 1 && snapshot.audit[0]
    && typeof snapshot.audit[0].eventId === 'string' && snapshot.audit[0].eventId;
  if (!validAudit) throw unavailable();
  const result = renderMutationSnapshotV1(JSON.stringify({ ...snapshot, version: 1 }), operation, replayed, keyed);
  const reference = { status: 'known', value: { eventId: snapshot.audit[0].eventId } };
  if (operation.endsWith('.create')) {
    const canonical = result.body.canonical as ReturnType<typeof projectCanonicalConversation>;
    result.body.canonical = {
      ...canonical,
      conversation: { ...canonical.conversation, audit: reference },
      messages: canonical.messages.map(message => ({ ...message, audit: reference })),
    };
  } else result.body.audit = reference;
  return result;
}
function renderMutationSnapshot(raw: string, operation: TicketMutationInput['operation'], replayed: boolean, keyed: boolean) {
  let version: unknown;
  try {
    version = (JSON.parse(raw) as { version?: unknown } | null)?.version;
  } catch {
    throw unavailable();
  }
  if (version === 1) return renderMutationSnapshotV1(raw, operation, replayed, keyed);
  if (version === 2) return renderMutationSnapshotV2(raw, operation, replayed, keyed);
  throw unavailable();
}

export class TicketMutationReplayService {
  private readonly repository: TicketMutationReplayRepository;
  private readonly attempts = new WeakMap<PreparedTicketMutation, Attempt>();

  constructor(db: D1Database, private scope: VerifiedTenantScope, private principal: MutationPrincipal, private admission?: LocalBetaAdmissionRepository, private canonicalMutationSli?: RequestCanonicalMutationSli) {
    this.repository = new TicketMutationReplayRepository(db, scope, admission, canonicalMutationSli);
  }

  private recordDenied(error: unknown): void {
    // Once D1 batch execution has begun, later authorization recovery cannot
    // turn a potentially committed mutation into a known denial.
    if (this.canonicalMutationSli?.hasAttempt()) return;
    if (error instanceof TicketMutationError && [401, 403, 404].includes(error.status)) this.canonicalMutationSli?.recordDenied();
    else if (error instanceof BetaAdmissionError && error.status >= 400 && error.status < 500) this.canonicalMutationSli?.recordDenied();
  }

  private async authorize(): Promise<string | undefined> {
    if (!this.principal.id || !this.scope.tenantId) throw unauthorized();
    await this.admission?.authorize();
    if (this.principal.kind === 'api-key') {
      const key = await this.repository.activeApiKey(this.principal.id);
      if (!key) throw unauthorized();
      if (!(key.permissions || '').split(',').map(p => p.trim()).includes('tickets:write')) {
        throw new TicketMutationError(403, 'forbidden', 'API key lacks required permission');
      }
      return undefined;
    }
    if (!Number.isSafeInteger(this.principal.expiresAt) || this.principal.expiresAt <= Date.now() / 1000 ||
      !Number.isSafeInteger(this.principal.sessionVersion) || this.principal.sessionVersion < 0) throw unauthorized();
    const user = await this.repository.currentCustomer(this.principal.id);
    if (!user || user.role !== 'customer' || user.session_version !== this.principal.sessionVersion) throw unauthorized();
    return user.email;
  }

  private async authorizeTicket(id: string, email?: string): Promise<void> {
    const ticket = await this.repository.ticketOwnership(id);
    if (!ticket || (this.principal.kind === 'customer' &&
      (ticket.customer_email !== email || (ticket.customer_id !== null && ticket.customer_id !== this.principal.id)))) throw notFound();
  }

  private normalize(input: TicketMutationInput, email?: string): TicketMutationInput {
    if ((input.operation.startsWith('api.') && this.principal.kind !== 'api-key') ||
      (input.operation.startsWith('portal.') && this.principal.kind !== 'customer')) throw unauthorized();
    const portal = input.operation.startsWith('portal.');
    if (input.operation === 'api.ticket.create' || input.operation === 'portal.ticket.create') {
      const d = input.data;
      if (typeof d.subject !== 'string' || !d.subject.trim() || (d.body !== undefined && typeof d.body !== 'string')) throw invalid();
      const customerEmail = portal ? email : d.customer_email;
      if (!customerEmail) throw invalid();
      const body = d.body?.trim() ? d.body : undefined;
      if (portal && body === undefined) throw invalid();
      // Normalize only defaults/absence that have identical persistence effects.
      return {
        operation: input.operation,
        data: {
          subject: d.subject, customer_email: customerEmail, ...(body === undefined ? {} : { body }),
          status: portal ? 'open' : d.status ?? 'open', priority: portal ? 'normal' : d.priority ?? 'normal',
          assigned_to: portal ? null : d.assigned_to ?? null, group_id: portal ? null : d.group_id ?? null,
          ...(portal || d.custom_fields == null ? {} : { custom_fields: d.custom_fields }),
        },
      };
    }
    if (input.operation !== 'api.ticket.reply' && input.operation !== 'portal.ticket.reply') throw invalid();
    if (typeof input.ticketId !== 'string' || !input.ticketId || typeof input.data.body !== 'string' || !input.data.body.trim()) throw invalid();
    const sender = portal ? 'customer' : input.data.sender_type ?? 'customer';
    const internal = portal ? false : input.data.is_internal ?? false;
    if (!['customer', 'agent', 'system'].includes(sender) || typeof internal !== 'boolean') throw invalid();
    const attachments = input.data.attachments ?? [];
    if (!Array.isArray(attachments) || attachments.length > 10 || (!portal && attachments.length)) throw invalid();
    const seen = new Set<string>();
    return {
      operation: input.operation, ticketId: input.ticketId,
      data: {
        body: input.data.body, sender_type: sender, is_internal: internal,
        attachments: attachments.map(a => {
          if (!a || typeof a.storageKey !== 'string' || typeof a.filename !== 'string' ||
            !a.storageKey.startsWith(`customer-attachments/${this.principal.id}/`) || seen.has(a.storageKey)) throw invalid();
          seen.add(a.storageKey);
          const filename = a.filename.replace(/^.*[\\/]/, '').replace(/[\r\n]/g, '');
          if (!filename || filename.length > 255) throw invalid();
          return { storageKey: a.storageKey, filename };
        }),
      },
    };
  }

  private async replay(receipt: MutationReceipt, ns: MutationNamespace, record: 'new' | 'existing' | 'none' = 'new'): Promise<MutationOutcome> {
    const email = await this.authorize();
    if (receipt.payload_hash !== ns.payloadHash) throw new TicketMutationError(409, 'idempotency_conflict', 'Idempotency key was already used with a different payload');
    if (receipt.lifecycle === 'gone') throw new TicketMutationError(410, 'idempotency_result_gone', 'The original mutation result is no longer available');
    if (![1,2].includes(receipt.response_version) || receipt.fingerprint_version !== 1 || !receipt.result_ticket_id || !receipt.response_snapshot) throw unavailable();
    await this.authorizeTicket(receipt.result_ticket_id, email);
    if (receipt.result_article_id) {
      const article = await this.repository.articleVisibility(receipt.result_article_id, receipt.result_ticket_id);
      if (!article || (this.principal.kind === 'customer' && article.is_internal)) throw notFound();
    }
    const replayed = renderMutationSnapshot(receipt.response_snapshot, ns.operation, true, true);
    if (record === 'new') this.canonicalMutationSli?.recordAttempt();
    if (record !== 'none') this.canonicalMutationSli?.recordReplayed();
    return replayed;
  }

  async prepareMutation(input: TicketMutationInput, rawIdempotencyKey?: string): Promise<PreparedTicketMutation> {
    try {
      const email = await this.authorize();
      if (rawIdempotencyKey !== undefined && !/^[A-Za-z0-9._~-]{1,128}$/.test(rawIdempotencyKey)) {
        throw new TicketMutationError(400, 'invalid_idempotency_key', 'Invalid Idempotency-Key header');
      }
      const normalized = this.normalize(input, email);
      if ('ticketId' in normalized) await this.authorizeTicket(normalized.ticketId, email);
      const serialized = canonicalMutationJson(normalized);
      // Routes bound raw bytes to 64 KiB; leave space here for derived fields.
      if (new TextEncoder().encode(serialized).byteLength > 128 * 1024) throw new TicketMutationError(413, 'payload_too_large', 'Payload too large');
      const namespace = rawIdempotencyKey === undefined ? undefined : {
        principalKind: this.principal.kind, principalId: this.principal.id, operation: normalized.operation,
        keyHash: await digest(rawIdempotencyKey), payloadHash: await digest(`ticket-mutation-v1\n${serialized}`),
      };
      let receipt = namespace ? await this.repository.findActive(namespace) : null;
      if (!receipt && this.admission) {
        try { await this.admission.authorize(normalized.operation.endsWith('.create')?'create':'conversation'); }
        catch(error) {
          // A concurrent winner can consume the final slot between lookup and the advisory check.
          receipt=namespace?await this.repository.findActive(namespace):null;
          if(!receipt)throw error;
        }
      }
      const prepared = Object.freeze({ replay: receipt && namespace ? await this.replay(receipt, namespace) : null });
      // Hold an owned copy: validated request objects cannot drift after hashing.
      this.attempts.set(prepared, { input: JSON.parse(serialized) as TicketMutationInput, namespace });
      return prepared;
    } catch (error) {
      this.recordDenied(error);
      if (error instanceof TicketMutationError || error instanceof BetaAdmissionError) throw error;
      throw unavailable();
    }
  }

  async commit(prepared: PreparedTicketMutation, verifiedAttachments: VerifiedMutationAttachment[] = []): Promise<MutationOutcome> {
    const attempt = this.attempts.get(prepared);
    if (!attempt) throw unavailable();
    if (prepared.replay) {
      // Even a caller that invokes commit after lookup must recheck authority.
      const current = attempt.namespace ? await this.repository.findActive(attempt.namespace) : null;
      if (!current || !attempt.namespace) throw unavailable();
      return this.replay(current, attempt.namespace, 'none');
    }
    try {
      const email = await this.authorize();
      const input = attempt.input;
      if ('ticketId' in input) await this.authorizeTicket(input.ticketId, email);
      // Another request may have completed while CAPTCHA/R2 guards ran.
      if (attempt.namespace) {
        const current = await this.repository.findActive(attempt.namespace);
        if (current) {
          return await this.replay(current, attempt.namespace);
        }
      }
      const observedAt = new Date().toISOString();
      const portal = input.operation.startsWith('portal.');
      const source = portal ? 'portal' : 'api';
      const candidate: MutationCandidate = { audit:{kind:this.principal.kind,id:this.principal.id,source}, ticketId: 'ticketId' in input ? input.ticketId : crypto.randomUUID(), attachments: [] };
      if (!('ticketId' in input)) {
        if (portal && input.data.customer_email !== email) throw unauthorized();
        candidate.ticket = {
          subject: input.data.subject, customer_email: input.data.customer_email!,
          customer_id: portal ? this.principal.id : null, source,
          status: input.data.status ?? 'open', priority: input.data.priority ?? 'normal',
          assigned_to: input.data.assigned_to, group_id: input.data.group_id, custom_fields: input.data.custom_fields,
          intake_received_at: observedAt, intake_processed_at: observedAt,
        };
        if (input.data.body !== undefined) candidate.article = {
          sender_type: 'customer', sender_id: portal ? this.principal.id : undefined, body: input.data.body,
          is_internal: false, intake_source: source, received_at: observedAt, processed_at: observedAt,
        };
        if (verifiedAttachments.length) throw invalid();
      } else {
        candidate.article = { sender_type: input.data.sender_type ?? 'customer', sender_id: portal ? this.principal.id : undefined,
          body: input.data.body, is_internal: input.data.is_internal ?? false,
          intake_source: source, received_at: observedAt, processed_at: observedAt };
        const requested = input.data.attachments ?? [];
        if (requested.length !== verifiedAttachments.length) throw invalid();
        candidate.attachments = verifiedAttachments.map((a, index) => {
          if (a.storageKey !== requested[index].storageKey || a.filename !== requested[index].filename ||
            !Number.isSafeInteger(a.size) || a.size < 0 || a.size > 10 * 1024 * 1024 ||
            !['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain','text/csv'].includes(a.contentType)) throw invalid();
          return { ...a, id: crypto.randomUUID() };
        });
      }
      if (candidate.article) candidate.articleId = crypto.randomUUID();
      try {
        const snapshot = await this.repository.commit(candidate, attempt.namespace);
        return renderMutationSnapshot(snapshot, input.operation, false, Boolean(attempt.namespace));
      } catch {
        // A unique receipt collision rolls back all losing writes. Only an
        // authoritative committed receipt can establish a replay/conflict.
        await this.authorize();
        const winner = attempt.namespace ? await this.repository.findActive(attempt.namespace) : null;
        if (winner && attempt.namespace) return await this.replay(winner, attempt.namespace, 'existing');
        await this.admission?.authorize(candidate.ticket?'create':'conversation');
        this.canonicalMutationSli?.recordUncertain();
        throw unavailable();
      }
    } catch (error) {
      this.recordDenied(error);
      if (error instanceof TicketMutationError || error instanceof BetaAdmissionError) throw error;
      throw unavailable();
    }
  }
}
