import type { CapabilityWriteFence } from '../auth/capability-policy';
import type { SessionBudgetCredential, SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import type { BudgetCommitAuthority, CanonicalBudgetIntent } from '../budgets/isolate-admission.service';

export type SupportSlaMutationOperation =
  | 'dashboard.sla.policy.set'
  | 'dashboard.support-state.create'
  | 'dashboard.support-state.update'
  | 'dashboard.support-state.deactivate'
  | 'dashboard.ticket.sla.initialize'
  | 'dashboard.ticket.support-state.transition';

export type SupportSlaMutationNamespace = Readonly<{
  principalId: string; operation: SupportSlaMutationOperation; keyHash: string; payloadHash: string; ticketId?: string;
}>;

export type SupportSlaMutationReceipt = Readonly<{
  payload_hash: string; lifecycle: 'completed' | 'gone'; response_status: 200 | 201; response_snapshot: string | null;
}>;

export type SupportSlaMutationOutcome = Readonly<{ status: 200 | 201; body: unknown }>
export type PreparedSupportSlaMutation = Readonly<{ replay: SupportSlaMutationOutcome | null }>;
export type SupportSlaMutationCommit = Readonly<{
  credential: SessionBudgetCredential; requirements: SessionBudgetRequirements; authority: BudgetCommitAuthority;
  namespace: SupportSlaMutationNamespace;
}>;
export type SupportSlaMutationInput = Readonly<{
  operation: SupportSlaMutationOperation; payload: unknown; ticketId?: string; capability?: CapabilityWriteFence;
}>;
export type SupportSlaMutationAttempt = Readonly<{
  input: SupportSlaMutationInput; namespace: SupportSlaMutationNamespace; requirements: SessionBudgetRequirements;
  intent: CanonicalBudgetIntent;
}>;
