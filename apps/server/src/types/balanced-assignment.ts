import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { SessionBudgetCredential, SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
export const BALANCED_ASSIGNMENT_CANDIDATES = 64;
export type BalancedAssignmentCommit = Readonly<{
  ticketId: string;
  operationId: string;
  keyHash: string;
  payloadHash: string;
  credential: SessionBudgetCredential;
  requirements: SessionBudgetRequirements;
  authority: BudgetCommitAuthority;
}>;
export type BalancedAssignmentDecision = Readonly<{
  groupId: string | null;
  candidateCount: number;
  unsupportedPool: number;
  ownerId: string | null;
  sequence: number;
  policyRevision: number | null;
}>;
export type BalancedAssignmentOutcome = Readonly<{
  outcome: 'assigned' | 'no_capacity';
  ownerId: string | null;
  sequence: number;
  replayed: boolean;
}>;
export class BalancedAssignmentError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 410 | 503, readonly code: string) { super(code); }
}
export async function balancedAssignmentFingerprint(tenantId: string, actorId: string, ticketId: string, keyHash: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['balanced-v1', tenantId, actorId, ticketId, keyHash])));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
