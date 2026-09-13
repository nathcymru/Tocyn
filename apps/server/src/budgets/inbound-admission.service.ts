import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import type { InboundIdentity } from '../services/email/inbound-identity';
import { MAX_INBOUND_ATTEMPTS } from '../repositories/inbound-email-receipt.repository';
import type { BudgetCoordinatorDO } from '../durable_objects/BudgetCoordinatorDO';
import { sumResourceEnvelopes } from '../utils/cost-policy';
import { BUDGET_AUTHORITY_SNAPSHOT_D1_READ_BOUND } from '../repositories/budget-authority.repository';
import type { BudgetCommitAuthority } from './isolate-admission.service';

export type InboundAdmission = Readonly<{status:'admitted';authority:BudgetCommitAuthority}>
  | Readonly<{status:'rejected';reason:'exhausted'|'unavailable'}>;

/** Two bounded deliveries: each resolves authority twice and performs refresh +
 * reserve and possible revocation RPCs. Each RPC allows a full 128 KiB state read/write at 1 KiB units.
 * Ingress work before reservation and rejected retries still require separate
 * control admission; this is not a complete handler envelope. */
export const INBOUND_RESERVATION_CONTROL_ENVELOPE:Readonly<ResourceAmounts>=Object.freeze({
  workerRequests:2,d1RowsRead:4*BUDGET_AUTHORITY_SNAPSHOT_D1_READ_BOUND,
  doRequests:6,doRowsRead:768,doRowsWritten:768,logEvents:2,
});

/** Internal adapter only; the handler remains unwired until the composition's
 * complete resource envelope and reservation/recovery evidence are accepted.
 * There is deliberately no unmetered legacy fallback for inbound processing. */
export async function admitInboundAttempt(input:{env:Env;deps:TenantRequestDeps;identity:InboundIdentity;
  attempt:number;business:Readonly<ResourceAmounts>;now:()=>number}):Promise<InboundAdmission> {
  const {env,deps,identity,attempt}=input;
  const {sourceHash,envelopeHash}=identity;
  if (ticketMutationAdmissionMode(env)!=='combined' || !env.BUDGET_COORDINATOR_DO
    || !deps.scope.roles.includes('system') || deps.scope.actorId!=='inbound-email'
    || !Number.isSafeInteger(attempt) || attempt<1 || attempt>MAX_INBOUND_ATTEMPTS
    || !/^[a-f0-9]{64}$/.test(sourceHash) || !/^[a-f0-9]{64}$/.test(envelopeHash)) {
    return {status:'rejected',reason:'unavailable'};
  }
  try {
    const operationId=`inbound:${sourceHash}:${attempt}`;
    const purpose=attempt===1?'new-work':'recovery';
    const envelope=sumResourceEnvelopes({...input.business},INBOUND_RESERVATION_CONTROL_ENVELOPE);
    if(!envelope) return {status:'rejected',reason:'unavailable'};
    const holderId='inbound:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify([deps.scope.tenantId,sourceHash,attempt])))),b=>b.toString(16).padStart(2,'0')).join('');
    const principal={kind:'system' as const,actor:'inbound-email' as const};
    const initial=await deps.repositories.budgetAuthority.resolveForVerifiedPrincipal(deps.scope,principal,input.now());
    if(initial.kind==='unavailable')return {status:'rejected',reason:'unavailable'};
    const coordinator=env.BUDGET_COORDINATOR_DO.get(env.BUDGET_COORDINATOR_DO.idFromName(
      initial.kind==='active'?initial.authority.aggregateId:initial.revocation.aggregateId)) as unknown as BudgetCoordinatorDO;
    if(initial.kind==='revoked'){await coordinator.revokeFromTrustedAuthority(initial.revocation);return {status:'rejected',reason:'unavailable'};}
    const policy=initial.authority.tenantAllocations.find(a=>a.effectivePolicy.tenantId===deps.scope.tenantId)?.effectivePolicy;
    if(!policy||initial.commitSnapshot.tenant_id!==deps.scope.tenantId)return {status:'rejected',reason:'unavailable'};
    await coordinator.refreshFromTrustedAuthority(initial.authority);
    const result=await coordinator.reserveFromTrustedAuthority({tenantId:deps.scope.tenantId,holderId,idempotencyKey:operationId,
      purpose,envelope,expectedPolicyId:policy.policyId,expectedPolicyRevision:policy.revision,
      expectedRestrictionRevision:policy.restrictionRevision,now:input.now()});
    if(result.status!=='granted'&&result.status!=='idempotent')return {status:'rejected',reason:
      result.reason==='exhausted'||result.reason==='capacity-exhausted'?'exhausted':'unavailable'};
    const current=await deps.repositories.budgetAuthority.resolveForVerifiedPrincipal(deps.scope,principal,input.now());
    if(current.kind==='revoked'){
      const revokedCoordinator=env.BUDGET_COORDINATOR_DO.get(env.BUDGET_COORDINATOR_DO.idFromName(current.revocation.aggregateId)) as unknown as BudgetCoordinatorDO;
      await revokedCoordinator.revokeFromTrustedAuthority(current.revocation);return {status:'rejected',reason:'unavailable'};}
    if(current.kind!=='active'||current.commitSnapshot.tenant_id!==deps.scope.tenantId||current.authority.aggregateId!==initial.authority.aggregateId
      ||!Object.entries(initial.commitSnapshot).every(([key,value])=>current.commitSnapshot[key as keyof typeof current.commitSnapshot]===value))return {status:'rejected',reason:'unavailable'};
    const grant=result.reservation;
    const now=input.now();
    const exactAmounts=(actual:ResourceAmounts)=>Object.keys(actual).length===Object.keys(envelope).length
      &&Object.entries(envelope).every(([key,value])=>actual[key as keyof ResourceAmounts]===value);
    const expectedAllocations=policy.budgets.filter(budget=>envelope[budget.dimension]!==undefined);
    if(!grant||grant.status!=='reserved'||grant.expiresAt<=now||current.authority.authorityExpiresAt<=now
      ||grant.holderId!==holderId||grant.idempotencyKey!==operationId||grant.purpose!==purpose
      ||grant.policyRevision!==policy.revision||grant.restrictionRevision!==policy.restrictionRevision
      ||!exactAmounts(grant.envelope)||!exactAmounts(grant.remaining)||!exactAmounts(grant.accounted)
      ||grant.allocations.length!==expectedAllocations.length
      ||!expectedAllocations.every(budget=>grant.allocations.some(allocation=>allocation.dimension===budget.dimension
        &&allocation.allocationId===budget.allocationId&&allocation.windowId===budget.window.id)))return {status:'rejected',reason:'unavailable'};
    return {status:'admitted',authority:Object.freeze({snapshot:current.commitSnapshot,
      expiresAt:Math.min(grant.expiresAt,current.authority.authorityExpiresAt),purpose,operationId,operationFingerprint:envelopeHash,
      grant:Object.freeze({tenantId:deps.scope.tenantId,aggregateId:current.authority.aggregateId,reservationId:grant.reservationId,
        holderId,operationId,operationFingerprint:envelopeHash,operationEnvelope:Object.freeze({...envelope})})})};
  } catch { return {status:'rejected',reason:'unavailable'}; }
}

/** Unknown external outcomes retain their allocation; this is not a refund. */
export function settleInboundAttempt(authority:BudgetCommitAuthority,outcome:'committed'|'unknown',now:number):void {
  // No holder balance or central release exists in this direct reservation path.
  // Durable receipt state records outcomes; even committed liability stays reserved.
  void authority;void outcome;void now;
}
