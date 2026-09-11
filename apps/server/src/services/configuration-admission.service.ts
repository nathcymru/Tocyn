import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import { canonicalMutationJson } from './ticket-mutation-replay.service';
import { ConfigurationAdmissionRepository, type ConfigurationCommit, type ConfigurationFamily,
  type ConfigurationMutationOperation, type ConfigurationNamespace, type ConfigurationOperation,
  type ConfigurationReceipt, type ConfigurationSnapshot } from '../repositories/configuration-admission.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential,
  type SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';

export const CONFIGURATION_READ_BASE:Readonly<ResourceAmounts>=Object.freeze({workerRequests:1,d1RowsRead:4_096,d1RowsWritten:16,logEvents:128});
export const CONFIGURATION_MUTATION_BASE:Readonly<ResourceAmounts>=Object.freeze({workerRequests:1,d1RowsRead:4_096,d1RowsWritten:128,logEvents:128});
export const CONFIGURATION_REQUEST_BYTES=64*1024;

export class ConfigurationAdmissionError extends Error {
  constructor(readonly status:400|409|429|503,readonly code:string,message:string){super(message);}
}
const unavailable=()=>new ConfigurationAdmissionError(503,'budget_admission_unavailable','Budget admission authority is unavailable');
const exhausted=()=>new ConfigurationAdmissionError(429,'budget_exhausted','Configured budget capacity is exhausted');
const conflict=()=>new ConfigurationAdmissionError(409,'idempotency_conflict','Idempotency key was already used with a different payload');
const invalid=()=>new ConfigurationAdmissionError(400,'invalid_configuration','Invalid configuration request');
const changed=()=>new ConfigurationAdmissionError(409,'configuration_changed','Configuration changed; reload and try again');
const duplicateField=()=>new ConfigurationAdmissionError(409,'ticket_field_exists','Ticket field with this name already exists');
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');}

type Attempt={ns:ConfigurationNamespace;requirements:SessionBudgetRequirements;family:ConfigurationFamily;targetId?:string;
  payloadBytes:number;intent:{operationId:string;operationFingerprint:string;workScopeKey:string};started:boolean;keyed:boolean;
  authority?:BudgetCommitAuthority;replay?:ConfigurationReceipt};

