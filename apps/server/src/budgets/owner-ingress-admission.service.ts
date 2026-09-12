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
export type OwnerIngressAdmissionResult=Readonly<{status:'disabled'}>|Readonly<{status:'rejected';reason:'exhausted'|'unavailable'|'unverified-limit';retryAt?:number}>|Readonly<{status:'admitted';admission:OwnerIngressRequestAdmission}>;
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
  private issued=0;private finished=0;private sealed=false;private settling?:Promise<'closed'|'retained'>;
  private slots:(NonNullable<BudgetCommitAuthority['grant']>|undefined)[]=[];
  constructor(readonly authority:TrustedBudgetCoordinatorAuthority,
    readonly reservation:NonNullable<Awaited<ReturnType<BudgetCoordinatorDO['reserveIngressFromTrustedAuthority']>>['reservation']>,
    readonly envelope:Readonly<ResourceAmounts>,readonly clock:()=>number,
    private readonly maxOperations=MAX_OWNER_INGRESS_BLOCK_OPERATIONS){}
  available(now:number){return !this.sealed&&this.issued<this.maxOperations&&now<this.reservation.expiresAt}
  issue(repository:BudgetAuthorityRepository,namespace:DurableObjectNamespace){
    if(!this.available(this.clock()))throw new Error('ingress block unavailable');
    const slot=this.issued++;this.slots.push(undefined);return new RequestAdmission(this,slot,repository,namespace)
  }
  offer(now:number){return !this.sealed&&Number.isSafeInteger(now)&&now>=0&&now<this.reservation.expiresAt}
  proof(slot:number,link:NonNullable<BudgetCommitAuthority['grant']>){if(!this.sealed&&slot<this.issued&&!this.slots[slot])this.slots[slot]=link}
  complete(now:number,repository:BudgetAuthorityRepository,namespace:DurableObjectNamespace){
    this.finished++;if(this.issued<this.maxOperations||this.finished<this.issued)return Promise.resolve('retained' as const);
    return this.retire(now,repository,namespace)
  }
  retire(now:number,repository:BudgetAuthorityRepository,namespace:DurableObjectNamespace){
    if(this.settling)return this.settling;
    // Irreversibly seal every issued slot before the first proof read. Rollover
    // and concurrent finishers therefore share exactly one bounded sequence.
    this.sealed=true;const snapshot=this.slots.slice(0,this.issued);
    const coordinator=namespace.get(namespace.idFromName(this.authority.aggregateId))as unknown as BudgetCoordinatorDO;
    return this.settling=this.settle(now,repository,coordinator,snapshot);
  }
  private async settle(now:number,repository:BudgetAuthorityRepository,coordinator:BudgetCoordinatorDO,
    snapshot:readonly (NonNullable<BudgetCommitAuthority['grant']>|undefined)[]):Promise<'closed'|'retained'>{
    if(!Number.isSafeInteger(now)||now<0||now>=this.reservation.expiresAt)return'retained';
    const proven:NonNullable<BudgetCommitAuthority['grant']>[]=[];
    for(const link of snapshot)if(link&&await repository.hasDurableGrantOperation(link))proven.push(link);
    let measured=this.envelope;for(const _ of proven)measured=subtract(measured,OWNER_INGRESS_EXECUTION_ENVELOPE);
    const fingerprint=`sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(
      JSON.stringify(proven.map(x=>[x.tenantId,x.reservationId,x.holderId,x.operationId]).sort()))))).map(x=>x.toString(16).padStart(2,'0')).join('')}`;
    const closure:ReconcileOwnerIngressInput={reservationId:this.reservation.reservationId,holderId:this.reservation.holderId,
      expectedPolicyId:this.authority.ownerPolicy.policyId,expectedPolicyRevision:this.authority.ownerPolicy.revision,
      terminalEvidenceId:`ingress-block:${this.reservation.reservationId}`,measured,uncertain:{},now,
      certifiedClosure:{operationSetFingerprint:fingerprint,expiresAt:this.reservation.expiresAt}};
    const transfers=proven.map((link,index)=>{const p=this.authority.tenantAllocations.find(x=>x.effectivePolicy.tenantId===link.tenantId)?.effectivePolicy;
      return{tenantId:link.tenantId,expectedPolicyId:p?.policyId??'',expectedPolicyRevision:p?.revision??-1,
        expectedRestrictionRevision:p?.restrictionRevision??-1,operationId:`transfer-${index}`,envelope:OWNER_INGRESS_EXECUTION_ENVELOPE,
        businessReservationId:link.reservationId,businessHolderId:link.holderId,prepaidOperationEnvelope:link.operationEnvelope};});
    for(let attempt=0;attempt<MAX_OWNER_INGRESS_DELIVERY_ATTEMPTS;attempt++)try{const outcome=await coordinator.handoffIngressBatchFromTrustedAuthority({ownerClosure:closure,transfers,now});
      return outcome.status==='handed-off'||outcome.status==='already-handed-off'?'closed':'retained';}catch{}
    return'retained';
  }
}
class RequestAdmission implements OwnerIngressRequestAdmission{
  private offered?:string;private linked=false;private done?:Promise<'closed'|'retained'>;
  constructor(private block:IngressBlock,private slot:number,private repository:BudgetAuthorityRepository,private namespace:DurableObjectNamespace){}
  tenantHandoff(tenantId:string,now:number){if(this.offered||!tenantId||tenantId.length>160||!this.block.offer(now))return undefined;this.offered=tenantId;
    return{envelope:OWNER_INGRESS_EXECUTION_ENVELOPE,closure:{reservationId:this.block.reservation.reservationId,holderId:this.block.reservation.holderId,
      expectedPolicyId:this.block.authority.ownerPolicy.policyId,expectedPolicyRevision:this.block.authority.ownerPolicy.revision,
      terminalEvidenceId:'pending-block',measured:{},uncertain:{},now}}}
  handoffToTenant(tenantId:string,authority?:BudgetCommitAuthority){const link=authority?.grant;if(this.linked||this.offered!==tenantId||link?.tenantId!==tenantId)return;this.linked=true;this.block.proof(this.slot,link)}
  finish(now=this.block.clock()){return this.done??=this.block.complete(now,this.repository,this.namespace)}
}
export class OwnerIngressAdmissionCache{
  private entries:Entry[]=[];inspectForTrustedRuntime(){return{bindings:this.entries.length,failedAdmissions:this.entries.reduce((s,e)=>s+e.failures,0),terminalFailures:this.entries.filter(e=>e.terminalFailure).length}}
  discardForTrustedRuntime(){this.entries=[]}
  async admit(input:{repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;purpose:BudgetPurpose;now?:()=>number}):Promise<OwnerIngressAdmissionResult>{
    const clock=input.now??Date.now;let entry=this.entries.find(e=>e.bindingIdentity===input.repository.bindingIdentity&&e.namespace===input.namespace&&e.purpose===input.purpose);
    if(!entry){if(this.entries.length>=MAX_OWNER_INGRESS_BINDINGS)return{status:'rejected',reason:'unavailable'};entry={bindingIdentity:input.repository.bindingIdentity,namespace:input.namespace,purpose:input.purpose,failures:0};this.entries.push(entry)}
    for(;;){
      const now=clock();if(entry.terminalFailure==='exhausted'&&entry.retryAt!==undefined&&now>=entry.retryAt){entry.failures=0;entry.terminalFailure=undefined;entry.retryAt=undefined}
      if(entry.terminalFailure)return{status:'rejected',reason:entry.terminalFailure,...(entry.retryAt?{retryAt:entry.retryAt}:{})};
      const current=entry.block;
      if(current?.available(now))return{status:'admitted',admission:current.issue(input.repository,input.namespace)};
      if(current){await current.retire(now,input.repository,input.namespace);if(entry.block===current)entry.block=undefined;continue}
      if(!entry.pending)entry.pending=this.allocate(entry,input,clock);const pending=entry.pending,block=await pending;if(entry.pending===pending)entry.pending=undefined;
      if(!block)return{status:'rejected',reason:entry.terminalFailure??entry.lastFailure??'unavailable',...(entry.retryAt?{retryAt:entry.retryAt}:{})};
      if(!entry.block)entry.block=block;
    }
  }
  /** Anonymous ingress never takes an isolate-local warm block. Each accepted
   * request obtains one reservation from the coordinator's atomic limiter. */
  async admitUnverified(input:{repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;purpose:BudgetPurpose;now?:()=>number;limit:number;windowMs:number}):Promise<OwnerIngressAdmissionResult>{
    const clock=input.now??Date.now,now=clock();
    try{
      const authority=await input.repository.resolveForDeploymentIngress(now);
      if(!authority)return{status:'rejected',reason:'unavailable'};
      const id=crypto.randomUUID(),coordinator=input.namespace.get(input.namespace.idFromName(authority.aggregateId))as unknown as BudgetCoordinatorDO;
      const request={authority,limit:input.limit,windowMs:input.windowMs,
        reservation:{holderId:`owner-ingress:${id}`,idempotencyKey:id,expectedPolicyId:authority.ownerPolicy.policyId,
          expectedPolicyRevision:authority.ownerPolicy.revision,purpose:input.purpose,envelope:OWNER_INGRESS_EXECUTION_ENVELOPE,now}};
      let outcome:Awaited<ReturnType<BudgetCoordinatorDO['reserveUnverifiedIngressFromTrustedAuthority']>>|undefined;
      for(let attempt=0;attempt<MAX_OWNER_INGRESS_DELIVERY_ATTEMPTS;attempt++)try{outcome=await coordinator.reserveUnverifiedIngressFromTrustedAuthority(request);break}catch{}
      if(!outcome)return{status:'rejected',reason:'unavailable'};
      if((outcome.status==='granted'||outcome.status==='idempotent')&&outcome.reservation){
        const block=new IngressBlock(authority,outcome.reservation,OWNER_INGRESS_EXECUTION_ENVELOPE,clock,1);
        return{status:'admitted',admission:block.issue(input.repository,input.namespace)};
      }
      const retryAt=outcome.reason==='exhausted'?Math.max(...authority.ownerPolicy.budgets.filter(b=>OWNER_INGRESS_EXECUTION_ENVELOPE[b.dimension]!==undefined&&b.window.kind==='interval').map(b=>b.window.kind==='interval'?b.window.endsAt:now)):undefined;
      return{status:'rejected',reason:outcome.reason==='unverified-limit'?'unverified-limit':outcome.reason==='exhausted'?'exhausted':'unavailable',...(retryAt?{retryAt}:{})};
    }catch{return{status:'rejected',reason:'unavailable'}}
  }
  private async allocate(entry:Entry,input:{repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;purpose:BudgetPurpose},clock:()=>number):Promise<IngressBlock|null>{
    const now=clock(),prior=entry.failures,authority=await input.repository.resolveForDeploymentIngress(now);if(!authority){this.failed(entry,'unavailable');return null}
    const envelope=scale(MAX_OWNER_INGRESS_BLOCK_OPERATIONS+prior),id=crypto.randomUUID(),coordinator=input.namespace.get(input.namespace.idFromName(authority.aggregateId))as unknown as BudgetCoordinatorDO;
    for(let attempt=0;attempt<2;attempt++)try{await coordinator.refreshFromTrustedAuthority(authority);const outcome=await coordinator.reserveIngressFromTrustedAuthority({
      holderId:`owner-ingress:${id}`,idempotencyKey:id,expectedPolicyId:authority.ownerPolicy.policyId,expectedPolicyRevision:authority.ownerPolicy.revision,purpose:input.purpose,envelope,now});
      if((outcome.status==='granted'||outcome.status==='idempotent')&&outcome.reservation){entry.failures=Math.max(0,entry.failures-prior);return new IngressBlock(authority,outcome.reservation,envelope,clock)}
      const retryAt=outcome.reason==='exhausted'?Math.max(...authority.ownerPolicy.budgets.filter(b=>OWNER_INGRESS_EXECUTION_ENVELOPE[b.dimension]!==undefined&&b.window.kind==='interval').map(b=>b.window.kind==='interval'?b.window.endsAt:now)):undefined;
      this.failed(entry,outcome.reason==='exhausted'?'exhausted':'unavailable',retryAt);return null;}catch{if(attempt===1){this.failed(entry,'unavailable');return null}}return null;
  }
  private failed(entry:Entry,reason:Failure,retryAt?:number){entry.failures++;entry.lastFailure=reason;if(reason==='exhausted'&&retryAt)entry.retryAt=retryAt;if(entry.failures>=MAX_OWNER_INGRESS_FAILED_ADMISSIONS)entry.terminalFailure=reason}
}
export const ownerIngressAdmissionCache=new OwnerIngressAdmissionCache();
