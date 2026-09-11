import type { BudgetPurpose, ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { BudgetAuthorityPrincipal } from '../repositories/budget-authority.repository';
import { IsolateBudgetAdmissionCache, type BudgetCommitAuthority } from './isolate-admission.service';
import type { CustomerAuthBudgetFence } from '../repositories/customer-auth-budget-fence';

export type CustomerAuthOperation = 'request' | 'verify' | 'logout' | 'session' | 'mfa.disable';
const cache = new IsolateBudgetAdmissionCache();
export const CUSTOMER_AUTH_ENVELOPES: Readonly<Record<CustomerAuthOperation, Readonly<ResourceAmounts>>> = Object.freeze({
  request: Object.freeze({ workerRequests: 1, d1RowsRead: 3_072, d1RowsWritten: 32, doRequests: 8, doRowsRead: 8, doRowsWritten: 8, logEvents: 67 }),
  verify: Object.freeze({ workerRequests: 1, d1RowsRead: 3_072, d1RowsWritten: 24, doRequests: 8, doRowsRead: 8, doRowsWritten: 8, logEvents: 67 }),
  logout: Object.freeze({ workerRequests: 1, d1RowsRead: 3_072, d1RowsWritten: 8, doRequests: 8, doRowsRead: 8, doRowsWritten: 8, logEvents: 67 }),
  // Disabling customer MFA is a session-recovery mutation. Its authority is
  // carried into the exact user update so a stale session cannot lower MFA.
  'mfa.disable': Object.freeze({ workerRequests: 1, d1RowsRead: 3_072, d1RowsWritten: 8, doRequests: 8, doRowsRead: 8, doRowsWritten: 8, logEvents: 67 }),
  // Current-session lookup also persists the exact admission fence and grant link.
  session: Object.freeze({ workerRequests: 1, d1RowsRead: 3_072, d1RowsWritten: 8, doRequests: 8, doRowsRead: 8, doRowsWritten: 8, logEvents: 67 }),
});

export type CustomerAuthAdmission = Readonly<{ authority: BudgetCommitAuthority; fence: CustomerAuthBudgetFence;
  settle: (outcome: 'committed' | 'unknown') => void }>;

export async function admitCustomerAuthEffect(input: { env: Env; deps: TenantRequestDeps; operation: CustomerAuthOperation;
  principal: BudgetAuthorityPrincipal; credentialKey: string; now?: () => number }): Promise<Readonly<{
    status: 'disabled' | 'admitted' | 'rejected'; reason?: 'exhausted' | 'unavailable'; admission?: CustomerAuthAdmission;
  }>> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined || input.env.BUDGET_ADMISSION_POLICY === 'off') return { status: 'disabled' };
  if (input.env.BUDGET_ADMISSION_POLICY !== 'ticket-mutations-v1' || !input.env.BUDGET_COORDINATOR_DO) return { status: 'rejected', reason: 'unavailable' };
  const now = input.now ?? Date.now;
  const purpose: BudgetPurpose = input.operation === 'request' || input.operation === 'session' ? 'new-work' : 'recovery';
  const operationId = crypto.randomUUID();
  const outcome = await cache.admit({ repository: input.deps.repositories.budgetAuthority, namespace: input.env.BUDGET_COORDINATOR_DO,
    authorization: { authorize: async () => input.principal }, scope: input.deps.scope, credentialKey: input.credentialKey,
    intent: { operationId, operationFingerprint: `${input.operation}:${operationId}`, workScopeKey: `customer.auth.${input.operation}` },
    business: CUSTOMER_AUTH_ENVELOPES[input.operation], purpose, now });
  return (outcome.status === 'spent' || outcome.status === 'idempotent') && outcome.commitAuthority
    ? { status: 'admitted', admission: Object.freeze({ authority: outcome.commitAuthority,
      fence: Object.freeze({ principal: input.principal, authority: outcome.commitAuthority }),
      settle: (result: 'committed' | 'unknown') => cache.settleOperation(outcome.commitAuthority!, result, now()) }) }
    : { status: 'rejected', reason: outcome.reason === 'exhausted' ? 'exhausted' : 'unavailable' };
}
