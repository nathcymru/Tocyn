import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ArticleBodyFormat, ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../../types/tenant';
import type { StaffMutationOperation, StaffMutationOutcome } from '../../types/staff-ticket-mutation';
import type { BudgetAuthorityRepository } from '../../repositories/budget-authority.repository';
import type { BudgetCommitAuthority, CanonicalBudgetIntent } from '../../budgets/isolate-admission.service';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../../repositories/session-budget-authority.repository';
import { SessionBudgetAdmissionService } from '../../budgets/session-admission.service';
import { TicketEmailAdmissionRepository } from '../../repositories/ticket-email-admission.repository';

export const TICKET_EMAIL_MAX_ATTACHMENTS = 10;
export const TICKET_EMAIL_DELIVERY_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  d1RowsRead: 4_096,
  d1RowsWritten: 8,
  r2ClassBOperations: TICKET_EMAIL_MAX_ATTACHMENTS,
  logEvents: 2,
});
export function ticketEmailDeliveryEnvelope(externalProvider: boolean): Readonly<ResourceAmounts> {
  return Object.freeze({ ...TICKET_EMAIL_DELIVERY_ENVELOPE,...(externalProvider ? { externalProviderUnits:1 } : {}) });
}

export type TicketEmailCanonicalGrant = Readonly<{
  version: 1;
  sourceOperation: 'dashboard.ticket.create' | 'dashboard.ticket.reply';
  sourceAuthority: BudgetCommitAuthority;
  credential: SessionBudgetCredential;
  ticket: Readonly<{ id: string; ticketNo: number | null; subject: string; customerEmail: string; groupId: string | null; sourceEmail: string | null }>;
  article: Readonly<{ id: string; body: string; bodyFormat: ArticleBodyFormat; isInternal: false }>;
  attachments: readonly Readonly<{ id: string; fileName: string; fileSize: number; contentType: string; r2Key: string }>[];
}>;

function owned<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown) => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(clone); return clone;
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return Array.from(bytes,byte => byte.toString(16).padStart(2,'0')).join('');
}

/** Constructed only after the exact source attempt observed its winning commit. */
export function canonicalTicketEmailGrantAfterCommit(authority: BudgetCommitAuthority | undefined,
  credential: SessionBudgetCredential, operation: StaffMutationOperation, outcome: StaffMutationOutcome): TicketEmailCanonicalGrant | null {
  if (!authority?.grant || outcome.replayed || operation === 'dashboard.ticket.update' || outcome.article.is_internal
    || typeof outcome.article.body !== 'string' || !outcome.article.body_format
    || outcome.article.ticket_id !== outcome.ticket.id || outcome.attachments.length > TICKET_EMAIL_MAX_ATTACHMENTS
    || outcome.attachments.some(item => item.article_id !== outcome.article.id || !Number.isSafeInteger(item.file_size) || item.file_size < 0)) return null;
  return owned({ version:1,sourceOperation:operation,sourceAuthority:authority,credential,
    ticket:{id:outcome.ticket.id,ticketNo:Number.isSafeInteger(outcome.ticket.ticket_no) ? outcome.ticket.ticket_no : null,subject:outcome.ticket.subject,
      customerEmail:outcome.ticket.customer_email,groupId:outcome.ticket.group_id ?? null,sourceEmail:outcome.ticket.source_email ?? null},
    article:{id:outcome.article.id,body:outcome.article.body,bodyFormat:outcome.article.body_format,isInternal:false},
    attachments:outcome.attachments.map(item => ({id:item.id,fileName:item.file_name,fileSize:item.file_size,
      contentType:item.content_type,r2Key:item.r2_key})) });
}

export class TicketEmailDeliveryAdmissionService {
  private readonly repository: TicketEmailAdmissionRepository;
  private readonly sessions: SessionBudgetAuthorityRepository;
  private readonly consumed = new WeakSet<TicketEmailCanonicalGrant>();
  constructor(db: D1Database, private readonly scope: VerifiedTenantScope, private readonly budget: {
    service: SessionBudgetAdmissionService;
    repository: BudgetAuthorityRepository;
    namespace: DurableObjectNamespace;
    now: () => number;
    externalProvider: boolean;
    settle: (authority: BudgetCommitAuthority, outcome: 'committed'|'unknown', now: number) => void;
  }) { this.repository = new TicketEmailAdmissionRepository(db,scope); this.sessions = new SessionBudgetAuthorityRepository(db,scope); }

  private valid(grant: TicketEmailCanonicalGrant): boolean {
    return !this.consumed.has(grant) && grant.version === 1 && grant.credential.tenantId === this.scope.tenantId
      && grant.credential.actorId === this.scope.actorId && grant.sourceAuthority.snapshot.tenant_id === this.scope.tenantId
      && grant.article.isInternal === false && grant.attachments.length <= TICKET_EMAIL_MAX_ATTACHMENTS;
  }

  /**
   * Returns false when delivery could not obtain and durably claim current
   * authority. The canonical ticket response remains committed either way.
   */
  async deliver(grant: TicketEmailCanonicalGrant, send: () => Promise<void>): Promise<boolean> {
    if (!this.valid(grant)) return false;
    this.consumed.add(grant);
    const fingerprint = await digest(JSON.stringify([grant.version,grant.sourceOperation,grant.sourceAuthority,
      grant.ticket,grant.article,grant.attachments]));
    const intent: CanonicalBudgetIntent = { operationId:`ticket-email:${fingerprint.slice(0,64)}`,
      operationFingerprint:fingerprint,workScopeKey:`ticket-email:${grant.ticket.id}` };
    const business = ticketEmailDeliveryEnvelope(this.budget.externalProvider);
    const admission = await this.budget.service.admit({ repository:this.budget.repository,
      sessions:this.sessions,
      namespace:this.budget.namespace,scope:this.scope,credential:grant.credential,
      requirements:{ticket:{id:grant.ticket.id,groupId:grant.ticket.groupId}},intent,business,now:this.budget.now });
    const authority = admission.commitAuthority;
    if (admission.status === 'rejected' || !authority || authority.operationId !== intent.operationId
      || authority.operationFingerprint !== intent.operationFingerprint) return false;
    try {
      await this.repository.claim({credential:grant.credential,source:grant,authority});
    } catch {
      this.budget.settle(authority,'unknown',this.budget.now());
      return false;
    }
    try { await send(); this.budget.settle(authority,'committed',this.budget.now()); return true; }
    catch (error) { this.budget.settle(authority,'unknown',this.budget.now()); throw error; }
  }
}
