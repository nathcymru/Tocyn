import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { JWTPayload } from '../types';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export type WorkspaceAdmissionOperation = 'workspace.state.read'|'workspace.state.write'|'workspace.theme.read'|'workspace.theme.write'|'workspace.drafts.list'|'workspace.draft.read'|'workspace.draft.write'|'workspace.draft.rebase'|'workspace.draft.delete';
export type WorkspaceAdmission = Readonly<{ status: 'disabled'|'admitted'|'rejected'; reason?: 'exhausted'|'unavailable' }>;
const READ: ResourceAmounts = Object.freeze({ workerRequests: 1, d1RowsRead: 2_560, ...estimateDiagnosticEnvelope({ httpRequests: 1 }) });
const WRITE: ResourceAmounts = Object.freeze({ workerRequests: 1, d1RowsRead: 4_096, d1RowsWritten: 1_024, ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }) });
function valid(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
async function hash(parts: readonly unknown[]) { const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts))); return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join(''); }

/** Current session admission precedes every cleanup, attachment, draft, or state operation. */
export async function admitOperatorWorkspace(input: { env: Env; deps: TenantRequestDeps; payload: JWTPayload; operation: WorkspaceAdmissionOperation; ticketId?: string; now: () => number }): Promise<WorkspaceAdmission> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined || staffTicketAdmissionMode(input.env) === 'disabled') return { status: 'disabled' };
  if (staffTicketAdmissionMode(input.env) !== 'enabled' || !input.env.BUDGET_COORDINATOR_DO || !valid(input.deps.scope.tenantId) || input.payload.sub !== input.deps.scope.actorId || (input.ticketId !== undefined && !valid(input.ticketId))) return { status: 'rejected', reason: 'unavailable' };
  const version = input.payload.session_version;
  if ((input.payload.role !== 'admin' && input.payload.role !== 'agent') || !Number.isSafeInteger(version) || !Number.isSafeInteger(input.payload.exp) || input.payload.mfa_verified !== true) return { status: 'rejected', reason: 'unavailable' };
  const credential: SessionBudgetCredential = { tenantId: input.deps.scope.tenantId, actorId: input.payload.sub, role: input.payload.role, sessionVersion: version!, expiresAt: input.payload.exp, mfaVerified: true };
  try {
    const sessions = new SessionBudgetAuthorityRepository(input.deps.database, input.deps.scope);
    if (!await sessions.authorize(credential, input.ticketId ? { readTicketId: input.ticketId } : {}, input.now())) return { status: 'rejected', reason: 'unavailable' };
    const outcome = await sessionTicketBudgetAdmission.admit({ repository: input.deps.repositories.budgetAuthority, sessions, namespace: input.env.BUDGET_COORDINATOR_DO, scope: input.deps.scope, credential,
      requirements: input.ticketId ? { readTicketId: input.ticketId } : {}, intent: { operationId: crypto.randomUUID(), operationFingerprint: await hash(['workspace-v1',input.operation,input.deps.scope.tenantId,input.deps.scope.actorId,input.ticketId ?? null]), workScopeKey: input.operation },
      business: input.operation.endsWith('.read') || input.operation === 'workspace.drafts.list' ? READ : WRITE, now: input.now });
    return outcome.status === 'spent' || outcome.status === 'idempotent' ? { status: 'admitted' } : { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
