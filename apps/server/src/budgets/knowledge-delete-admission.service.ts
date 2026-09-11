import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { JWTPayload } from '../types';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, sessionTicketBudgetAdmission, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { BudgetCommitAuthority } from './isolate-admission.service';
import type { StaffMutationCommit } from '../types/staff-ticket-mutation';

/** Initial revocation owns the document, counter update and one best-effort
 * workflow dispatch. Native metadata must tighten this without lowering it. */
export const KNOWLEDGE_DELETE_HTTP_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: 64,
  workflowExecutions: 1, workflowSteps: 1, workflowStorageBytes: 1_024,
  ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }),
});

/** A continuation performs at most one R2 delete or one 100-id Vectorize
 * delete and includes its fixed discovery/claim/finalization D1 work. */
export const KNOWLEDGE_DELETE_STEP_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: 512,
  r2ClassAOperations: 1,
  workflowExecutions: 2, workflowSteps: 2, workflowStorageBytes: 1_024,
  ...estimateDiagnosticEnvelope({ httpRequests: 0, detachedResourceCompositions: 1, credentialAuthRequests: 0, canonicalMutationRequests: 0 }),
});

export type KnowledgeDeleteFence = Pick<StaffMutationCommit, 'credential'|'requirements'|'authority'>;
export class KnowledgeDeleteAdmissionError extends Error {}

export class KnowledgeDeleteCommit {
  private started = false;
  private settled = false;
  readonly fence: KnowledgeDeleteFence;
  constructor(private readonly deps: TenantRequestDeps, credential: SessionBudgetCredential,
    authority: BudgetCommitAuthority, private readonly now: () => number) {
    this.fence = Object.freeze({ credential: structuredClone(credential), requirements: Object.freeze({}), authority });
  }
  async start(): Promise<KnowledgeDeleteFence> {
    if (this.started || this.settled || this.now() >= this.fence.authority.expiresAt) throw new KnowledgeDeleteAdmissionError('Knowledge deletion admission unavailable');
    this.started = true;
    await this.authorizeCurrent();
    return this.fence;
  }
  async authorizeCurrent(): Promise<void> {
    const checkedAt = this.now();
    if (this.settled || checkedAt >= this.fence.authority.expiresAt) throw new KnowledgeDeleteAdmissionError('Knowledge deletion admission unavailable');
    const sessions = new SessionBudgetAuthorityRepository(this.deps.database,this.deps.scope);
    const principal = await sessions.authorize(this.fence.credential,this.fence.requirements,checkedAt);
    if (!principal) throw new KnowledgeDeleteAdmissionError('Knowledge deletion admission unavailable');
    const current = await this.deps.repositories.budgetAuthority.resolveForVerifiedPrincipal(this.deps.scope,principal,checkedAt);
    if (current.kind !== 'active' || Object.entries(current.commitSnapshot).some(([key,value]) =>
      this.fence.authority.snapshot[key as keyof typeof current.commitSnapshot] !== value)) throw new KnowledgeDeleteAdmissionError('Knowledge deletion admission unavailable');
  }
  settle(outcome: 'committed'|'unknown'): void {
    if (this.settled) return;
    this.settled = true;
    apiTicketBudgetCache.settleOperation(this.fence.authority,outcome,this.now());
  }
}

export type KnowledgeDeleteAdmission =
  | Readonly<{ status:'disabled' }>
  | Readonly<{ status:'admitted'; commit:KnowledgeDeleteCommit }>
  | Readonly<{ status:'rejected'; reason:'exhausted'|'unavailable' }>;

export type KnowledgeDeleteStepAdmission =
  | Readonly<{ status:'disabled' }>
  | Readonly<{ status:'admitted'; authority:BudgetCommitAuthority }>
  | Readonly<{ status:'rejected'; reason:'exhausted'|'unavailable' }>;

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}
async function fingerprint(parts: readonly unknown[]): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(result),value=>value.toString(16).padStart(2,'0')).join('');
}

