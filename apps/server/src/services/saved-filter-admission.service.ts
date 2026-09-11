import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import { canonicalMutationJson } from './ticket-mutation-replay.service';
import { SavedFilterAdmissionRepository, type SavedFilterCommit, type SavedFilterMutationOperation,
  type SavedFilterNamespace, type SavedFilterOperation, type SavedFilterRow, type SavedFilterSnapshot } from '../repositories/saved-filter-admission.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential, type SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';

export const SAVED_FILTER_READ_BASE: Readonly<ResourceAmounts> = Object.freeze({workerRequests:1,d1RowsRead:4_096,d1RowsWritten:16,logEvents:128});
export const SAVED_FILTER_MUTATION_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({workerRequests:1,d1RowsRead:4_096,d1RowsWritten:128,logEvents:128});
export const SAVED_FILTER_REQUEST_BYTES = 64 * 1024;

export class SavedFilterAdmissionError extends Error {
  constructor(readonly status: 400|403|404|409|429|503, readonly code: string, message: string) { super(message); }
}
const unavailable=()=>new SavedFilterAdmissionError(503,'budget_admission_unavailable','Budget admission authority is unavailable');
const exhausted=()=>new SavedFilterAdmissionError(429,'budget_exhausted','Configured budget capacity is exhausted');
const conflict=()=>new SavedFilterAdmissionError(409,'idempotency_conflict','Idempotency key was already used with a different payload');
const invalid=()=>new SavedFilterAdmissionError(400,'invalid_filter','Invalid saved filter');
const changed=()=>new SavedFilterAdmissionError(409,'filter_changed','Saved filter changed; reload and try again');
async function digest(value:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join(''); }

export function savedFilterResponse(row: SavedFilterRow): Record<string,unknown> {
  return {...row,conditions:typeof row.conditions==='string'?JSON.parse(row.conditions):row.conditions};
}

type Attempt={ns:SavedFilterNamespace;requirements:SessionBudgetRequirements;intent:{operationId:string;operationFingerprint:string;workScopeKey:string};
  targetId?:string;payloadBytes:number;started:boolean;keyed:boolean;authority?:BudgetCommitAuthority;replay?:{status:200|201;body:Record<string,unknown>}};

