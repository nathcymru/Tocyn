import type { Article, Attachment, Ticket } from './index';
import type { RequestedMutationAttachment } from './ticket-mutation-replay';
import type { SessionBudgetCredential, SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { ArticleBodyFormat } from '@luminatick/shared';

export type StaffMutationOperation = 'dashboard.ticket.create' | 'dashboard.ticket.reply';
export type AcknowledgedDraftReference = Readonly<{ generation: string; revision: number; baseConversationRevision: number }>;
/** Stored article formats share the composer contract. */
export type StaffArticleFormat = ArticleBodyFormat;
export type StaffMutationInput =
  | { operation: 'dashboard.ticket.create'; data: { subject: string; customer_email: string; body: string;
    bodyFormat?: StaffArticleFormat; status?: Ticket['status']; priority?: Ticket['priority'];
    group_id?: string | null; assigned_to?: string | null; custom_fields?: Ticket['custom_fields'] } }
  | { operation: 'dashboard.ticket.reply'; ticketId: string; data: { body: string; bodyFormat?: StaffArticleFormat;
    is_internal?: boolean; attachments?: RequestedMutationAttachment[]; draft?: AcknowledgedDraftReference } };
export type StaffMutationNamespace = Readonly<{ principalId: string; operation: StaffMutationOperation; keyHash: string; payloadHash: string }>;
export type StaffMutationOutcome = Readonly<{ status: 201; body: Record<string, unknown>; ticket: Ticket; article: Article;
  attachments: Attachment[]; replayed: boolean; keyed: boolean }>;
export type PreparedStaffMutation = Readonly<{ replay: StaffMutationOutcome | null }>;
export type StaffMutationReceipt = { payload_hash: string; fingerprint_version: number; response_version: number;
  lifecycle: 'completed' | 'gone'; result_ticket_id: string | null; result_article_id: string | null; response_snapshot: string | null };
/** Internal repository contract. A handler never supplies a commit authority. */
export type StaffMutationCommit = Readonly<{ credential: SessionBudgetCredential; requirements: SessionBudgetRequirements;
  authority: BudgetCommitAuthority; namespace?: StaffMutationNamespace }>;
