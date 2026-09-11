import type { Article, Attachment, Ticket } from './index';
import type { RequestedMutationAttachment } from './ticket-mutation-replay';
import type { SessionBudgetCredential, SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { ArticleBodyFormat } from '@luminatick/shared';
import type { AuditedTicketUpdate } from './conversation-audit';

export type StaffMutationOperation = 'dashboard.ticket.create' | 'dashboard.ticket.reply' | 'dashboard.ticket.update';
export type AcknowledgedDraftReference = Readonly<{ generation: string; revision: number; baseConversationRevision: number }>;
/** Stored article formats share the composer contract. */
export type StaffArticleFormat = ArticleBodyFormat;
export type StaffMutationInput =
  | { operation: 'dashboard.ticket.create'; data: { subject: string; customer_email: string; body: string;
    bodyFormat?: StaffArticleFormat; status?: Ticket['status']; priority?: Ticket['priority'];
    group_id?: string | null; assigned_to?: string | null; custom_fields?: Ticket['custom_fields'] } }
  | { operation: 'dashboard.ticket.reply'; ticketId: string; data: { body: string; bodyFormat?: StaffArticleFormat;
    is_internal?: boolean; attachments?: RequestedMutationAttachment[]; mentionedUserIds?: readonly string[]; draft?: AcknowledgedDraftReference } }
  | { operation: 'dashboard.ticket.update'; ticketId: string; data: AuditedTicketUpdate & {
    /** Internal marker for the narrow #137 responsible-owner transition. */
    responsibleOwnerAssignment?: true;
    /** The owner observed by the dashboard before requesting the transition. */
    expectedAssignedTo?: string | null;
    /** An administrator's explicit, audited exception to a hard work ceiling. */
    capacityOverride?: true;
    /** Server-selected, balanced routing for an unassigned active ticket. */
    routingSelection?: true;
  } };
export type StaffMutationNamespace = Readonly<{ principalId: string; operation: StaffMutationOperation; keyHash: string; payloadHash: string }>;
export type StaffMutationOutcome = Readonly<{ status: 200 | 201; body: Record<string, unknown>; ticket: Ticket; article: Article;
  attachments: Attachment[]; replayed: boolean; keyed: boolean }>;
export type PreparedStaffMutation = Readonly<{ replay: StaffMutationOutcome | null }>;
export type StaffMutationReceipt = { payload_hash: string; fingerprint_version: number; response_version: number;
  lifecycle: 'completed' | 'gone'; result_ticket_id: string | null; result_article_id: string | null;
  response_status: 200 | 201; response_snapshot: string | null };
/** Internal repository contract. A handler never supplies a commit authority. */
export type StaffMutationCommit = Readonly<{ credential: SessionBudgetCredential; requirements: SessionBudgetRequirements;
  authority: BudgetCommitAuthority; namespace?: StaffMutationNamespace;
  /** Rechecked in the same D1 batch as an explicit responsible-owner change. */
  responsibleOwner?: Readonly<{ ticketId: string; ownerId: string | null; capacityOverride: boolean }>;
  /** The candidate came from the tenant-scoped queue, never from the request body. */
  routingSelection?: Readonly<{ ticketId: string; ownerId: string }> }>;
