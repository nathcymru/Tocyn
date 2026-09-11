import type {D1Database,DurableObjectNamespace} from '@cloudflare/workers-types';
import type {ResourceAmounts} from '@luminatick/shared';
import type {VerifiedTenantScope} from '../types/tenant';
import {canonicalMutationJson} from './ticket-mutation-replay.service';
import {ChannelConfigurationAdmissionRepository,type ChannelConfigurationCommit,type ChannelConfigurationMutationOperation,
  type ChannelConfigurationNamespace,type ChannelConfigurationOperation,type ChannelReceipt,type ChannelSnapshot}
  from '../repositories/channel-configuration-admission.repository';
import {SessionBudgetAuthorityRepository,type SessionBudgetCredential,type SessionBudgetRequirements}
  from '../repositories/session-budget-authority.repository';
import {SessionBudgetAdmissionService} from '../budgets/session-admission.service';
import type {BudgetAuthorityRepository} from '../repositories/budget-authority.repository';
import type {BudgetCommitAuthority} from '../budgets/isolate-admission.service';
import {CapabilityFenceError} from '../auth/capability-policy';

export const CHANNEL_CONFIGURATION_READ_BASE:Readonly<ResourceAmounts>=Object.freeze({workerRequests:1,d1RowsRead:4_096,d1RowsWritten:16,logEvents:128});
export const CHANNEL_CONFIGURATION_MUTATION_BASE:Readonly<ResourceAmounts>=Object.freeze({workerRequests:1,d1RowsRead:4_096,d1RowsWritten:128,logEvents:128});
export const CHANNEL_CONFIGURATION_REQUEST_BYTES=64*1024;
export class ChannelConfigurationAdmissionError extends Error{
  constructor(readonly status:400|409|429|503,readonly code:string,message:string){super(message);}
}
const unavailable=()=>new ChannelConfigurationAdmissionError(503,'budget_admission_unavailable','Budget admission authority is unavailable');
const exhausted=()=>new ChannelConfigurationAdmissionError(429,'budget_exhausted','Configured budget capacity is exhausted');
const conflict=()=>new ChannelConfigurationAdmissionError(409,'idempotency_conflict','Idempotency key was already used with a different payload');
const invalid=()=>new ChannelConfigurationAdmissionError(400,'invalid_channel','Invalid email channel');
const groupMissing=()=>new ChannelConfigurationAdmissionError(400,'channel_group_not_found','Group not found in this tenant');
const duplicate=()=>new ChannelConfigurationAdmissionError(409,'channel_email_exists','Email address already exists');
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');}

type Attempt={ns:ChannelConfigurationNamespace;requirements:SessionBudgetRequirements;targetId?:string;groupId?:string|null;isDefault:boolean;
  payloadBytes:number;intent:{operationId:string;operationFingerprint:string;workScopeKey:string};started:boolean;keyed:boolean;
  authority?:BudgetCommitAuthority;replay?:ChannelReceipt};

