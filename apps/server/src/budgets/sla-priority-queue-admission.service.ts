import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import { SignJWT, jwtVerify } from 'jose';
import { assertConversationResponseBounds } from '../services/conversation-read-bounds';
import type { VerifiedTenantScope } from '../types/tenant';
import type { Ticket } from '../types';
import type { TicketSlaProjection } from '../types/sla';
import { SessionBudgetAdmissionService } from './session-admission.service';
import type { BudgetCommitAuthority } from './isolate-admission.service';
import { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import { TicketListScanRepository, type TicketListScanSnapshot } from '../repositories/ticket-list-scan.repository';
import { ticketListEnvelope } from './http-ticket-list-admission.service';
import { SlaPriorityQueueRepository,SlaQueueUnavailable,SLA_QUEUE_INPUT_BYTES,type SlaQueueSelection,type SlaQueueCommit,type SlaQueueMetadata } from '../repositories/sla-priority-queue.repository';
import { projectDashboardSlaRows,type SlaMainRow } from '../repositories/dashboard-summary-read.repository';
import { SlaEvaluationMeter } from '../domain/sla-clock';

/** Candidate-only ceiling: deterministic work units, not billed CPU or production clearance. */
export const SLA_QUEUE_CANDIDATE_WORK=12_000_000;
export class SlaQueueRestart extends Error {readonly code='sla_sort_restart';}
export type SlaQueueItem=Readonly<{ticket:Ticket & {snippet:string|null};sla:TicketSlaProjection|null;deadline:number|null}>;
export type SlaQueuePage=Readonly<{data:readonly SlaQueueItem[];total:number;page:number;asOf:string;next:string|null}>;
const selectionKeys=['customerEmail','filterId','status','priority','assignedTo','groupId','ticketNo','search','queue','draftNotExpiredAt'];
async function hash(raw:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),n=>n.toString(16).padStart(2,'0')).join('');}
function safeTotal(...values:number[]){let total=0;for(const n of values){if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(total+n))throw new SlaQueueUnavailable('Unsafe read bound');total+=n;}return total;}
export function slaQueueEnvelope(scan:TicketListScanSnapshot,selection:SlaQueueSelection,groupRestricted:boolean,metadata?:SlaQueueMetadata):ResourceAmounts{
 const base=ticketListEnvelope(scan,{search:selection.search,queue:selection.queue,groupRestricted});
 if(!base)throw new SlaQueueUnavailable('Invalid list bound');
 // Metadata inspects calendar and latest-snippet lengths before their selected bytes are known.
 // Reserve64KiB per tenant calendar plus the maintained complete article byte upper bound.
 const extra=metadata?safeTotal(48*scan.ticketRows,8*metadata.pauses,Math.ceil(4*metadata.bytes/256),1024)
  :safeTotal(32*scan.ticketRows,Math.ceil(4*65536*scan.ticketRows/256),Math.ceil(2*scan.articleSearchBytes/256),1024);
 return Object.freeze({...base,workerRequests:1,d1RowsRead:safeTotal(base.d1RowsRead??0,extra),d1RowsWritten:16});
}
function ordered(items:readonly SlaQueueItem[],meter:SlaEvaluationMeter):SlaQueueItem[]{
 meter.charge(items.length);
 if(items.length<2)return [...items];
 let runs=items.map(item=>[item]);const ranks={urgent:0,high:1,normal:2,low:3};
 const compare=(a:SlaQueueItem,b:SlaQueueItem)=>{meter.charge();return (a.deadline??Infinity)-(b.deadline??Infinity)
  ||ranks[a.ticket.priority]-ranks[b.ticket.priority]||Date.parse(a.ticket.created_at)-Date.parse(b.ticket.created_at)
  ||(a.ticket.id<b.ticket.id?-1:a.ticket.id>b.ticket.id?1:0);};
 while(runs.length>1){const next:SlaQueueItem[][]=[];for(let r=0;r<runs.length;r+=2){const left=runs[r],right=runs[r+1];if(!right){next.push(left);continue;}
  const out:SlaQueueItem[]=[];let i=0,j=0;while(i<left.length&&j<right.length)out.push(compare(left[i],right[j])<=0?left[i++]:right[j++]);
  meter.charge(left.length-i+right.length-j);out.push(...left.slice(i),...right.slice(j));next.push(out);}runs=next;}return runs[0];
}