export async function admitKnowledgeDelete(input:{ env:Env; deps:TenantRequestDeps; payload:JWTPayload; documentId:string; now:()=>number }):Promise<KnowledgeDeleteAdmission>{
  const mode=input.env.BUDGET_ADMISSION_POLICY===undefined?'disabled':ticketMutationAdmissionMode(input.env);
  if(mode==='disabled')return {status:'disabled'};
  if(mode!=='combined'||!input.env.BUDGET_COORDINATOR_DO||!validIdentity(input.documentId))return {status:'rejected',reason:'unavailable'};
  const {deps,payload}=input,sessionVersion=payload.session_version,expiresAt=payload.exp;
  if((payload.role!=='admin'&&payload.role!=='agent')||payload.mfa_verified!==true||!validIdentity(deps.scope.tenantId)
    ||!validIdentity(deps.scope.actorId)||payload.sub!==deps.scope.actorId||payload.tenant_id!==deps.scope.tenantId
    ||!Number.isSafeInteger(sessionVersion)||!Number.isSafeInteger(expiresAt))return {status:'rejected',reason:'unavailable'};
  const credential:SessionBudgetCredential={tenantId:deps.scope.tenantId,actorId:payload.sub,role:payload.role,
    sessionVersion:sessionVersion as number,expiresAt:expiresAt as number,mfaVerified:true};
  try{
    const outcome=await sessionTicketBudgetAdmission.admit({repository:deps.repositories.budgetAuthority,
      sessions:new SessionBudgetAuthorityRepository(deps.database,deps.scope),namespace:input.env.BUDGET_COORDINATOR_DO,
      scope:deps.scope,credential,requirements:{},intent:{operationId:crypto.randomUUID(),
        operationFingerprint:await fingerprint(['knowledge-delete-http-v1',deps.scope.tenantId,deps.scope.actorId,input.documentId]),
        workScopeKey:'knowledge.document.delete'},business:KNOWLEDGE_DELETE_HTTP_ENVELOPE,now:input.now});
    return (outcome.status==='spent'||outcome.status==='idempotent')&&outcome.commitAuthority
      ?{status:'admitted',commit:new KnowledgeDeleteCommit(deps,credential,outcome.commitAuthority,input.now)}
      :{status:'rejected',reason:outcome.reason==='exhausted'||outcome.reason==='capacity-exhausted'?'exhausted':'unavailable'};
  }catch{return {status:'rejected',reason:'unavailable'};}
}

export async function admitKnowledgeDeleteStep(input:{env:Env;deps:TenantRequestDeps;documentId:string;deleteToken:string;
  purpose:'new-work'|'recovery';now:()=>number}):Promise<KnowledgeDeleteStepAdmission>{
  const mode=input.env.BUDGET_ADMISSION_POLICY===undefined?'disabled':ticketMutationAdmissionMode(input.env);
  if(mode==='disabled')return {status:'disabled'};
  if(mode!=='combined'||!input.env.BUDGET_COORDINATOR_DO||!validIdentity(input.documentId)||!validIdentity(input.deleteToken)
    ||!input.deps.scope.roles.includes('system')||input.deps.scope.actorId!=='knowledge-delete')return {status:'rejected',reason:'unavailable'};
  try{
    const outcome=await apiTicketBudgetCache.admit({repository:input.deps.repositories.budgetAuthority,namespace:input.env.BUDGET_COORDINATOR_DO,
      scope:input.deps.scope,credentialKey:`knowledge-delete:${input.deps.scope.tenantId}:${input.documentId}`,
      intent:{operationId:crypto.randomUUID(),operationFingerprint:await fingerprint(['knowledge-delete-step-v1',input.deps.scope.tenantId,
        input.documentId,input.deleteToken,input.purpose,crypto.randomUUID()]),workScopeKey:'knowledge.document.delete.cleanup'},
      business:KNOWLEDGE_DELETE_STEP_ENVELOPE,purpose:input.purpose,now:input.now,
      authorization:{authorize:scope=>scope.tenantId===input.deps.scope.tenantId&&scope.roles.includes('system')&&scope.actorId==='knowledge-delete'
        ?Promise.resolve({kind:'system' as const,actor:'knowledge-delete' as const}):Promise.resolve(null)}});
    return (outcome.status==='spent'||outcome.status==='idempotent')&&outcome.commitAuthority
      ?{status:'admitted',authority:outcome.commitAuthority}
      :{status:'rejected',reason:outcome.reason==='exhausted'||outcome.reason==='capacity-exhausted'?'exhausted':'unavailable'};
  }catch{return {status:'rejected',reason:'unavailable'};}
}

export function settleKnowledgeDeleteStep(authority:BudgetCommitAuthority,outcome:'committed'|'unknown',now:()=>number):void{
  apiTicketBudgetCache.settleOperation(authority,outcome,now());
}
