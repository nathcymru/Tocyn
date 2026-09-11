import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { JWTPayload } from '../types';
import { sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';

export type DashboardAttachmentBudgetOperation = 'dashboard.attachment.upload' | 'dashboard.attachment.download';

/**
 * Conservative per-operation envelopes, in addition to the prepaid isolate
 * credential/authority controls. Upload reserves two Class-A attempts and two
 * metadata reads per attempt: a lost response can retry one conditional write, while an
 * ambiguous R2 result remains charged. `r2StorageBytes` is a workload guard,
 * not a claim about R2's average-peak billing.
 * Both permitted HTTP attempts are prepaid. An extra 1,536 D1 reads cover
 * the authority refresh after a cold grant; two cover attachment metadata.
 */
export function dashboardAttachmentEnvelope(operation: DashboardAttachmentBudgetOperation, bytes = 0): ResourceAmounts | null {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null;
  const diagnostics = estimateDiagnosticEnvelope({ httpRequests: 2, canonicalMutationRequests: 0 });
  if (operation === 'dashboard.attachment.upload') {
    return Object.freeze({ workerRequests: 2, d1RowsRead: 1_538, r2StorageBytes: bytes,
      r2ClassAOperations: 2, r2ClassBOperations: 4, ...diagnostics });
  }
  if (operation === 'dashboard.attachment.download') {
    return Object.freeze({ workerRequests: 2, d1RowsRead: 1_538, r2ClassBOperations: 2, ...diagnostics });
  }
  return null;
}

type AdmissionInput = Readonly<{
  env: Env;
  deps: TenantRequestDeps;
  payload: JWTPayload;
  operation: DashboardAttachmentBudgetOperation;
  /** Bounded server-derived identity. Do not pass raw request content here. */
  operationId: string;
  /** Bounded digest of the selected storage work, including a retry identity where available. */
  operationFingerprint: string;
  bytes?: number;
  now: () => number;
}>;

export type DashboardAttachmentAdmission = Readonly<{
  status: 'disabled' | 'admitted' | 'rejected';
  reason?: 'exhausted' | 'conflict' | 'unavailable';
}>;

function safeIdentity(value: string): boolean {
  return value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Dashboard storage uses the already-configured combined policy. This keeps
 * `off` and API-only deployments on their documented legacy paths, while a
 * malformed policy fails closed before an R2 operation.
 */
export async function admitDashboardAttachment(input: AdmissionInput): Promise<DashboardAttachmentAdmission> {
  // Older deployments predate the optional binding entirely. Their attachment
  // contract remains the legacy path; an explicitly malformed value is still
  // an admission failure and never reaches R2.
  if (input.env.BUDGET_ADMISSION_POLICY === undefined) return { status: 'disabled' };
  const mode = staffTicketAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode === 'invalid' || !input.env.BUDGET_COORDINATOR_DO || !safeIdentity(input.operationId) || !safeIdentity(input.operationFingerprint)) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const payload = input.payload;
  const sessionVersion = payload.session_version;
  if ((payload.role !== 'admin' && payload.role !== 'agent') || typeof sessionVersion !== 'number' || !Number.isSafeInteger(sessionVersion)
    || !Number.isSafeInteger(payload.exp) || payload.mfa_verified !== true || payload.sub !== input.deps.scope.actorId) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const business = dashboardAttachmentEnvelope(input.operation, input.bytes ?? 0);
  if (!business) return { status: 'rejected', reason: 'unavailable' };
  const credential: SessionBudgetCredential = {
    tenantId: input.deps.scope.tenantId, actorId: payload.sub, role: payload.role,
    sessionVersion, expiresAt: payload.exp, mfaVerified: payload.mfa_verified,
  };
  try {
    const outcome = await sessionTicketBudgetAdmission.admit({
      repository: input.deps.repositories.budgetAuthority,
      sessions: new SessionBudgetAuthorityRepository(input.deps.database, input.deps.scope),
      namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: input.deps.scope,
      credential,
      // The authenticated dashboard route and tenant-scoped attachment lookup
      // establish route/object authority before this budget spend. There is no
      // canonical mutation receipt to pretend that an R2 call is reversible.
      requirements: {},
      intent: { operationId: input.operationId, operationFingerprint: input.operationFingerprint,
        workScopeKey: `dashboard-attachment:${input.operation}` },
      business,
      now: input.now,
    });
    if (outcome.status === 'spent' || outcome.status === 'idempotent') return { status: 'admitted' };
    return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted'
      : outcome.reason === 'replay-conflict' ? 'conflict' : 'unavailable' };
  } catch {
    return { status: 'rejected', reason: 'unavailable' };
  }
}