/** Admission owner for support-email list, default switch, creation, deletion and immutable replay. */
export class ChannelConfigurationAdmissionService{
  private readonly repo:ChannelConfigurationAdmissionRepository;
  private readonly sessions:SessionBudgetAuthorityRepository;
  private readonly attempts=new WeakMap<object,Attempt>();
  constructor(db:D1Database,private readonly scope:VerifiedTenantScope,private readonly credential:SessionBudgetCredential,
    private readonly budget:{service:SessionBudgetAdmissionService;repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;
      now:()=>number;settle:(authority:BudgetCommitAuthority,outcome:'committed'|'unknown',now:number)=>void}){
    this.repo=new ChannelConfigurationAdmissionRepository(db,scope);this.sessions=new SessionBudgetAuthorityRepository(db,scope);
  }
  private async authorize(requirements:SessionBudgetRequirements){if(!await this.sessions.authorize(this.credential,requirements,this.budget.now()))throw unavailable();}
  private async admit(operation:ChannelConfigurationOperation,requirements:SessionBudgetRequirements,intent:Attempt['intent'],business:ResourceAmounts){
    await this.authorize(requirements);const result=await this.budget.service.admit({repository:this.budget.repository,sessions:this.sessions,
      namespace:this.budget.namespace,scope:this.scope,credential:this.credential,requirements,intent,business,now:this.budget.now});
    if(result.status==='rejected')throw result.reason==='exhausted'||result.reason==='capacity-exhausted'?exhausted():unavailable();
    if(!result.commitAuthority||result.commitAuthority.operationId!==intent.operationId||result.commitAuthority.operationFingerprint!==intent.operationFingerprint)throw unavailable();
    return result.commitAuthority;
  }
  private envelope(snapshot:ChannelSnapshot,list:boolean,payloadBytes=0,isDefault=false):ResourceAmounts{
    const defaultReads=isDefault?snapshot.population.defaultRows*8:0,defaultWrites=isDefault?snapshot.population.defaultRows*16:0;
    const rows=list?snapshot.population.rowCount*2:12+defaultReads,content=list?snapshot.population.contentBytes:(snapshot.target?.contentBytes??0)+payloadBytes;
    if(!Number.isSafeInteger(rows)||rows<0||!Number.isSafeInteger(content)||content<0||!Number.isSafeInteger(defaultWrites)||defaultWrites<0)throw unavailable();
    const reads=4_096+rows+Math.ceil(content/256),writes=128+defaultWrites;
    if(!Number.isSafeInteger(reads)||!Number.isSafeInteger(writes))throw unavailable();
    return list?{...CHANNEL_CONFIGURATION_READ_BASE,d1RowsRead:reads}:{...CHANNEL_CONFIGURATION_MUTATION_BASE,d1RowsRead:reads,d1RowsWritten:writes};
  }
  async read(capability:NonNullable<SessionBudgetRequirements['capability']>):Promise<unknown[]>{
    const requirements=Object.freeze({capability});await this.authorize(requirements);const snapshot=await this.repo.snapshot();
    const operation='dashboard.channel.email.list' as const,intent=Object.freeze({operationId:crypto.randomUUID(),operationFingerprint:await digest(canonicalMutationJson(
      ['channel-configuration-read-v1',operation,this.scope.tenantId,this.credential.actorId,snapshot])),workScopeKey:operation});
    const authority=await this.admit(operation,requirements,intent,this.envelope(snapshot,true));
    try{const result=await this.repo.list({credential:this.credential,requirements,authority},snapshot);await this.authorize(requirements);
      this.budget.settle(authority,'committed',this.budget.now());return result;}
    catch(error){this.budget.settle(authority,'unknown',this.budget.now());throw error instanceof ChannelConfigurationAdmissionError?error:unavailable();}
  }
  async prepareMutation(operation:ChannelConfigurationMutationOperation,payload:unknown,
    capability:NonNullable<SessionBudgetRequirements['capability']>,options:{key?:string;targetId?:string;groupId?:string|null;isDefault?:boolean}={}):Promise<object>{
    if(options.key!==undefined&&!/^[A-Za-z0-9._~-]{1,128}$/.test(options.key))throw invalid();
    if(options.targetId!==undefined&&(!options.targetId||options.targetId.length>160))throw invalid();
    const serialized=canonicalMutationJson(payload),payloadBytes=new TextEncoder().encode(serialized).byteLength;
    if(payloadBytes>CHANNEL_CONFIGURATION_REQUEST_BYTES)throw invalid();
    const requirements=Object.freeze({capability});await this.authorize(requirements);
    const payloadHash=await digest(canonicalMutationJson(['channel-configuration-mutation-v1',operation,options.targetId??null,payload]));
    const ns=Object.freeze({principalId:this.credential.actorId,operation,keyHash:await digest(options.key??`server:${crypto.randomUUID()}`),payloadHash});
    const receipt=await this.repo.findActive(ns);if(receipt&&receipt.payload_hash!==payloadHash)throw conflict();
    if(!receipt&&options.groupId&&!await this.repo.groupExists(options.groupId))throw groupMissing();
    const prepared=Object.freeze({});this.attempts.set(prepared,{ns,requirements,targetId:options.targetId,groupId:options.groupId,
      isDefault:options.isDefault===true,payloadBytes,started:false,keyed:options.key!==undefined,
      intent:Object.freeze({operationId:ns.keyHash,operationFingerprint:payloadHash,workScopeKey:operation}),...(receipt?{replay:receipt}:{})});return prepared;
  }
  private async replay(attempt:Attempt,receipt:ChannelReceipt){
    const business={...CHANNEL_CONFIGURATION_MUTATION_BASE,d1RowsRead:receipt.reserved_d1_rows_read,d1RowsWritten:receipt.reserved_d1_rows_written};
    const authority=await this.admit(attempt.ns.operation,attempt.requirements,attempt.intent,business);
    const commit={credential:this.credential,requirements:attempt.requirements,authority,namespace:attempt.ns,
      businessD1RowsRead:receipt.reserved_d1_rows_read,businessD1RowsWritten:receipt.reserved_d1_rows_written};
    try{const response=await this.repo.replay(commit,attempt.ns,receipt);await this.authorize(attempt.requirements);
      this.budget.settle(authority,'committed',this.budget.now());return{status:receipt.response_status,body:JSON.parse(response),replayed:true as const,keyed:attempt.keyed};}
    catch(error){this.budget.settle(authority,'unknown',this.budget.now());throw error instanceof ChannelConfigurationAdmissionError?error:unavailable();}
  }
  async commit(prepared:object,execute:(repository:ChannelConfigurationAdmissionRepository,commit:ChannelConfigurationCommit,snapshot:ChannelSnapshot)=>Promise<string>){
    const attempt=this.attempts.get(prepared);if(!attempt)throw unavailable();await this.authorize(attempt.requirements);
    if(attempt.replay)return this.replay(attempt,attempt.replay);
    const current=await this.repo.findActive(attempt.ns);if(current){if(current.payload_hash!==attempt.ns.payloadHash)throw conflict();return this.replay(attempt,current);}
    if(attempt.started)throw unavailable();const snapshot=await this.repo.snapshot(attempt.targetId);
    if(attempt.ns.operation==='dashboard.channel.email.delete'&&!snapshot.target?.exists)throw new CapabilityFenceError();
    const business=this.envelope(snapshot,false,attempt.payloadBytes,attempt.isDefault);
    attempt.authority=await this.admit(attempt.ns.operation,attempt.requirements,attempt.intent,business);attempt.started=true;
    const commit={credential:this.credential,requirements:attempt.requirements,authority:attempt.authority,namespace:attempt.ns,
      businessD1RowsRead:business.d1RowsRead,businessD1RowsWritten:business.d1RowsWritten};
    try{const response=await execute(this.repo,commit,snapshot);await this.authorize(attempt.requirements);
      this.budget.settle(attempt.authority,'committed',this.budget.now());return{status:attempt.ns.operation.endsWith('.create')?201 as const:200 as const,
        body:JSON.parse(response),replayed:false as const,keyed:attempt.keyed};}
    catch(error){this.budget.settle(attempt.authority,'unknown',this.budget.now());const winner=await this.repo.findActive(attempt.ns);
      if(winner){await this.authorize(attempt.requirements);if(winner.payload_hash!==attempt.ns.payloadHash)throw conflict();
        const response=await this.repo.replay({...commit,businessD1RowsRead:winner.reserved_d1_rows_read,
          businessD1RowsWritten:winner.reserved_d1_rows_written},attempt.ns,winner);
        this.budget.settle(attempt.authority,'committed',this.budget.now());return{status:winner.response_status,body:JSON.parse(response),replayed:true as const,keyed:attempt.keyed};}
      if(error instanceof CapabilityFenceError||error instanceof ChannelConfigurationAdmissionError)throw error;
      if(error instanceof Error&&error.message.includes('UNIQUE'))throw duplicate();throw unavailable();}
  }
}
