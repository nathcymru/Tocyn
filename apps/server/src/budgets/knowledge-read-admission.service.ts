import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { KnowledgeReadAccountingRepository, KnowledgeReadFenceError, type KnowledgeContentSnapshot,
  type KnowledgeListSnapshot, type KnowledgeReadFence, type KnowledgeReadSnapshot } from '../repositories/knowledge-read.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { JWTPayload } from '../types';
import type { BudgetCommitAuthority } from './isolate-admission.service';

export type KnowledgeReadOperation='knowledge.article.list'|'knowledge.article.detail'|'knowledge.article.content';
export type KnowledgeReadAdmission=Readonly<{status:'disabled'}>|Readonly<{status:'admitted';commit:KnowledgeReadCommit}>
  |Readonly<{status:'rejected';reason:'exhausted'|'unavailable'}>;

const FIXED_D1_READS=4_096;
const PROJECTION_BYTE_UNIT=256;

function safeAdd(...values:number[]):number|null {
  let result=0;
  for(const value of values){if(!Number.isSafeInteger(value)||value<0||result>Number.MAX_SAFE_INTEGER-value)return null;result+=value;}
  return result;
}

export function knowledgeReadEnvelope(operation:KnowledgeReadOperation,snapshot:KnowledgeReadSnapshot):Readonly<ResourceAmounts>|null {
  let d1RowsRead=FIXED_D1_READS;
  if(operation==='knowledge.article.list'){
    const list=snapshot as KnowledgeListSnapshot|undefined;
    if(!list)return null;
    const rows=safeAdd(FIXED_D1_READS,list.documentRows*2,Math.ceil(list.projectionBytes/PROJECTION_BYTE_UNIT));
    if(rows===null)return null;
    d1RowsRead=rows;
  }
  const content=operation==='knowledge.article.content'?(snapshot as KnowledgeContentSnapshot|undefined):undefined;
  if(content&&(!Number.isSafeInteger(content.sourceBytes)||content.sourceBytes<0))return null;
  // One exact budget_grant_operations row (table plus its primary-key index) is the
  // durable consumption evidence committed in the same D1 batch as the read.
  return Object.freeze({workerRequests:1,d1RowsRead,d1RowsWritten:2,
    // Reading an existing object does not allocate persistent stock. Source
    // metadata and the handler's size check bound the body independently.
    ...(operation==='knowledge.article.content'?{r2ClassBOperations:1}:{}),
    ...estimateDiagnosticEnvelope({httpRequests:1,canonicalMutationRequests:0})});
}