/** Owns each measured population snapshot, exact grant, canonical fence and immutable outcome. */
export class ConfigurationAdmissionService {
  private readonly repo:ConfigurationAdmissionRepository;
  private readonly sessions:SessionBudgetAuthorityRepository;
  private readonly attempts=new WeakMap<object,Attempt>();
  constructor(db:D1Database,private readonly scope:VerifiedTenantScope,private readonly credential:SessionBudgetCredential,
    private readonly budget:{service:SessionBudgetAdmissionService;repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;
      now:()=>number;settle:(authority:BudgetCommitAuthority,outcome:'committed'|'unknown',now:number)=>void}){
    this.repo=new ConfigurationAdmissionRepository(db,scope);this.sessions=new SessionBudgetAuthorityRepository(db,scope);
  }
  private async authorize(requirements:SessionBudgetRequirements){
    if(!await this.sessions.authorize(this.credential,requirements,this.budget.now()))throw unavailable();
  }
  private async admit(operation:ConfigurationOperation,requirements:SessionBudgetRequirements,intent:Attempt['intent'],business:ResourceAmounts){
    await this.authorize(requirements);
    const result=await this.budget.service.admit({repository:this.budget.repository,sessions:this.sessions,namespace:this.budget.namespace,
      scope:this.scope,credential:this.credential,requirements,intent,business,now:this.budget.now});
    if(result.status==='rejected')throw result.reason==='exhausted'||result.reason==='capacity-exhausted'?exhausted():unavailable();
    if(!result.commitAuthority||result.commitAuthority.operationId!==intent.operationId||result.commitAuthority.operationFingerprint!==intent.operationFingerprint)throw unavailable();
    return result.commitAuthority;
  }
  private envelope(snapshot:ConfigurationSnapshot,list:boolean,payloadBytes=0):ResourceAmounts{
    const rows=list?snapshot.population.rowCount*2:12;
    const content=list?snapshot.population.contentBytes:(snapshot.target?.contentBytes??0)+payloadBytes;
    if(!Number.isSafeInteger(rows)||rows<0||!Number.isSafeInteger(content)||content<0)throw unavailable();
    const bytes=Math.ceil(content/256),reads=4_096+rows+bytes;
    if(!Number.isSafeInteger(bytes)||!Number.isSafeInteger(reads))throw unavailable();
    return list?{...CONFIGURATION_READ_BASE,d1RowsRead:reads}:{...CONFIGURATION_MUTATION_BASE,d1RowsRead:reads};
  }
  async read(operation:'dashboard.ticket-field.list'|'dashboard.automation.list',requirements:SessionBudgetRequirements):Promise<unknown[]>{
    const family=operation==='dashboard.ticket-field.list'?'ticket-field':'automation';
    await this.authorize(requirements);const snapshot=await this.repo.snapshot(family);
    const intent=Object.freeze({operationId:crypto.randomUUID(),operationFingerprint:await digest(canonicalMutationJson(
      ['configuration-read-v1',operation,this.scope.tenantId,this.credential.actorId,snapshot])),workScopeKey:operation});
    const authority=await this.admit(operation,requirements,intent,this.envelope(snapshot,true));
    try{
      const commit={credential:this.credential,requirements,authority} as const;
      const result=family==='ticket-field'?await this.repo.listTicketFields(commit,snapshot):await this.repo.listAutomations(commit,snapshot);
      await this.authorize(requirements);this.budget.settle(authority,'committed',this.budget.now());return result;
    }catch(error){this.budget.settle(authority,'unknown',this.budget.now());throw error instanceof ConfigurationAdmissionError?error:unavailable();}
  }
  async prepareMutation(operation:ConfigurationMutationOperation,payload:unknown,
    capability:NonNullable<SessionBudgetRequirements['capability']>,key?:string,targetId?:string):Promise<object>{
    if(key!==undefined&&!/^[A-Za-z0-9._~-]{1,128}$/.test(key))throw invalid();
    if(targetId!==undefined&&(!targetId||targetId.length>160))throw invalid();
    const serialized=canonicalMutationJson(payload),payloadBytes=new TextEncoder().encode(serialized).byteLength;
    if(payloadBytes>CONFIGURATION_REQUEST_BYTES)throw invalid();
    const requirements=Object.freeze({capability});await this.authorize(requirements);
    const family:ConfigurationFamily=operation==='dashboard.ticket-field.create'?'ticket-field':'automation';
    const payloadHash=await digest(canonicalMutationJson(['configuration-mutation-v1',operation,targetId??null,payload]));
    const ns=Object.freeze({principalId:this.credential.actorId,operation,keyHash:await digest(key??`server:${crypto.randomUUID()}`),payloadHash});
    const receipt=await this.repo.findActive(ns);if(receipt&&receipt.payload_hash!==payloadHash)throw conflict();
    const prepared=Object.freeze({});this.attempts.set(prepared,{ns,requirements,family,targetId,payloadBytes,started:false,keyed:key!==undefined,
      intent:Object.freeze({operationId:ns.keyHash,operationFingerprint:payloadHash,workScopeKey:operation}),
      ...(receipt?{replay:receipt}:{})});return prepared;
  }
  private async replay(attempt:Attempt,receipt:ConfigurationReceipt):Promise<{status:200|201;body:unknown;replayed:true;keyed:boolean}>{
    const business={...CONFIGURATION_MUTATION_BASE,d1RowsRead:receipt.reserved_d1_rows_read};
    const authority=await this.admit(attempt.ns.operation,attempt.requirements,attempt.intent,business);
    const commit={credential:this.credential,requirements:attempt.requirements,authority,namespace:attempt.ns,
      businessD1RowsRead:receipt.reserved_d1_rows_read};
    try{
      const response=await this.repo.replay(commit,attempt.ns,receipt);await this.authorize(attempt.requirements);
      this.budget.settle(authority,'committed',this.budget.now());return{status:receipt.response_status,body:JSON.parse(response),replayed:true,keyed:attempt.keyed};
    }catch(error){this.budget.settle(authority,'unknown',this.budget.now());throw error instanceof ConfigurationAdmissionError?error:unavailable();}
  }
  async commit(prepared:object,execute:(repository:ConfigurationAdmissionRepository,commit:ConfigurationCommit,snapshot:ConfigurationSnapshot)=>Promise<string>)
    :Promise<{status:200|201;body:unknown;replayed:boolean;keyed:boolean}>{
    const attempt=this.attempts.get(prepared);if(!attempt)throw unavailable();await this.authorize(attempt.requirements);
    if(attempt.replay)return this.replay(attempt,attempt.replay);
    const current=await this.repo.findActive(attempt.ns);if(current){if(current.payload_hash!==attempt.ns.payloadHash)throw conflict();
      return this.replay(attempt,current);}
    if(attempt.started)throw unavailable();
    const snapshot=await this.repo.snapshot(attempt.family,attempt.targetId);
    const business=this.envelope(snapshot,false,attempt.payloadBytes);
    attempt.authority=await this.admit(attempt.ns.operation,attempt.requirements,attempt.intent,business);attempt.started=true;
    const commit={credential:this.credential,requirements:attempt.requirements,authority:attempt.authority,namespace:attempt.ns,
      businessD1RowsRead:business.d1RowsRead};
    try{
      const response=await execute(this.repo,commit,snapshot);await this.authorize(attempt.requirements);
      this.budget.settle(attempt.authority,'committed',this.budget.now());
      return{status:attempt.ns.operation.endsWith('.create')?201:200,body:JSON.parse(response),replayed:false,keyed:attempt.keyed};
    }catch(error){
      this.budget.settle(attempt.authority,'unknown',this.budget.now());const winner=await this.repo.findActive(attempt.ns);
      if(winner){await this.authorize(attempt.requirements);if(winner.payload_hash!==attempt.ns.payloadHash)throw conflict();
        const recovery={...commit,businessD1RowsRead:winner.reserved_d1_rows_read};
        const response=await this.repo.replay(recovery,attempt.ns,winner);
        this.budget.settle(attempt.authority,'committed',this.budget.now());
        return{status:winner.response_status,body:JSON.parse(response),replayed:true,keyed:attempt.keyed};}
      if(error instanceof ConfigurationAdmissionError)throw error;
      if(error instanceof Error&&error.message.includes('UNIQUE'))throw attempt.ns.operation==='dashboard.ticket-field.create'?duplicateField():changed();
      if(error instanceof Error&&error.message.includes('changed'))throw changed();
      throw unavailable();
    }
  }
}
