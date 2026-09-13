import { localBetaEnabled } from '../types/local-beta';
import type { Env } from '../bindings';
import type { JWTPayload } from '../types';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { BudgetCommitAuthority } from './isolate-admission.service';
import { SessionBudgetAuthorityRepository } from '../repositories/session-budget-authority.repository';
import { apiTicketBudgetCache,sessionTicketBudgetAdmission,staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
export type ActivityOperation='dashboard.activity.read'|'dashboard.activity.mark-read'|'dashboard.activity.dismiss';
export type ActivityAdmission={status:'disabled'}|{status:'admitted';authority:BudgetCommitAuthority}|{status:'rejected';reason:'exhausted'|'unavailable'};
// Two101-candidate windows, bounded indexed authorization, and doubled UTF-8
// subject/facts bytes at the existing256-byte accounting unit. Stored titles stay intact.
export const ACTIVITY_READ_ENVELOPE=Object.freeze({workerRequests:1,d1RowsRead:4096+16*202+Math.ceil(2*100*(2051+1024)/256),d1RowsWritten:16,
  ...estimateDiagnosticEnvelope({httpRequests:1,canonicalMutationRequests:0})});
export const ACTIVITY_TRANSITION_ENVELOPE=Object.freeze({...ACTIVITY_READ_ENVELOPE,d1RowsRead:4608});
export async function admitOperatorActivity(input:{env:Env;deps:TenantRequestDeps;payload:JWTPayload;operation:ActivityOperation;target:readonly unknown[];now:()=>number}):Promise<ActivityAdmission>{
  const {env,deps,payload}=input;
  if(env.BUDGET_ADMISSION_POLICY===undefined||staffTicketAdmissionMode(env)==='disabled')
    return localBetaEnabled(env)?{status:'rejected',reason:'unavailable'}:{status:'disabled'};
  if(staffTicketAdmissionMode(env)!=='enabled'||!env.BUDGET_COORDINATOR_DO||payload.sub!==deps.scope.actorId||payload.tenant_id!==deps.scope.tenantId
    ||(payload.role!=='agent'&&payload.role!=='admin')||!deps.scope.roles.includes(payload.role)||payload.mfa_verified!==true
    ||!Number.isSafeInteger(payload.session_version)||!Number.isSafeInteger(payload.exp))return{status:'rejected',reason:'unavailable'};
  try{
    const operationId=crypto.randomUUID();
    const operationFingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(
      ['activity-v1',deps.scope.tenantId,deps.scope.actorId,input.operation,input.target])))),byte=>byte.toString(16).padStart(2,'0')).join('');
    const outcome=await sessionTicketBudgetAdmission.admit({database:deps.database,repository:deps.repositories.budgetAuthority,
      sessions:new SessionBudgetAuthorityRepository(deps.database,deps.scope),namespace:env.BUDGET_COORDINATOR_DO,scope:deps.scope,
      credential:{tenantId:deps.scope.tenantId,actorId:payload.sub,role:payload.role,sessionVersion:payload.session_version!,expiresAt:payload.exp,mfaVerified:true},
      requirements:{},intent:{operationId,operationFingerprint,workScopeKey:input.operation},
      business:input.operation==='dashboard.activity.read'?ACTIVITY_READ_ENVELOPE:ACTIVITY_TRANSITION_ENVELOPE,now:input.now});
    if((outcome.status==='spent'||outcome.status==='idempotent')&&outcome.commitAuthority?.operationId===operationId
      &&outcome.commitAuthority.operationFingerprint===operationFingerprint)return{status:'admitted',authority:outcome.commitAuthority};
    return{status:'rejected',reason:outcome.reason==='exhausted'||outcome.reason==='capacity-exhausted'?'exhausted':'unavailable'};
  }catch{return{status:'rejected',reason:'unavailable'};}
}
export function settleOperatorActivity(admission:ActivityAdmission,outcome:'committed'|'unknown',now:number){
  if(admission.status==='admitted')apiTicketBudgetCache.settleOperation(admission.authority,outcome,now);
}
