import type { BudgetPurpose, ResourceAmounts } from '@luminatick/shared';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { BudgetCoordinatorDO } from '../durable_objects/BudgetCoordinatorDO';
import { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { BudgetCommitAuthority } from './isolate-admission.service';
import type { ReconcileOwnerIngressInput, TrustedBudgetCoordinatorAuthority } from './owner-aggregate';

/** CPU, DO duration and DO storage are #50 dimensions, but still lack verified ingress estimates. */
export const OWNER_INGRESS_EXECUTION_ENVELOPE:Readonly<ResourceAmounts>=Object.freeze({
  workerRequests:1,d1RowsRead:1_536,doRequests:8,doRowsRead:8,doRowsWritten:8,logEvents:67,
});
export const MAX_OWNER_INGRESS_BLOCK_OPERATIONS=8,MAX_OWNER_INGRESS_DELIVERY_ATTEMPTS=2;
export const MAX_OWNER_INGRESS_FAILED_ADMISSIONS=3,MAX_OWNER_INGRESS_BINDINGS=64;
export type OwnerIngressAdmissionResult=Readonly<{status:'disabled'}>|Readonly<{status:'rejected';reason:'exhausted'|'unavailable';retryAt?:number}>|Readonly<{status:'admitted';admission:OwnerIngressRequestAdmission}>;
export interface OwnerIngressRequestAdmission{
  tenantHandoff(tenantId:string,now:number):Readonly<{envelope:Readonly<ResourceAmounts>;closure:ReconcileOwnerIngressInput}>|undefined;
  handoffToTenant(tenantId:string,authority?:BudgetCommitAuthority):void;
  finish(now?:number):Promise<'closed'|'retained'>;
}
type Failure='exhausted'|'unavailable';
type Entry={bindingIdentity:object;namespace:DurableObjectNamespace;purpose:BudgetPurpose;failures:number;lastFailure?:Failure;terminalFailure?:Failure;retryAt?:number;block?:IngressBlock;pending?:Promise<IngressBlock|null>};
const scale=(n:number):ResourceAmounts=>Object.fromEntries(Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE).map(([k,v])=>[k,v*n]));
function subtract(left:Readonly<ResourceAmounts>,right:Readonly<ResourceAmounts>):ResourceAmounts{
  const result:ResourceAmounts={};for(const [key,units]of Object.entries(left)){const value=units-(right[key as keyof ResourceAmounts]??0);
    if(!Number.isSafeInteger(value)||value<0)throw new Error('invalid ingress accounting');if(value)result[key as keyof ResourceAmounts]=value;}return result;
}
class IngressBlock{
  private issued=0;private finished=0;private settling?:Promise<'closed'|'retained'>;private transfers:NonNullable<BudgetCommitAuthority['grant']>[]=[];
  constructor(private coordinator:BudgetCoordinatorDO,private repository:BudgetAuthorityRepository,readonly authority:TrustedBudgetCoordinatorAuthority,
    readonly reservation:NonNullable<Awaited<ReturnType<BudgetCoordinatorDO['reserveIngressFromTrustedAuthority']>>['reservation']>,
    readonly envelope:Readonly<ResourceAmounts>,readonly clock:()=>number){}
  bind(repository:BudgetAuthorityRepository,namespace:DurableObjectNamespace){this.repository=repository;
    this.coordinator=namespace.get(namespace.idFromName(this.authority.aggregateId))as unknown as BudgetCoordinatorDO}
  available(now:number){return this.issued<MAX_OWNER_INGRESS_BLOCK_OPERATIONS&&now<this.reservation.expiresAt}
  issue(){if(!this.available(this.clock()))throw new Error('ingress block unavailable');this.issued++;return new RequestAdmission(this)}
  offer(now:number){return Number.isSafeInteger(now)&&now>=0&&now<this.reservation.expiresAt}
  proof(link:NonNullable<BudgetCommitAuthority['grant']>){this.transfers.push(link)}
  complete(now:number){this.finished++;if(this.issued<MAX_OWNER_INGRESS_BLOCK_OPERATIONS||this.finished<this.issued)return Promise.resolve('retained' as const);return this.settling??=this.settle(now)}
  async settle(now:number):Promise<'closed'|'retained'>{
    if(!Number.isSafeInteger(now)||now<0||now>=this.reservation.expiresAt)return'retained';
    const proven:typeof this.transfers=[];for(const link of this.transfers.slice(0,MAX_OWNER_INGRESS_BLOCK_OPERATIONS))if(await this.repository.hasDurableGrantOperation(link))proven.push(link);
    let measured=this.envelope;for(const _ of proven)measured=subtract(measured,OWNER_INGRESS_EXECUTION_ENVELOPE);
    const fingerprint=`sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(
      JSON.stringify(proven.map(x=>[x.tenantId,x.reservationId,x.holderId,x.operationId]).sort()))))).map(x=>x.toString(16).padStart(2,'0')).join('')}`;
    const closure:ReconcileOwnerIngressInput={reservationId:this.reservation.reservationId,holderId:this.reservation.holderId,
      expectedPolicyId:this.authority.ownerPolicy.policyId,expectedPolicyRevision:this.authority.ownerPolicy.revision,
      terminalEvidenceId:`ingress-block:${this.reservation.reservationId}`,measured,uncertain:{},now,
      certifiedClosure:{operationSetFingerprint:fingerprint,expiresAt:this.reservation.expiresAt}};
    const transfers=proven.map((link,index)=>{const p=this.authority.tenantAllocations.find(x=>x.effectivePolicy.tenantId===link.tenantId)?.effectivePolicy;
      return{tenantId:link.tenantId,expectedPolicyId:p?.policyId??'',expectedPolicyRevision:p?.revision??-1,
        expectedRestrictionRevision:p?.restrictionRevision??-1,operationId:`transfer-${index}`,envelope:OWNER_INGRESS_EXECUTION_ENVELOPE};});
    for(let attempt=0;attempt<MAX_OWNER_INGRESS_DELIVERY_ATTEMPTS;attempt++)try{const outcome=await this.coordinator.handoffIngressBatchFromTrustedAuthority({ownerClosure:closure,transfers,now});
      return outcome.status==='handed-off'||outcome.status==='already-handed-off'?'closed':'retained';}catch{}
    return'retained';
  }
}
class RequestAdmission implements OwnerIngressRequestAdmission{
  private offered?:string;private linked=false;private done?:Promise<'closed'|'retained'>;constructor(private block:IngressBlock){}
  tenantHandoff(tenantId:string,now:number){if(this.offered||!tenantId||tenantId.length>160||!this.block.offer(now))return undefined;this.offered=tenantId;
    return{envelope:OWNER_INGRESS_EXECUTION_ENVELOPE,closure:{reservationId:this.block.reservation.reservationId,holderId:this.block.reservation.holderId,
      expectedPolicyId:this.block.authority.ownerPolicy.policyId,expectedPolicyRevision:this.block.authority.ownerPolicy.revision,
      terminalEvidenceId:'pending-block',measured:{},uncertain:{},now}}}
  handoffToTenant(tenantId:string,authority?:BudgetCommitAuthority){const link=authority?.grant;if(this.linked||this.offered!==tenantId||link?.tenantId!==tenantId)return;this.linked=true;this.block.proof(link)}
  finish(now=this.block.clock()){return this.done??=this.block.complete(now)}
}
export class OwnerIngressAdmissionCache{
  private entries:Entry[]=[];inspectForTrustedRuntime(){return{bindings:this.entries.length,failedAdmissions:this.entries.reduce((s,e)=>s+e.failures,0),terminalFailures:this.entries.filter(e=>e.terminalFailure).length}}
  discardForTrustedRuntime(){this.entries=[]}
  async admit(input:{repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;purpose:BudgetPurpose;now?:()=>number}):Promise<OwnerIngressAdmissionResult>{
    const clock=input.now??Date.now;let entry=this.entries.find(e=>e.bindingIdentity===input.repository.bindingIdentity&&e.namespace===input.namespace&&e.purpose===input.purpose);
    if(!entry){if(this.entries.length>=MAX_OWNER_INGRESS_BINDINGS)return{status:'rejected',reason:'unavailable'};entry={bindingIdentity:input.repository.bindingIdentity,namespace:input.namespace,purpose:input.purpose,failures:0};this.entries.push(entry)}
    const now=clock();if(entry.terminalFailure==='exhausted'&&entry.retryAt!==undefined&&now>=entry.retryAt){entry.failures=0;entry.terminalFailure=undefined;entry.retryAt=undefined}
    if(entry.terminalFailure)return{status:'rejected',reason:entry.terminalFailure,...(entry.retryAt?{retryAt:entry.retryAt}:{})};
    if(entry.block)entry.block.bind(input.repository,input.namespace);
    if(entry.block?.available(now))return{status:'admitted',admission:entry.block.issue()};if(entry.block){await entry.block.settle(now);entry.block=undefined}
    if(!entry.pending)entry.pending=this.allocate(entry,input,clock);const pending=entry.pending,block=await pending;if(entry.pending===pending)entry.pending=undefined;
    if(!block)return{status:'rejected',reason:entry.terminalFailure??entry.lastFailure??'unavailable',...(entry.retryAt?{retryAt:entry.retryAt}:{})};entry.block=block;return{status:'admitted',admission:block.issue()};
  }
  private async allocate(entry:Entry,input:{repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;purpose:BudgetPurpose},clock:()=>number):Promise<IngressBlock|null>{
    const now=clock(),prior=entry.failures,authority=await input.repository.resolveForDeploymentIngress(now);if(!authority){this.failed(entry,'unavailable');return null}
    const envelope=scale(MAX_OWNER_INGRESS_BLOCK_OPERATIONS+prior),id=crypto.randomUUID(),coordinator=input.namespace.get(input.namespace.idFromName(authority.aggregateId))as unknown as BudgetCoordinatorDO;
    for(let attempt=0;attempt<2;attempt++)try{await coordinator.refreshFromTrustedAuthority(authority);const outcome=await coordinator.reserveIngressFromTrustedAuthority({
      holderId:`owner-ingress:${id}`,idempotencyKey:id,expectedPolicyId:authority.ownerPolicy.policyId,expectedPolicyRevision:authority.ownerPolicy.revision,purpose:input.purpose,envelope,now});
      if((outcome.status==='granted'||outcome.status==='idempotent')&&outcome.reservation){entry.failures=Math.max(0,entry.failures-prior);return new IngressBlock(coordinator,input.repository,authority,outcome.reservation,envelope,clock)}
      const retryAt=outcome.reason==='exhausted'?Math.max(...authority.ownerPolicy.budgets.filter(b=>OWNER_INGRESS_EXECUTION_ENVELOPE[b.dimension]!==undefined&&b.window.kind==='interval').map(b=>b.window.kind==='interval'?b.window.endsAt:now)):undefined;
      this.failed(entry,outcome.reason==='exhausted'?'exhausted':'unavailable',retryAt);return null;}catch{if(attempt===1){this.failed(entry,'unavailable');return null}}return null;
  }
  private failed(entry:Entry,reason:Failure,retryAt?:number){entry.failures++;entry.lastFailure=reason;if(reason==='exhausted'&&retryAt)entry.retryAt=retryAt;if(entry.failures>=MAX_OWNER_INGRESS_FAILED_ADMISSIONS)entry.terminalFailure=reason}
}
export const ownerIngressAdmissionCache=new OwnerIngressAdmissionCache();
