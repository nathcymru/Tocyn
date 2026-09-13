import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { JWTPayload } from '../types';
import { sessionTicketBudgetAdmission,staffTicketAdmissionMode,apiTicketBudgetCache } from '../middleware/budget-admission.middleware';
import { SessionBudgetAuthorityRepository,type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { CapacityCommit,CapacityOperation } from '../repositories/operator-capacity.repository';
import type { OperatorCapacityInput } from '../types/operator-capacity';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export async function capacityFingerprint(operation:CapacityOperation,tenantId:string,actorId:string,targetId:string,input?:OperatorCapacityInput):Promise<string>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['capacity-v1',operation,tenantId,actorId,targetId,
    input?[input.expectedRevision,input.availability,input.assignmentCeiling]:null])));
  return Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
}
/** Bounded 1001 covering load rows, fence/ledger and policy point lookups; no historical scans. */
export const CAPACITY_ENVELOPE=Object.freeze({workerRequests:1,d1RowsRead:8192,d1RowsWritten:32,
  ...estimateDiagnosticEnvelope({httpRequests:1,canonicalMutationRequests:0})});
export async function admitCapacity(args:{env:Env;deps:TenantRequestDeps;payload:JWTPayload;operation:CapacityOperation;targetId:string;input?:OperatorCapacityInput;now:()=>number}):Promise<CapacityCommit|null>{
  const {env,deps,payload,targetId,input,operation}=args;
  if(staffTicketAdmissionMode(env)!=='enabled'||!env.BUDGET_COORDINATOR_DO||!payload||payload.tenant_id!==deps.scope.tenantId||payload.sub!==deps.scope.actorId
    ||targetId.length>128||deps.scope.tenantId.length>256||deps.scope.actorId.length>256
    ||!['admin','agent'].includes(payload.role)||payload.mfa_verified!==true||!Number.isSafeInteger(payload.session_version)
    ||!Number.isSafeInteger(payload.exp)||(payload.role!=='admin'&&(operation==='operator.capacity.write'||targetId!==payload.sub)))return null;
  const credential:SessionBudgetCredential={tenantId:deps.scope.tenantId,actorId:payload.sub,role:payload.role as 'admin'|'agent',
    sessionVersion:payload.session_version!,expiresAt:payload.exp,mfaVerified:true};
  const sessions=new SessionBudgetAuthorityRepository(deps.database,deps.scope);
  if(!await sessions.authorize(credential,{},args.now()))return null;
  const fingerprint=await capacityFingerprint(operation,deps.scope.tenantId,payload.sub,targetId,input);
  const outcome=await sessionTicketBudgetAdmission.admit({database:deps.database,repository:deps.repositories.budgetAuthority,sessions,namespace:env.BUDGET_COORDINATOR_DO,
    scope:deps.scope,credential,requirements:{},intent:{operationId:crypto.randomUUID(),operationFingerprint:fingerprint,workScopeKey:operation},
    business:{...CAPACITY_ENVELOPE,...(input?{d1StorageBytes:2048}:{})},now:args.now});
  if((outcome.status!=='spent'&&outcome.status!=='idempotent')||!outcome.commitAuthority)return null;
  return structuredClone({operation,targetId,input,credential,authority:outcome.commitAuthority});
}
export function settleCapacity(commit:CapacityCommit,state:'committed'|'unknown',now:number){apiTicketBudgetCache.settleOperation(commit.authority,state,now);}