async function digest(parts:readonly unknown[]):Promise<string>{
  const result=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parts)));
  return [...new Uint8Array(result)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export class KnowledgeReadCommit {
  private started=false;
  private settled=false;
  readonly fence:KnowledgeReadFence;
  constructor(private readonly deps:TenantRequestDeps,credential:SessionBudgetCredential,authority:BudgetCommitAuthority,
    snapshot:KnowledgeReadSnapshot,private readonly now:()=>number){this.fence=Object.freeze({credential:Object.freeze({...credential}),authority,snapshot});}

  async start():Promise<KnowledgeReadFence>{
    if(this.started||this.settled||this.now()>=this.fence.authority.expiresAt)throw new KnowledgeReadFenceError('authority_changed');
    this.started=true;
    await this.authorizeCurrent();
    return this.fence;
  }

  async authorizeCurrent():Promise<void>{
    const checkedAt=this.now();
    if(this.settled||checkedAt>=this.fence.authority.expiresAt)throw new KnowledgeReadFenceError('authority_changed');
    const principal=await new SessionBudgetAuthorityRepository(this.deps.database,this.deps.scope)
      .authorize(this.fence.credential,{},checkedAt);
    if(!principal)throw new KnowledgeReadFenceError('authority_changed');
    const current=await this.deps.repositories.budgetAuthority.resolveForVerifiedPrincipal(this.deps.scope,principal,checkedAt);
    if(current.kind!=='active'||Object.entries(current.commitSnapshot).some(([key,value])=>
      this.fence.authority.snapshot[key as keyof typeof current.commitSnapshot]!==value))throw new KnowledgeReadFenceError('authority_changed');
    const grant=this.fence.authority.grant;
    const valid=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
    if(!grant||!valid(grant.tenantId)||!valid(grant.aggregateId)||!valid(grant.reservationId)||!valid(grant.holderId)
      ||!valid(grant.operationId)||!valid(grant.operationFingerprint)||grant.tenantId!==this.deps.scope.tenantId
      ||grant.operationId!==this.fence.authority.operationId||grant.operationFingerprint!==this.fence.authority.operationFingerprint)
      throw new KnowledgeReadFenceError('authority_changed');
    const closure=await new KnowledgeReadAccountingRepository(this.deps.database,this.deps.scope)
      .isGrantClosed(grant.reservationId,grant.holderId);
    if(closure)throw new KnowledgeReadFenceError('authority_changed');
  }

  settle(outcome:'committed'|'unknown'):void {
    if(this.settled)return;
    this.settled=true;
    apiTicketBudgetCache.settleOperation(this.fence.authority,outcome,this.now());
  }
}

export async function admitKnowledgeRead(input:{env:Env;deps:TenantRequestDeps;payload:JWTPayload;operation:KnowledgeReadOperation;
  documentId?:string;now:()=>number}):Promise<KnowledgeReadAdmission>{
  if(input.env.BUDGET_ADMISSION_POLICY===undefined)return {status:'disabled'};
  const mode=staffTicketAdmissionMode(input.env);
  if(mode==='disabled')return {status:'disabled'};
  const {deps,payload}=input;
  if(mode!=='enabled'||!input.env.BUDGET_COORDINATOR_DO||payload.sub!==deps.scope.actorId||payload.tenant_id!==deps.scope.tenantId
    ||(payload.role!=='admin'&&payload.role!=='agent')||payload.mfa_verified!==true
    ||!Number.isSafeInteger(payload.session_version)||!Number.isSafeInteger(payload.exp)
    ||(input.operation!=='knowledge.article.list'&&(typeof input.documentId!=='string'||input.documentId.length===0)))return {status:'rejected',reason:'unavailable'};
  const credential:SessionBudgetCredential={tenantId:deps.scope.tenantId,actorId:payload.sub,role:payload.role,
    sessionVersion:payload.session_version!,expiresAt:payload.exp,mfaVerified:true};
  try{
    const sessions=new SessionBudgetAuthorityRepository(deps.database,deps.scope);
    if(!await sessions.authorize(credential,{},input.now()))return {status:'rejected',reason:'unavailable'};
    const accounting=new KnowledgeReadAccountingRepository(deps.database,deps.scope);
    const snapshot:KnowledgeReadSnapshot=input.operation==='knowledge.article.list'?await accounting.listSnapshot()
      :input.operation==='knowledge.article.content'?await accounting.contentSnapshot(input.documentId!):undefined;
    const business=knowledgeReadEnvelope(input.operation,snapshot);
    if(!business)return {status:'rejected',reason:'unavailable'};
    const outcome=await sessionTicketBudgetAdmission.admit({repository:deps.repositories.budgetAuthority,sessions,
      namespace:input.env.BUDGET_COORDINATOR_DO,scope:deps.scope,credential,requirements:{},
      intent:{operationId:crypto.randomUUID(),operationFingerprint:await digest(['knowledge-read-v1',deps.scope.tenantId,
        deps.scope.actorId,input.operation,input.documentId??null,snapshot]),workScopeKey:input.operation},business,now:input.now});
    const authority=outcome.status!=='rejected'?outcome.commitAuthority:undefined;
    if((outcome.status==='spent'||outcome.status==='idempotent')&&authority)return {status:'admitted',commit:new KnowledgeReadCommit(deps,credential,authority,snapshot,input.now)};
    return {status:'rejected',reason:outcome.reason==='exhausted'||outcome.reason==='capacity-exhausted'?'exhausted':'unavailable'};
  }catch{return {status:'rejected',reason:'unavailable'};}
}
