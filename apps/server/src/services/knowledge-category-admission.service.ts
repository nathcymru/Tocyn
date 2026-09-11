import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import { KnowledgeCategoryAdmissionRepository,type KnowledgeCategoryCommit,type KnowledgeCategoryMutationOperation,
  type KnowledgeCategoryNamespace,type KnowledgeCategoryOperation,type KnowledgeCategoryRow,type KnowledgeCategorySnapshot } from '../repositories/knowledge-category-admission.repository';
import { SessionBudgetAuthorityRepository,type SessionBudgetCredential,type SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import type { VerifiedTenantScope } from '../types/tenant';
import { canonicalMutationJson } from './ticket-mutation-replay.service';

export const KNOWLEDGE_CATEGORY_REQUEST_BYTES=64*1024;
export const KNOWLEDGE_CATEGORY_READ_BASE:Readonly<ResourceAmounts>=Object.freeze({workerRequests:1,d1RowsRead:4_096,d1RowsWritten:16,logEvents:128});
export const KNOWLEDGE_CATEGORY_MUTATION_BASE:Readonly<ResourceAmounts>=Object.freeze({workerRequests:1,d1RowsRead:4_096,d1RowsWritten:128,logEvents:128});

export class KnowledgeCategoryAdmissionError extends Error{
  constructor(readonly status:400|409|429|503,readonly code:string,message:string){super(message);}
}
const unavailable=()=>new KnowledgeCategoryAdmissionError(503,'budget_admission_unavailable','Budget admission authority is unavailable');
const exhausted=()=>new KnowledgeCategoryAdmissionError(429,'budget_exhausted','Configured budget capacity is exhausted');
const conflict=()=>new KnowledgeCategoryAdmissionError(409,'idempotency_conflict','Idempotency key was already used with a different payload');
const changed=()=>new KnowledgeCategoryAdmissionError(409,'category_changed','Knowledge categories changed; reload and try again');
const referenced=(message:string)=>new KnowledgeCategoryAdmissionError(400,'category_referenced',message);
const safe=(value:number)=>Number.isSafeInteger(value)&&value>=0;
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),
  byte=>byte.toString(16).padStart(2,'0')).join('');}

type Attempt={ns:KnowledgeCategoryNamespace;requirements:SessionBudgetRequirements;targetId?:string;includeDocuments:boolean;payloadBytes:number;
  intent:{operationId:string;operationFingerprint:string;workScopeKey:string};started:boolean;keyed:boolean;authority?:BudgetCommitAuthority;
  replay?:{status:200;body:Record<string,unknown>}};

export function knowledgeCategoryEnvelope(snapshot:KnowledgeCategorySnapshot,operation:KnowledgeCategoryOperation,payloadBytes=0):ResourceAmounts|null{
  const categories=snapshot.population.categoryRows,bytes=snapshot.population.projectionBytes;
  if(!safe(categories)||!safe(bytes)||!safe(payloadBytes))return null;
  const byteUnits=Math.ceil((bytes+payloadBytes)/256);
  let dynamic=operation==='knowledge.category.list'?categories*2+byteUnits:byteUnits;
  if(operation==='knowledge.category.delete'){
    if(!safe(snapshot.documentRows??-1))return null;dynamic+=categories*3+(snapshot.documentRows??0)*3;
  }
  const reads=4_096+dynamic;if(!safe(dynamic)||!safe(reads))return null;
  return{...(operation==='knowledge.category.list'?KNOWLEDGE_CATEGORY_READ_BASE:KNOWLEDGE_CATEGORY_MUTATION_BASE),d1RowsRead:reads};
}

export class KnowledgeCategoryAdmissionService{
  private readonly repo:KnowledgeCategoryAdmissionRepository;
  private readonly sessions:SessionBudgetAuthorityRepository;
  private readonly attempts=new WeakMap<object,Attempt>();
  constructor(db:D1Database,private readonly scope:VerifiedTenantScope,private readonly credential:SessionBudgetCredential,
    private readonly budget:{service:SessionBudgetAdmissionService;repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;
      now:()=>number;settle:(authority:BudgetCommitAuthority,outcome:'committed'|'unknown',now:number)=>void},
    private readonly newId:()=>string=()=>crypto.randomUUID()){
    this.repo=new KnowledgeCategoryAdmissionRepository(db,scope);this.sessions=new SessionBudgetAuthorityRepository(db,scope);
  }
  async preauthorize():Promise<void>{if(!await this.sessions.authorize(this.credential,{},this.budget.now()))throw unavailable();}
  private async admit(operation:KnowledgeCategoryOperation,intent:Attempt['intent'],business:ResourceAmounts){
    await this.preauthorize();
    const result=await this.budget.service.admit({repository:this.budget.repository,sessions:this.sessions,namespace:this.budget.namespace,
      scope:this.scope,credential:this.credential,requirements:{},intent,business,now:this.budget.now});
    if(result.status==='rejected')throw result.reason==='exhausted'||result.reason==='capacity-exhausted'?exhausted():unavailable();
    if(!result.commitAuthority||result.commitAuthority.operationId!==intent.operationId||result.commitAuthority.operationFingerprint!==intent.operationFingerprint)throw unavailable();
    return result.commitAuthority;
  }
  private envelope(snapshot:KnowledgeCategorySnapshot,operation:KnowledgeCategoryOperation,payloadBytes=0):ResourceAmounts{
    const envelope=knowledgeCategoryEnvelope(snapshot,operation,payloadBytes);if(!envelope)throw unavailable();return envelope;
  }

