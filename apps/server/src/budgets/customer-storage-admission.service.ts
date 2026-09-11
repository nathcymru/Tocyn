import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { CustomerCurrentCredentialRepository, type CustomerBudgetCredential } from '../repositories/customer-current-credential.repository';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, customerTicketAdmissionMode } from '../middleware/budget-admission.middleware';

export type CustomerAttachmentBudgetOperation = 'customer.attachment.upload' | 'customer.attachment.download';

/**
 * Two HTTP attempts are prepaid. An upload permits two conditional Class-A
 * writes and four metadata reads: existing marker, conditional-race recovery,
 * then the same bounded sequence after a lost HTTP response. The 1,536 reads
 * cover the cold-authority refresh and the customer credential recheck.
 * Uploads additionally reserve 1,024 for bounded beta guard/attempt composition.
 * Two atomic upload charges write one rowid assertion and one unindexed counter
 * each: four D1 writes total, verified by native metadata and index inventory.
 */
export function customerAttachmentEnvelope(operation: CustomerAttachmentBudgetOperation, bytes = 0): ResourceAmounts | null {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null;
  const diagnostics = estimateDiagnosticEnvelope({ httpRequests: 2, canonicalMutationRequests: 0 });
  if (operation === 'customer.attachment.upload') return Object.freeze({ workerRequests: 2, d1RowsRead: 2_560, d1RowsWritten: 4,
    r2StorageBytes: bytes, r2ClassAOperations: 2, r2ClassBOperations: 4, ...diagnostics });
  if (operation === 'customer.attachment.download') return Object.freeze({ workerRequests: 2, d1RowsRead: 1_538,
    r2ClassBOperations: 2, ...diagnostics });
  return null;
}

type AdmissionInput = Readonly<{
  env: Env;
  deps: TenantRequestDeps;
  payload: Readonly<{ sub?: unknown; tenant_id?: unknown; role?: unknown; session_version?: unknown; exp?: unknown; email?: unknown }>;
  operation: CustomerAttachmentBudgetOperation;
  operationId: string;
  operationFingerprint: string;
  bytes?: number;
  now: () => number;
}>;

export type CustomerAttachmentAdmission = Readonly<{ status: 'disabled' | 'admitted' | 'rejected'; reason?: 'exhausted' | 'conflict' | 'unavailable' }>;

function safeIdentity(value: string): boolean {
  return value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Customer storage has no MFA condition; live customer role/session/email remains mandatory. */
export async function admitCustomerAttachment(input: AdmissionInput): Promise<CustomerAttachmentAdmission> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined) return { status: 'disabled' };
  const mode = customerTicketAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode === 'invalid' || !input.env.BUDGET_COORDINATOR_DO || !safeIdentity(input.operationId) || !safeIdentity(input.operationFingerprint)) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const { payload, deps } = input;
  if (payload.role !== 'customer' || typeof payload.sub !== 'string' || payload.sub !== deps.scope.actorId
    || payload.tenant_id !== deps.scope.tenantId || typeof payload.email !== 'string' || typeof payload.session_version !== 'number'
    || typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.session_version) || !Number.isSafeInteger(payload.exp)) return { status: 'rejected', reason: 'unavailable' };
  const business = customerAttachmentEnvelope(input.operation, input.bytes ?? 0);
  if (!business) return { status: 'rejected', reason: 'unavailable' };
  const credential: CustomerBudgetCredential = { tenantId: deps.scope.tenantId, actorId: payload.sub, role: 'customer',
    sessionVersion: payload.session_version, expiresAt: payload.exp, email: payload.email };
  try {
    const result = await apiTicketBudgetCache.admit({ repository: deps.repositories.budgetAuthority, namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: deps.scope, credentialKey: `customer-storage:${deps.scope.tenantId}:${payload.sub}`,
      intent: { operationId: input.operationId, operationFingerprint: input.operationFingerprint, workScopeKey: `customer-attachment:${input.operation}` },
      business, now: input.now,
      authorization: { authorize: scope => scope.tenantId === deps.scope.tenantId && scope.actorId === deps.scope.actorId
        ? new CustomerCurrentCredentialRepository(deps.database, deps.scope).authorize(credential, {}, input.now()) : Promise.resolve(null) },
    });
    if (result.status === 'spent' || result.status === 'idempotent') return { status: 'admitted' };
    return { status: 'rejected', reason: result.reason === 'exhausted' || result.reason === 'capacity-exhausted' ? 'exhausted'
      : result.reason === 'replay-conflict' ? 'conflict' : 'unavailable' };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