/** Owns the measured snapshot, exact admission authority and immutable replay receipt. */
export class SavedFilterAdmissionService {
  private readonly repo: SavedFilterAdmissionRepository;
  private readonly sessions: SessionBudgetAuthorityRepository;
  private readonly attempts=new WeakMap<object,Attempt>();
  constructor(db:D1Database,private readonly scope:VerifiedTenantScope,private readonly credential:SessionBudgetCredential,
    private readonly budget:{service:SessionBudgetAdmissionService;repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;
      now:()=>number;settle:(authority:BudgetCommitAuthority,outcome:'committed'|'unknown',now:number)=>void}) {
    this.repo=new SavedFilterAdmissionRepository(db,scope);this.sessions=new SessionBudgetAuthorityRepository(db,scope);
  }
  private async authorize(requirements:SessionBudgetRequirements) {
    if (!await this.sessions.authorize(this.credential,requirements,this.budget.now())) throw unavailable();
  }
  private async admit(operation:SavedFilterOperation,requirements:SessionBudgetRequirements,intent:Attempt['intent'],business:ResourceAmounts) {
    await this.authorize(requirements);
    const result=await this.budget.service.admit({repository:this.budget.repository,sessions:this.sessions,namespace:this.budget.namespace,
      scope:this.scope,credential:this.credential,requirements,intent,business,now:this.budget.now});
    if(result.status==='rejected') throw result.reason==='exhausted'||result.reason==='capacity-exhausted'?exhausted():unavailable();
    if(!result.commitAuthority||result.commitAuthority.operationId!==intent.operationId||result.commitAuthority.operationFingerprint!==intent.operationFingerprint) throw unavailable();
    return result.commitAuthority;
  }
  private envelope(snapshot:SavedFilterSnapshot,list:boolean):ResourceAmounts {
    const rows=list?snapshot.population.filterRows*2:8,bytes=list?snapshot.population.conditionBytes:(snapshot.target?.conditionBytes??0);
    const byteUnits=Math.ceil(bytes/256),reads=4_096+rows+byteUnits;
    if(!Number.isSafeInteger(rows)||rows<0||!Number.isSafeInteger(byteUnits)||byteUnits<0||!Number.isSafeInteger(reads))throw unavailable();
    return {...SAVED_FILTER_READ_BASE,d1RowsRead:reads};
  }
  private mutationEnvelope(snapshot:SavedFilterSnapshot,payloadBytes:number):ResourceAmounts {
    const existing=snapshot.target?.conditionBytes??0;
    if(!Number.isSafeInteger(existing)||existing<0||!Number.isSafeInteger(payloadBytes)||payloadBytes<0||existing>Number.MAX_SAFE_INTEGER-payloadBytes)throw unavailable();
    const byteUnits=Math.ceil((existing+payloadBytes)/256),reads=4_096+byteUnits;
    if(!Number.isSafeInteger(byteUnits)||byteUnits<0||!Number.isSafeInteger(reads))throw unavailable();
    return {...SAVED_FILTER_MUTATION_ENVELOPE,d1RowsRead:reads};
  }
  async read(operation:'dashboard.filter.list'|'dashboard.filter.get',targetId?:string):Promise<Record<string,unknown>[]|Record<string,unknown>|null> {
    if(operation==='dashboard.filter.get'&&(!targetId||targetId.length>160)) throw invalid();
    const requirements=Object.freeze({});await this.authorize(requirements);
    const snapshot=await this.repo.snapshot(targetId);
    const intent=Object.freeze({operationId:crypto.randomUUID(),operationFingerprint:await digest(canonicalMutationJson(
      ['saved-filter-read-v1',operation,this.scope.tenantId,this.credential.actorId,targetId??null,snapshot])),workScopeKey:operation});
    const authority=await this.admit(operation,requirements,intent,this.envelope(snapshot,operation==='dashboard.filter.list'));
    try {
      const commit={credential:this.credential,requirements,authority} as const;
      const result=operation==='dashboard.filter.list'
        ? (await this.repo.list(commit,snapshot)).map(savedFilterResponse)
        : ((row=>row?savedFilterResponse(row):null)(await this.repo.get(commit,targetId!,snapshot)));
      await this.authorize(requirements);this.budget.settle(authority,'committed',this.budget.now());return result;
    } catch(error) { this.budget.settle(authority,'unknown',this.budget.now()); throw error instanceof SavedFilterAdmissionError?error:unavailable(); }
  }
  async prepareMutation(operation:SavedFilterMutationOperation,payload:unknown,capability:NonNullable<SessionBudgetRequirements['capability']>,key?:string,targetId?:string):Promise<object> {
    if(key!==undefined&&!/^[A-Za-z0-9._~-]{1,128}$/.test(key)) throw invalid();
    if(targetId!==undefined&&(!targetId||targetId.length>160)) throw invalid();
    const serialized=canonicalMutationJson(payload),payloadBytes=new TextEncoder().encode(serialized).byteLength;
    if(payloadBytes>SAVED_FILTER_REQUEST_BYTES) throw invalid();
    const requirements=Object.freeze({capability});await this.authorize(requirements);
    const payloadHash=await digest(canonicalMutationJson(['saved-filter-mutation-v1',operation,targetId??null,payload]));
    const ns=Object.freeze({principalId:this.credential.actorId,operation,keyHash:await digest(key??`server:${crypto.randomUUID()}`),payloadHash});
    const receipt=await this.repo.findActive(ns);if(receipt&&receipt.payload_hash!==payloadHash) throw conflict();
    const prepared=Object.freeze({});this.attempts.set(prepared,{ns,requirements,targetId,payloadBytes,started:false,keyed:key!==undefined,
      intent:Object.freeze({operationId:ns.keyHash,operationFingerprint:payloadHash,workScopeKey:operation}),
      ...(receipt?{replay:{status:receipt.response_status,body:JSON.parse(receipt.response_snapshot) as Record<string,unknown>}}:{})});
    return prepared;
  }
  async commit(prepared:object,execute:(repository:SavedFilterAdmissionRepository,commit:SavedFilterCommit,snapshot:SavedFilterSnapshot)=>Promise<string>)
    :Promise<{status:200|201;body:Record<string,unknown>;replayed:boolean;keyed:boolean}> {
    const attempt=this.attempts.get(prepared);if(!attempt)throw unavailable();await this.authorize(attempt.requirements);
    if(attempt.replay)return{...attempt.replay,replayed:true,keyed:attempt.keyed};
    const current=await this.repo.findActive(attempt.ns);if(current){if(current.payload_hash!==attempt.ns.payloadHash)throw conflict();
      return{status:current.response_status,body:JSON.parse(current.response_snapshot),replayed:true,keyed:attempt.keyed};}
    if(attempt.started)throw unavailable();
    const snapshot=await this.repo.snapshot(attempt.targetId);
    attempt.authority=await this.admit(attempt.ns.operation,attempt.requirements,attempt.intent,this.mutationEnvelope(snapshot,attempt.payloadBytes));attempt.started=true;
    const commit={credential:this.credential,requirements:attempt.requirements,authority:attempt.authority,namespace:attempt.ns};
    try { const response=await execute(this.repo,commit,snapshot);await this.authorize(attempt.requirements);
      this.budget.settle(attempt.authority,'committed',this.budget.now());
      return{status:attempt.ns.operation==='dashboard.filter.create'?201:200,body:JSON.parse(response),replayed:false,keyed:attempt.keyed};
    } catch(error) {
      this.budget.settle(attempt.authority,'unknown',this.budget.now());const winner=await this.repo.findActive(attempt.ns);
      if(winner){await this.authorize(attempt.requirements);if(winner.payload_hash!==attempt.ns.payloadHash)throw conflict();
        return{status:winner.response_status,body:JSON.parse(winner.response_snapshot),replayed:true,keyed:attempt.keyed};}
      if(error instanceof SavedFilterAdmissionError)throw error;
      if(error instanceof Error&&(error.message.includes('changed')||error.message.includes('UNIQUE')))throw changed();
      throw unavailable();
    }
  }
}
