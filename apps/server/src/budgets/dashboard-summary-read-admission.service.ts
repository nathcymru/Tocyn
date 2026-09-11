import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { JWTPayload } from '../types';
import { staffTicketAdmissionMode, sessionTicketBudgetAdmission, apiTicketBudgetCache } from '../middleware/budget-admission.middleware';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import { DashboardSummaryReadRepository, type DashboardSummaryReadCommit, type DashboardSummaryReadOperation,
  type DashboardSummaryReadSnapshot, type DashboardSummaryReadTarget } from '../repositories/dashboard-summary-read.repository';

const FIXED_READS = 4_096;
const BYTE_UNIT = 256;

function safeAdd(...values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) return null;
    total += value;
  }
  return total;
}
function bytes(value: number): number | null { return Number.isSafeInteger(value) && value >= 0 ? Math.ceil(value / BYTE_UNIT) : null; }
function safeId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value); }
async function digest(parts: readonly unknown[]): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

/** Dynamic complete-read reservation. Metadata growth is rejected by the canonical D1 batch. */
export function dashboardSummaryReadEnvelope(operation: DashboardSummaryReadOperation, snapshot: DashboardSummaryReadSnapshot): ResourceAmounts | null {
  let variable = 0;
  if (snapshot?.kind === 'stats') variable = safeAdd(snapshot.ticketRows * 2, snapshot.userRows, snapshot.groupRows) ?? -1;
  if (snapshot?.kind === 'policy') variable = bytes(snapshot.calendarBytes) ?? -1;
  if (snapshot?.kind === 'sla') {
    variable = safeAdd(...snapshot.tickets.flatMap(ticket => [ticket.pauseRows, bytes(ticket.calendarBytes) ?? -1, bytes(ticket.handlerBytes) ?? -1])) ?? -1;
  }
  const reads = safeAdd(FIXED_READS, variable);
  if (reads === null) return null;
  return Object.freeze({ workerRequests: 1, d1RowsRead: reads, ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }) });
}

export type DashboardSummaryReadAdmission = Readonly<{ status: 'disabled' | 'admitted' | 'rejected';
  reason?: 'exhausted' | 'unavailable'; commit?: DashboardSummaryReadCommit }>;
export type DashboardSummaryReadInput = Readonly<{ env: Env; deps: TenantRequestDeps; payload: JWTPayload;
  operation: DashboardSummaryReadOperation; target: DashboardSummaryReadTarget; now: () => number }>;

function validTarget(operation: DashboardSummaryReadOperation, target: DashboardSummaryReadTarget): boolean {
  if (operation === 'dashboard.support-states.read') return Number.isInteger(target.limit) && target.limit! >= 1 && target.limit! <= 100
    && (target.cursor === null || typeof target.cursor === 'string') && typeof target.includeInactive === 'boolean';
  if (operation === 'dashboard.ticket.sla.read' || operation === 'dashboard.ticket.support-state.read' || operation === 'dashboard.ticket.reply-capability.read') return safeId(target.ticketId);
  if (operation === 'dashboard.ticket.sla-batch.read') return Array.isArray(target.ticketIds) && target.ticketIds.length >= 1 && target.ticketIds.length <= 25
    && new Set(target.ticketIds).size === target.ticketIds.length && target.ticketIds.every(safeId);
  return Object.keys(target).length === 0;
}

/** The configured path spends an exact session grant before the repository's atomic live credential, group and growth fence. */
export async function admitDashboardSummaryRead(input: DashboardSummaryReadInput): Promise<DashboardSummaryReadAdmission> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined) return { status: 'disabled' };
  if (staffTicketAdmissionMode(input.env) === 'disabled') return { status: 'disabled' };
  const sessionVersion = input.payload.session_version;
  if (staffTicketAdmissionMode(input.env) !== 'enabled' || !input.env.BUDGET_COORDINATOR_DO || input.payload.sub !== input.deps.scope.actorId
    || (input.payload.role !== 'admin' && input.payload.role !== 'agent') || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(input.payload.exp)
    || input.payload.mfa_verified !== true || !validTarget(input.operation, input.target)) return { status: 'rejected', reason: 'unavailable' };
  if (typeof sessionVersion !== 'number') return { status: 'rejected', reason: 'unavailable' };
  const credential: SessionBudgetCredential = Object.freeze({ tenantId: input.deps.scope.tenantId, actorId: input.payload.sub,
    role: input.payload.role, sessionVersion, expiresAt: input.payload.exp, mfaVerified: true });
  try {
    const reader = new DashboardSummaryReadRepository(input.deps.database, input.deps.scope);
    // Do not expose accounting populations to a revoked principal.
    if (!await new SessionBudgetAuthorityRepository(input.deps.database, input.deps.scope).authorize(credential, {}, input.now())) return { status: 'rejected', reason: 'unavailable' };
    const snapshot = await reader.snapshot(input.operation, input.target);
    const business = dashboardSummaryReadEnvelope(input.operation, snapshot);
    if (!business) return { status: 'rejected', reason: 'unavailable' };
    const requestKey = await digest(['dashboard-summary-read-v1', input.operation, input.deps.scope.tenantId, input.deps.scope.actorId, input.target, snapshot]);
    const outcome = await sessionTicketBudgetAdmission.admit({ repository: input.deps.repositories.budgetAuthority,
      sessions: new SessionBudgetAuthorityRepository(input.deps.database, input.deps.scope), namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: input.deps.scope, credential, requirements: {}, intent: { operationId: crypto.randomUUID(), operationFingerprint: requestKey,
        workScopeKey: input.operation }, business, now: input.now });
    if ((outcome.status !== 'spent' && outcome.status !== 'idempotent') || !outcome.commitAuthority) {
      return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
    }
    return { status: 'admitted', commit: Object.freeze({ operation: input.operation, requestKey, target: structuredClone(input.target), credential,
      snapshot, authority: outcome.commitAuthority }) };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}

export function settleDashboardSummaryRead(commit: DashboardSummaryReadCommit, outcome: 'committed' | 'unknown', now: number): void {
  apiTicketBudgetCache.settleOperation(commit.authority, outcome, now);
}
