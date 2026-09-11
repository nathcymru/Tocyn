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
import { TicketMutationReplayRepository, StaffReplyPreconditionConflictError, type MutationCandidate } from '../repositories/ticket-mutation-replay.repository';
import { StaffTicketMutationRepository } from '../repositories/staff-ticket-mutation.repository';
import type { OperatorActivityService } from './operator-activity.service';
import { TicketMutationError, canonicalMutationJson } from './ticket-mutation-replay.service';
import { canonicalBroadcastGrantAfterCommit, type CanonicalBroadcastGrant } from '../budgets/realtime-admission.service';

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
  broadcastGrant?: CanonicalBroadcastGrant };
