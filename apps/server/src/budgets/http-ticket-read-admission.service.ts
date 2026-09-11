import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { JWTPayload } from '../types';
import { CustomerCurrentCredentialRepository, type CustomerBudgetCredential } from '../repositories/customer-current-credential.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import { apiTicketBudgetCache, customerTicketAdmissionMode, sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export type HttpTicketReadOperation = 'dashboard.ticket.detail' | 'dashboard.ticket.history' | 'portal.ticket.detail' | 'portal.ticket.history';

/**
 * A page has at most fifty conversation records. The remainder covers one
 * live credential/ownership or credential/group check and the bounded page
 * projections. Coordinator allocation work is reserved independently.
 */
export const HTTP_TICKET_READ_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1,
  d1RowsRead: 2_560,
  ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }),
});

export type HttpTicketReadAdmission = Readonly<{ status: 'disabled' | 'admitted' | 'rejected'; reason?: 'exhausted' | 'unavailable' }>;

type AdmissionInput = Readonly<{
  env: Env;
  deps: TenantRequestDeps;
  payload: JWTPayload;
  operation: HttpTicketReadOperation;
  ticketId: string;
  page: Readonly<{ limit?: string; cursor?: string }>;
  now: () => number;
}>;

function safeIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function digest(parts: readonly unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
}

function rejected(outcome: { status: string; reason?: string }): HttpTicketReadAdmission {
  if (outcome.status === 'spent' || outcome.status === 'idempotent') return { status: 'admitted' };
  return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
}

/**
 * Admission is the ticket visibility boundary for the four owned HTTP reads.
 * It rechecks current credentials and target authority before the handlers can
 * resolve ticket/article/history business data. A deliberately disabled policy
 * keeps the established beta-compatible route implementation.
 */
export async function admitHttpTicketRead(input: AdmissionInput): Promise<HttpTicketReadAdmission> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined) return { status: 'disabled' };
  const staff = input.operation.startsWith('dashboard.');
  const mode = staff ? staffTicketAdmissionMode(input.env) : customerTicketAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode !== 'enabled' || !input.env.BUDGET_COORDINATOR_DO || !safeIdentity(input.ticketId)
    || !safeIdentity(input.deps.scope.tenantId) || input.payload.sub !== input.deps.scope.actorId) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const fingerprint = await digest(['http-ticket-read-v1', input.operation, input.deps.scope.tenantId,
    input.deps.scope.actorId, input.ticketId, input.page.limit ?? null, input.page.cursor ?? null]);
  try {
    if (staff) {
      const sessionVersion = input.payload.session_version;
      if ((input.payload.role !== 'admin' && input.payload.role !== 'agent') || typeof sessionVersion !== 'number'
        || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(input.payload.exp) || input.payload.mfa_verified !== true) {
        return { status: 'rejected', reason: 'unavailable' };
      }
      const credential: SessionBudgetCredential = { tenantId: input.deps.scope.tenantId, actorId: input.payload.sub,
        role: input.payload.role, sessionVersion, expiresAt: input.payload.exp, mfaVerified: true };
      return rejected(await sessionTicketBudgetAdmission.admit({ repository: input.deps.repositories.budgetAuthority,
        sessions: new SessionBudgetAuthorityRepository(input.deps.database, input.deps.scope), namespace: input.env.BUDGET_COORDINATOR_DO,
        scope: input.deps.scope, credential, requirements: { readTicketId: input.ticketId },
        intent: { operationId: crypto.randomUUID(), operationFingerprint: fingerprint, workScopeKey: input.operation },
        business: HTTP_TICKET_READ_ENVELOPE, now: input.now }));
    }
    const sessionVersion = input.payload.session_version;
    const email = input.payload.email;
    if (input.payload.role !== 'customer' || typeof sessionVersion !== 'number' || !Number.isSafeInteger(sessionVersion)
      || !Number.isSafeInteger(input.payload.exp) || !safeIdentity(email)) return { status: 'rejected', reason: 'unavailable' };
    const credential: CustomerBudgetCredential = { tenantId: input.deps.scope.tenantId, actorId: input.payload.sub,
      role: 'customer', sessionVersion, expiresAt: input.payload.exp, email };
    return rejected(await apiTicketBudgetCache.admit({ repository: input.deps.repositories.budgetAuthority,
      namespace: input.env.BUDGET_COORDINATOR_DO, scope: input.deps.scope,
      credentialKey: `customer-read:${input.deps.scope.tenantId}:${input.payload.sub}`,
      intent: { operationId: crypto.randomUUID(), operationFingerprint: fingerprint, workScopeKey: input.operation },
      business: HTTP_TICKET_READ_ENVELOPE, now: input.now,
      authorization: { authorize: scope => scope.tenantId === input.deps.scope.tenantId && scope.actorId === input.deps.scope.actorId
        ? new CustomerCurrentCredentialRepository(input.deps.database, input.deps.scope).authorize(credential, { readTicketId: input.ticketId }, input.now())
        : Promise.resolve(null) },
    }));
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
