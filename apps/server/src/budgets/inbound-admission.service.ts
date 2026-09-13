import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import type { InboundIdentity } from '../services/email/inbound-identity';
import { MAX_INBOUND_ATTEMPTS } from '../repositories/inbound-email-receipt.repository';
import type { BudgetCommitAuthority } from './isolate-admission.service';

export type InboundAdmission = Readonly<{status:'admitted';authority:BudgetCommitAuthority}>
  | Readonly<{status:'rejected';reason:'exhausted'|'unavailable'}>;

/** Internal adapter only; the handler remains unwired until the composition's
 * complete resource envelope and reservation/recovery evidence are accepted.
 * There is deliberately no unmetered legacy fallback for inbound processing. */
export async function admitInboundAttempt(input:{env:Env;deps:TenantRequestDeps;identity:InboundIdentity;
  attempt:number;business:Readonly<ResourceAmounts>;now:()=>number}):Promise<InboundAdmission> {
  const {env,deps,identity,attempt}=input;
  if (ticketMutationAdmissionMode(env)!=='combined' || !env.BUDGET_COORDINATOR_DO
    || !deps.scope.roles.includes('system') || deps.scope.actorId!=='inbound-email'
    || !Number.isSafeInteger(attempt) || attempt<1 || attempt>MAX_INBOUND_ATTEMPTS
    || !/^[a-f0-9]{64}$/.test(identity.sourceHash) || !/^[a-f0-9]{64}$/.test(identity.envelopeHash)) {
    return {status:'rejected',reason:'unavailable'};
  }
  try {
    const result=await apiTicketBudgetCache.admit({repository:deps.repositories.budgetAuthority,
      namespace:env.BUDGET_COORDINATOR_DO,scope:deps.scope,credentialKey:`inbound:${deps.scope.tenantId}`,
      intent:{operationId:`inbound:${identity.sourceHash}:${attempt}`,operationFingerprint:identity.envelopeHash,
        workScopeKey:'email.inbound'},business:{...input.business},purpose:attempt===1?'new-work':'recovery',now:input.now,
      authorization:{authorize:scope=>Promise.resolve(scope.tenantId===deps.scope.tenantId
        && scope.actorId==='inbound-email' && scope.roles.includes('system')
        ? {kind:'system' as const,actor:'inbound-email' as const}:null)},
    });
    if ((result.status==='spent'||result.status==='idempotent')&&result.commitAuthority) return {status:'admitted',authority:result.commitAuthority};
    return {status:'rejected',reason:result.reason==='exhausted'||result.reason==='capacity-exhausted'?'exhausted':'unavailable'};
  } catch { return {status:'rejected',reason:'unavailable'}; }
}

/** Unknown external outcomes retain their allocation; this is not a refund. */
export function settleInboundAttempt(authority:BudgetCommitAuthority,outcome:'committed'|'unknown',now:number):void {
  apiTicketBudgetCache.settleOperation(authority,outcome,now);
}