  async list():Promise<KnowledgeCategoryRow[]>{
    await this.preauthorize();const snapshot=await this.repo.snapshot();
    const intent=Object.freeze({operationId:crypto.randomUUID(),operationFingerprint:await digest(canonicalMutationJson(
      ['knowledge-category-v1','knowledge.category.list',this.scope.tenantId,this.credential.actorId,snapshot])),workScopeKey:'knowledge.category.list'});
    const authority=await this.admit('knowledge.category.list',intent,this.envelope(snapshot,'knowledge.category.list'));
    try{const result=await this.repo.list({credential:this.credential,requirements:{},authority},snapshot);
      await this.preauthorize();this.budget.settle(authority,'committed',this.budget.now());return result;
    }catch(error){this.budget.settle(authority,'unknown',this.budget.now());throw error instanceof KnowledgeCategoryAdmissionError?error:unavailable();}
  }

  async prepareMutation(operation:KnowledgeCategoryMutationOperation,payload:unknown,key?:string,targetId?:string,includeDocuments=false):Promise<object>{
    await this.preauthorize();
    const serialized=canonicalMutationJson(payload),payloadBytes=new TextEncoder().encode(serialized).byteLength;
    if(payloadBytes>KNOWLEDGE_CATEGORY_REQUEST_BYTES)throw unavailable();
    const payloadHash=await digest(canonicalMutationJson(['knowledge-category-v1',operation,targetId??null,payload]));
    const ns=Object.freeze({principalId:this.credential.actorId,operation,keyHash:await digest(key??`server:${crypto.randomUUID()}`),payloadHash});
    const receipt=await this.repo.findActive(ns);if(receipt&&receipt.payload_hash!==payloadHash)throw conflict();
    const prepared=Object.freeze({});this.attempts.set(prepared,{ns,requirements:Object.freeze({}),targetId,includeDocuments,payloadBytes,started:false,keyed:key!==undefined,
      intent:Object.freeze({operationId:ns.keyHash,operationFingerprint:payloadHash,workScopeKey:operation}),
      ...(receipt?{replay:{status:receipt.response_status,body:JSON.parse(receipt.response_snapshot) as Record<string,unknown>}}:{})});return prepared;
  }

  async commit(prepared:object,execute:(repo:KnowledgeCategoryAdmissionRepository,commit:KnowledgeCategoryCommit,snapshot:KnowledgeCategorySnapshot)=>Promise<string>)
    :Promise<{status:200;body:Record<string,unknown>;replayed:boolean;keyed:boolean}>{
    const attempt=this.attempts.get(prepared);if(!attempt)throw unavailable();await this.preauthorize();
    if(attempt.replay)return{...attempt.replay,replayed:true,keyed:attempt.keyed};
    const current=await this.repo.findActive(attempt.ns);if(current){if(current.payload_hash!==attempt.ns.payloadHash)throw conflict();
      return{status:200,body:JSON.parse(current.response_snapshot),replayed:true,keyed:attempt.keyed};}
    if(attempt.started)throw unavailable();
    const snapshot=await this.repo.snapshot(attempt.targetId,attempt.includeDocuments);
    attempt.authority=await this.admit(attempt.ns.operation,attempt.intent,this.envelope(snapshot,attempt.ns.operation,attempt.payloadBytes));attempt.started=true;
    const commit={credential:this.credential,requirements:attempt.requirements,authority:attempt.authority,namespace:attempt.ns};
    try{const response=await execute(this.repo,commit,snapshot);await this.preauthorize();this.budget.settle(attempt.authority,'committed',this.budget.now());
      return{status:200,body:JSON.parse(response),replayed:false,keyed:attempt.keyed};
    }catch(error){this.budget.settle(attempt.authority,'unknown',this.budget.now());const winner=await this.repo.findActive(attempt.ns);
      if(winner){await this.preauthorize();if(winner.payload_hash!==attempt.ns.payloadHash)throw conflict();return{status:200,body:JSON.parse(winner.response_snapshot),replayed:true,keyed:attempt.keyed};}
      if(error instanceof KnowledgeCategoryAdmissionError)throw error;
      if(error instanceof Error&&error.message.includes('contains'))throw referenced(error.message);
      if(error instanceof Error&&(error.message.includes('changed')||error.message.includes('UNIQUE')||error.message.includes('FOREIGN KEY')))throw changed();
      throw unavailable();}
  }

  async create(prepared:object,name:string,parentId?:string):Promise<{status:200;body:Record<string,unknown>;replayed:boolean;keyed:boolean}>{
    const id=this.newId(),createdAt=new Date(this.budget.now()).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,''),response=JSON.stringify({id});
    return this.commit(prepared,(repo,commit,snapshot)=>repo.create(commit,snapshot,{tenant_id:this.scope.tenantId,id,name,parent_id:parentId??null,created_at:createdAt},response));
  }
  async delete(prepared:object,id:string){return this.commit(prepared,(repo,commit,snapshot)=>repo.delete(commit,id,snapshot,JSON.stringify({success:true})));}
}
