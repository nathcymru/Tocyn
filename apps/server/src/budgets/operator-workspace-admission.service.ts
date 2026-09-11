import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { JWTPayload } from '../types';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import type { OperatorWorkspaceCommit, WorkspaceAdmissionOperation } from '../repositories/operator-workspace.repository';

export type { WorkspaceAdmissionOperation } from '../repositories/operator-workspace.repository';

export type WorkspaceAdmission = Readonly<{ status: 'disabled' } | { status: 'admitted'; commit: OperatorWorkspaceCommit }
  | { status: 'rejected'; reason: 'exhausted'|'unavailable' }>;
const READ: ResourceAmounts = Object.freeze({ workerRequests: 1, d1RowsRead: 2_560, ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }) });
const WRITE: ResourceAmounts = Object.freeze({ workerRequests: 1, d1RowsRead: 4_096, d1RowsWritten: 1_024, ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }) });
const DRAFT_LIST_READS_PER_POPULATION_ROW = 8;
export const OPERATOR_WORKSPACE_ENVELOPES: Readonly<Record<WorkspaceAdmissionOperation, Readonly<ResourceAmounts>>> = Object.freeze({
  'workspace.state.read': Object.freeze({ ...READ, d1RowsWritten: 4 }),
  'workspace.state.write': WRITE,
  'workspace.theme.read': READ,
  'workspace.theme.write': WRITE,
  'workspace.presentation.read': READ,
  'workspace.presentation.write': WRITE,
  'workspace.drafts.list': Object.freeze({ ...READ, d1RowsWritten: 256 }),
  'workspace.draft.read': Object.freeze({ ...READ, d1RowsWritten: 256 }),
  'workspace.draft.write': Object.freeze({ ...WRITE, r2ClassBOperations: 10 }),
  'workspace.draft.rebase': WRITE,
  'workspace.draft.delete': WRITE,
});
export function operatorWorkspaceEnvelope(operation: WorkspaceAdmissionOperation, draftPopulation?: number): Readonly<ResourceAmounts> {
  const envelope = OPERATOR_WORKSPACE_ENVELOPES[operation];
  if (operation !== 'workspace.drafts.list') return envelope;
  if (!Number.isSafeInteger(draftPopulation) || draftPopulation! < 0) throw new Error('Invalid operator draft population');
  const d1RowsRead = (envelope.d1RowsRead ?? 0) + draftPopulation! * DRAFT_LIST_READS_PER_POPULATION_ROW;
  if (!Number.isSafeInteger(d1RowsRead)) throw new Error('Operator draft population exceeds a safe reservation');
  return Object.freeze({ ...envelope, d1RowsRead });
}
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
    const requirements = input.ticketId ? { readTicketId: input.ticketId } : {};
    if (!await sessions.authorize(credential, requirements, input.now())) return { status: 'rejected', reason: 'unavailable' };
    const draftPopulation = input.operation === 'workspace.drafts.list'
      ? await input.deps.repositories.operatorWorkspace.getDraftPopulation()
      : undefined;
    const operationId = crypto.randomUUID();
    const operationFingerprint = await hash(['workspace-v3',input.operation,input.deps.scope.tenantId,input.deps.scope.actorId,input.ticketId ?? null,draftPopulation ?? null]);
    const outcome = await sessionTicketBudgetAdmission.admit({ repository: input.deps.repositories.budgetAuthority, sessions, namespace: input.env.BUDGET_COORDINATOR_DO, scope: input.deps.scope, credential,
      requirements, intent: { operationId, operationFingerprint, workScopeKey: input.operation },
      business: operatorWorkspaceEnvelope(input.operation, draftPopulation), now: input.now });
    if ((outcome.status === 'spent' || outcome.status === 'idempotent') && outcome.commitAuthority
      && outcome.commitAuthority.operationId === operationId && outcome.commitAuthority.operationFingerprint === operationFingerprint) {
      return { status: 'admitted', commit: structuredClone({ operation: input.operation, ...(input.ticketId ? { ticketId: input.ticketId } : {}),
        ...(draftPopulation === undefined ? {} : { draftPopulation }), credential, authority: outcome.commitAuthority }) };
    }
    return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