/** Request-scoped, currently unmounted candidate backend. Call finish only after constructing the response. */
export class SlaPriorityQueueService{
 private winner?:SlaQueuePage;private finalAuthority?:BudgetCommitAuthority;private finished=false;private started=false;
 constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope,private readonly credential:SessionBudgetCredential,
  private readonly budget:{service:SessionBudgetAdmissionService;repository:BudgetAuthorityRepository;namespace:DurableObjectNamespace;secret:string;now:()=>number;
   settle:(authority:BudgetCommitAuthority,outcome:'committed'|'unknown',now:number)=>void},private readonly repository=new SlaPriorityQueueRepository(db,scope)){}
 finish(page?:SlaQueuePage){if(this.finished)return;this.finished=true;if(this.finalAuthority)this.budget.settle(this.finalAuthority,page!==undefined&&page===this.winner?'committed':'unknown',this.budget.now());}
 private async admit(stage:'metadata'|'snapshot',scan:TicketListScanSnapshot,selection:SlaQueueSelection,metadata?:SlaQueueMetadata):Promise<SlaQueueCommit>{
  const requestKey=await hash(JSON.stringify([stage,this.scope.tenantId,this.scope.actorId,scan,selection,metadata]));
  const result=await this.budget.service.admit({database:this.db,repository:this.budget.repository,sessions:new SessionBudgetAuthorityRepository(this.db,this.scope),
   namespace:this.budget.namespace,scope:this.scope,credential:this.credential,requirements:{},
   intent:{operationId:crypto.randomUUID(),operationFingerprint:requestKey,workScopeKey:'dashboard.sla-queue.'+stage},
   business:slaQueueEnvelope(scan,selection,this.credential.role==='agent',metadata),now:this.budget.now});
  if((result.status!=='spent'&&result.status!=='idempotent')||!result.commitAuthority)throw new SlaQueueUnavailable('Queue capacity unavailable');
  return Object.freeze({stage,requestKey,authority:result.commitAuthority,credential:this.credential,scan,selection,metadata});
 }
 async read(input:SlaQueueSelection,options:{limit?:number;cursor?:string}={}):Promise<SlaQueuePage>{
  if(this.started)throw new SlaQueueUnavailable('Request already started');this.started=true;
  let selection:SlaQueueSelection=Object.freeze(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a<b?-1:1)));
  if(Object.entries(selection).some(([key,value])=>!selectionKeys.includes(key)||typeof value!=='string'||value.length>1024))throw new SlaQueueUnavailable('Invalid queue selection');
  const limit=options.limit??50;if(!Number.isInteger(limit)||limit<1||limit>50)throw new SlaQueueUnavailable('Invalid page size');
  const now=this.budget.now(),secret=new TextEncoder().encode(this.budget.secret),selectionHash=await hash(JSON.stringify({...selection,...(selection.draftNotExpiredAt?{draftNotExpiredAt:'cursor-asOf'}:{})}));
  if(secret.byteLength<32)throw new SlaQueueUnavailable('Cursor signing unavailable');
  let asOf=now,offset=0,expectedDigest:string|undefined;
  if(options.cursor){
   if(options.cursor.length>2048)throw new SlaQueueRestart('Restart expired or changed queue');
   try{const {payload}=await jwtVerify(options.cursor,secret,{algorithms:['HS256'],audience:'sla-priority-queue-v1',currentDate:new Date(now)});
    if(payload.sub!==this.scope.actorId||payload.tenant!==this.scope.tenantId||payload.session!==this.credential.sessionVersion||payload.selection!==selectionHash||payload.limit!==limit
     ||!Number.isSafeInteger(payload.asOf)||!Number.isSafeInteger(payload.offset)||typeof payload.digest!=='string'||payload.digest.length!==64)throw new Error('Invalid cursor');
    asOf=payload.asOf as number;offset=payload.offset as number;expectedDigest=payload.digest;
    if(asOf>now||now-asOf>=30000||offset<0)throw new Error('Expired cursor');
   }catch{throw new SlaQueueRestart('Restart expired or changed queue');}
  }
  if(selection.draftNotExpiredAt)selection=Object.freeze({...selection,draftNotExpiredAt:new Date(asOf).toISOString()});
  const sessions=new SessionBudgetAuthorityRepository(this.db,this.scope);
  if(!await sessions.authorize(this.credential,{},now))throw new SlaQueueUnavailable('Current credential unavailable');
  const scan=await new TicketListScanRepository(this.db,this.scope).snapshot(selection.filterId);
  const meter=new SlaEvaluationMeter(SLA_QUEUE_CANDIDATE_WORK);
  if((scan.filter?.conditionBytes??0)>65536)meter.exhaust();meter.charge(Math.ceil((scan.filter?.conditionBytes??0)/64));
  const discovery=await this.admit('metadata',scan,selection);let metadata:SlaQueueMetadata;
  try{metadata=await this.repository.metadata(discovery);this.budget.settle(discovery.authority,'committed',this.budget.now());}
  catch(error){this.budget.settle(discovery.authority,'unknown',this.budget.now());throw error;}
  const final=await this.admit('snapshot',scan,selection,metadata);this.finalAuthority=final.authority;
  try{
   const raw=await this.repository.snapshot(final);let bytes=0;
   for(const row of raw){meter.charge();for(const text of [row.ticket_json,row.clock_json??'',row.pauses_json]){
    if(text.length>SLA_QUEUE_INPUT_BYTES)meter.exhaust();meter.charge(Math.ceil(text.length/64));bytes+=new TextEncoder().encode(text).byteLength;if(bytes>SLA_QUEUE_INPUT_BYTES)meter.exhaust();}}
   meter.charge(Math.ceil(6*bytes/64)+raw.length);
   const digest=await hash(JSON.stringify([scan.filter??null,raw]));if(expectedDigest&&digest!==expectedDigest)throw new SlaQueueRestart('Queue changed; restart pagination');
   const items:SlaQueueItem[]=raw.map(row=>{meter.charge();const ticket=JSON.parse(row.ticket_json) as Ticket & {snippet:string|null};
    if(!Number.isFinite(Date.parse(ticket.created_at))||!['low','normal','high','urgent'].includes(ticket.priority))throw new SlaQueueUnavailable('Invalid ticket sort key');
    const pauses=JSON.parse(row.pauses_json) as Array<{started_at:string;ended_at:string|null;invalid?:number}>;
    meter.charge(pauses.length);
    if(pauses.length>4096||pauses.some(pause=>pause.invalid||!Number.isFinite(Date.parse(pause.started_at))||(pause.ended_at!==null&&!Number.isFinite(Date.parse(pause.ended_at)))))throw new SlaQueueUnavailable('Invalid complete pause history');
    const sla=row.clock_json?projectDashboardSlaRows({main:JSON.parse(row.clock_json) as SlaMainRow,pauses},new Date(asOf),meter):null;
    const deadlines=sla?[sla.response,sla.resolution].filter(target=>target.phase==='running'&&target.dueAt!==null).map(target=>Date.parse(target.dueAt!)):[];
    if(deadlines.some(value=>!Number.isFinite(value)))throw new SlaQueueUnavailable('Invalid deadline');
    return{ticket,sla,deadline:deadlines.length?Math.min(...deadlines):null};});
   const sorted=ordered(items,meter);if(offset>sorted.length)throw new SlaQueueRestart('Queue changed; restart pagination');
   const nextOffset=offset+limit;
   const next=nextOffset<sorted.length?await new SignJWT({tenant:this.scope.tenantId,session:this.credential.sessionVersion,selection:selectionHash,asOf,offset:nextOffset,digest,limit})
    .setProtectedHeader({alg:'HS256'}).setAudience('sla-priority-queue-v1').setSubject(this.scope.actorId).setExpirationTime(Math.floor((asOf+30000)/1000)).sign(secret):null;
   meter.charge(Math.min(limit,sorted.length-offset));
   const page=Object.freeze({data:sorted.slice(offset,nextOffset),total:sorted.length,page:Math.floor(offset/limit)+1,asOf:new Date(asOf).toISOString(),next});
   meter.charge(Math.ceil(6*bytes/64)+limit);
   assertConversationResponseBounds(page);
   // Recheck all snapshot IDs: lost visibility aborts the whole page rather than silently removing rows.
   meter.charge(items.length+Math.ceil(256*items.length/64));
   await this.repository.complete(final,items.map(item=>item.ticket.id));this.winner=page;return page;
  }catch(error){this.finish();throw error;}
 }
}
