import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { SessionBudgetCredential } from './session-budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { budgetCommitConstraint, budgetGrantOperationStatements } from './budget-commit-fence';
import { ticketListPredicate, type TicketListPredicateOptions } from './ticket-list-predicate';
import { ticketListCurrentCredentialSql, ticketListScanAssertionSql, type TicketListScanSnapshot } from './ticket-list-scan.repository';
import { DEFAULT_SLA_CALENDAR } from '../domain/sla-clock';

export const SLA_QUEUE_INPUT_BYTES=4*1024*1024;
export type SlaQueueSelection=Omit<TicketListPredicateOptions,'viewer'|'scanFence'|'currentCredential'>;
export type SlaQueueMetadata=Readonly<{count:number;bytes:number;pauses:number;invalid:number}>;
export type SlaQueueCommit=Readonly<{stage:'metadata'|'snapshot';requestKey:string;authority:BudgetCommitAuthority;
 credential:SessionBudgetCredential;scan:TicketListScanSnapshot;selection:SlaQueueSelection;metadata?:SlaQueueMetadata}>;
export type SlaQueueRawRow=Readonly<{ticket_json:string;clock_json:string|null;priority_clock_json:string|null;pauses_json:string}>;
export class SlaQueueUnavailable extends Error {readonly code='sla_sort_unavailable';}

const latestSnippet=`(SELECT a.snippet FROM articles a WHERE a.tenant_id=tickets.tenant_id AND a.ticket_id=tickets.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1)`;
const latestSnippetBytes=`COALESCE((SELECT length(CAST(a.snippet AS BLOB)) FROM articles a WHERE a.tenant_id=tickets.tenant_id AND a.ticket_id=tickets.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1),0)`;
// Presentation is included in the admitted snapshot. No later ticket/snippet fetch is required.
const ticketJson=`json_object('id',tickets.id,'ticket_no',tickets.ticket_no,'subject',tickets.subject,
 'customer_email',tickets.customer_email,'status',tickets.status,'priority',tickets.priority,
 'priority_category',tickets.priority_category,'priority_scope',tickets.priority_scope,
 'priority_regulatory_officer_on_site',tickets.priority_regulatory_officer_on_site,
 'priority_vip_blocked',tickets.priority_vip_blocked,'priority_hard_deadline',tickets.priority_hard_deadline,
 'priority_score',tickets.priority_score,'contract_sla_tier',tickets.contract_sla_tier,
 'criticality_tier',tickets.criticality_tier,
 'assigned_to',tickets.assigned_to,'group_id',tickets.group_id,'source',tickets.source,
 'created_at',tickets.created_at,'updated_at',tickets.updated_at,'snippet',${latestSnippet})`;
const effectiveCalendar=`COALESCE(c.policy_calendar_json,p.calendar_json,?)`;
const clockJson=`CASE WHEN c.ticket_id IS NULL THEN NULL ELSE json_object(
 'ticket_id',c.ticket_id,'response_started_at',c.response_started_at,'response_completed_at',c.response_completed_at,
 'resolution_started_at',c.resolution_started_at,'resolution_completed_at',c.resolution_completed_at,
 'paused_at',c.paused_at,'pause_reason',c.pause_reason,'last_support_state_revision',c.last_support_state_revision,
 'revision',c.revision,'policy_revision',c.policy_revision,'effective_policy_revision',CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_revision ELSE p.revision END,'calendar_json',${effectiveCalendar},
 'response_target_ms',CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_response_target_ms ELSE p.response_target_ms END,
 'resolution_target_ms',CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_resolution_target_ms ELSE p.resolution_target_ms END,
 'response_reopen_policy',CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_response_reopen_policy ELSE p.response_reopen_policy END,
 'resolution_reopen_policy',CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_resolution_reopen_policy ELSE p.resolution_reopen_policy END,
 'handler_name',u.full_name) END`;
const priorityClockJson=`CASE WHEN pc.ticket_id IS NULL THEN NULL ELSE json_object(
 'ticket_id',pc.ticket_id,'started_at',pc.started_at,'active_since',pc.active_since,
 'accrued_active_ms',pc.accrued_active_ms,'stop_reason',pc.stop_reason,
 'last_support_state_revision',pc.last_support_state_revision,'revision',pc.revision,
 'updated_at',pc.updated_at) END`;
const boundedFields=['tickets.id','tickets.assigned_to','tickets.group_id'].map(field=>`length(CAST(COALESCE(${field},'') AS BLOB))<=256`)
 .concat(['tickets.created_at','tickets.updated_at','c.response_started_at','c.response_completed_at','c.resolution_started_at','c.resolution_completed_at','c.paused_at',
 'pc.started_at','pc.active_since','pc.updated_at']
 .map(field=>`length(CAST(COALESCE(${field},'') AS BLOB))<=64`)).concat(['tickets.ticket_no','tickets.status','tickets.priority','tickets.source',
 'tickets.priority_category','tickets.priority_scope','tickets.contract_sla_tier','tickets.priority_regulatory_officer_on_site',
 'tickets.priority_vip_blocked','tickets.priority_hard_deadline','tickets.priority_score','tickets.criticality_tier',
 'c.last_support_state_revision','c.revision','c.policy_revision','p.revision','c.policy_response_target_ms','c.policy_resolution_target_ms','p.response_target_ms','p.resolution_target_ms','c.policy_response_reopen_policy','c.policy_resolution_reopen_policy','c.pause_reason',
 'pc.accrued_active_ms','pc.stop_reason','pc.last_support_state_revision','pc.revision'].map(field=>`length(CAST(COALESCE(${field},'') AS BLOB))<=32`)).join(' AND ');
const aggregate=`SELECT count(*) AS count,COALESCE(sum(byte_bound),0) AS bytes,
 COALESCE(sum(pause_count),0) AS pauses,COALESCE(sum(invalid),0) AS invalid FROM metadata`;
const joins=`LEFT JOIN ticket_sla_clocks c ON c.tenant_id=tickets.tenant_id AND c.ticket_id=tickets.id
 LEFT JOIN ticket_priority_clocks pc ON pc.tenant_id=tickets.tenant_id AND pc.ticket_id=tickets.id
 LEFT JOIN sla_policies p ON p.tenant_id=tickets.tenant_id LEFT JOIN users u ON u.tenant_id=tickets.tenant_id AND u.id=tickets.assigned_to
 LEFT JOIN dashboard_sla_pause_read_counters counter ON counter.tenant_id=tickets.tenant_id AND counter.ticket_id=tickets.id`;
const textBytes=['tickets.ticket_no','tickets.id','tickets.subject','tickets.customer_email','tickets.status','tickets.priority',
 'tickets.priority_category','tickets.priority_scope','tickets.priority_regulatory_officer_on_site',
 'tickets.priority_vip_blocked','tickets.priority_hard_deadline','tickets.priority_score',
 'tickets.contract_sla_tier','tickets.criticality_tier',
 'tickets.assigned_to','tickets.group_id','tickets.source','tickets.created_at','tickets.updated_at']
 .map(field=>`length(CAST(COALESCE(${field},'') AS BLOB))`).join('+');
const clockValueBytes=['c.ticket_id','c.response_started_at','c.response_completed_at','c.resolution_started_at','c.resolution_completed_at','c.paused_at','c.pause_reason','c.last_support_state_revision','c.revision','c.policy_revision','p.revision','c.policy_response_target_ms','c.policy_resolution_target_ms','p.response_target_ms','p.resolution_target_ms','c.policy_response_reopen_policy','c.policy_resolution_reopen_policy','p.response_reopen_policy','p.resolution_reopen_policy'].map(field=>`length(CAST(COALESCE(${field},'') AS BLOB))`).join('+');
const priorityClockValueBytes=['pc.ticket_id','pc.started_at','pc.active_since','pc.accrued_active_ms','pc.stop_reason',
 'pc.last_support_state_revision','pc.revision','pc.updated_at'].map(field=>`length(CAST(COALESCE(${field},'') AS BLOB))`).join('+');


export class SlaPriorityQueueRepository {
 constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope){}
 private current(commit:SlaQueueCommit){
  const c=commit.credential;
  if(c.tenantId!==this.scope.tenantId||c.actorId!==this.scope.actorId||c.sessionVersion!==this.scope.authVersion||!this.scope.roles.includes(c.role)
   ||c.mfaVerified!==true||commit.authority.operationFingerprint!==commit.requestKey)throw new SlaQueueUnavailable('Authority mismatch');
  const current=ticketListCurrentCredentialSql(this.scope.tenantId,this.scope.actorId,c);
  const scan=ticketListScanAssertionSql(this.scope.tenantId,commit.scan),budget=budgetCommitConstraint(commit.authority,this.scope.tenantId);
  return{sql:`(${current.sql}) AND EXISTS (${scan.sql}) AND (${budget.sql})`,values:[...current.values,...scan.values,...budget.values]};
 }
 private async query(commit:SlaQueueCommit){
  const c=commit.credential,current=this.current(commit);
  const predicate=await ticketListPredicate(this.db,this.scope,{...commit.selection,viewer:{role:c.role,actorId:c.actorId},scanFence:commit.scan,currentCredential:c});
  const sql=`WITH eligible AS MATERIALIZED (SELECT tickets.tenant_id,tickets.id FROM tickets WHERE ${predicate.sql}),
 metadata AS MATERIALIZED (SELECT tickets.id,tickets.tenant_id,
 6*(${textBytes}+${latestSnippetBytes}+${clockValueBytes}+${priorityClockValueBytes}+length(CAST(${effectiveCalendar} AS BLOB))+length(CAST(COALESCE(u.full_name,'') AS BLOB)))+1024+832*COALESCE(counter.pause_rows_upper_bound,0) AS byte_bound,
 COALESCE(counter.pause_rows_upper_bound,0) AS pause_count,
 CASE WHEN ${boundedFields} AND length(CAST(COALESCE(u.full_name,'') AS BLOB))<=4096 AND length(CAST(${effectiveCalendar} AS BLOB))<=65536
 AND COALESCE(counter.pause_rows_upper_bound,0)<=4096 THEN 0 ELSE 1 END AS invalid
 FROM eligible JOIN tickets ON tickets.tenant_id=eligible.tenant_id AND tickets.id=eligible.id ${joins}), totals AS (${aggregate})`;
  return{sql,values:[...predicate.params,...Array(2).fill(JSON.stringify(DEFAULT_SLA_CALENDAR))],current};
 }
 private guard(commit:SlaQueueCommit,current:ReturnType<SlaPriorityQueueRepository['current']>){
  return this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN ${current.sql} THEN 1 ELSE 0 END)
   ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId,...current.values);
 }
 async metadata(commit:SlaQueueCommit):Promise<SlaQueueMetadata>{
  if(commit.stage!=='metadata')throw new SlaQueueUnavailable('Wrong stage');
  const q=await this.query(commit);
  const result=await this.db.batch([this.guard(commit,q.current),...budgetGrantOperationStatements(this.db,this.scope,commit.authority),this.db.prepare(`${q.sql} SELECT * FROM totals`).bind(...q.values)]);
  return this.check(result.at(-1)?.results[0]);
 }
 private check(value:unknown):SlaQueueMetadata{
  const row=value as SlaQueueMetadata|undefined;
  if(!row||![row.count,row.bytes,row.pauses,row.invalid].every(n=>Number.isSafeInteger(n)&&n>=0)||row.invalid||row.bytes>SLA_QUEUE_INPUT_BYTES)
   throw new SlaQueueUnavailable('Whole queue exceeds input bounds');
  return row;
 }
 async snapshot(commit:SlaQueueCommit):Promise<readonly SlaQueueRawRow[]>{
  if(commit.stage!=='snapshot'||!commit.metadata)throw new SlaQueueUnavailable('Wrong stage');
  const q=await this.query(commit),m=commit.metadata;
  const read=this.db.prepare(`${q.sql}, inputs AS MATERIALIZED (SELECT tickets.id,tickets.tenant_id,${ticketJson} AS ticket_json,${clockJson} AS clock_json,${priorityClockJson} AS priority_clock_json
   FROM eligible JOIN tickets ON tickets.tenant_id=eligible.tenant_id AND tickets.id=eligible.id ${joins} CROSS JOIN totals WHERE totals.invalid=0 AND totals.count<=? AND totals.bytes<=? AND totals.pauses<=?)
   SELECT inputs.ticket_json,inputs.clock_json,inputs.priority_clock_json,
   COALESCE((SELECT json_group_array(json(value)) FROM (SELECT CASE WHEN length(CAST(started_at AS BLOB))<=64 AND length(CAST(COALESCE(ended_at,'') AS BLOB))<=64
    THEN json_object('started_at',started_at,'ended_at',ended_at) ELSE json_object('invalid',1) END AS value
    FROM ticket_sla_pause_intervals pause WHERE pause.tenant_id=inputs.tenant_id AND pause.ticket_id=inputs.id ORDER BY started_at,ended_at LIMIT 4097)),'[]') AS pauses_json
   FROM inputs ORDER BY inputs.id`)
   .bind(...q.values,JSON.stringify(DEFAULT_SLA_CALENDAR),m.count,m.bytes,m.pauses);
  const result=await this.db.batch([this.guard(commit,q.current),this.db.prepare(`${q.sql} SELECT * FROM totals`).bind(...q.values),read]);
  const actual=this.check(result[1].results[0]);
  if(actual.count>m.count||actual.bytes>m.bytes||actual.pauses>m.pauses||result[2].results.length!==actual.count)throw new SlaQueueUnavailable('Queue changed during admission');
  // Completion journal is deliberately deferred until CPU evaluation and final visibility fencing.
  return result[2].results as unknown as SlaQueueRawRow[];
 }
 async complete(commit:SlaQueueCommit,ids:readonly string[]):Promise<void>{
  if(commit.stage!=='snapshot')throw new SlaQueueUnavailable('Wrong stage');
  const current=this.current(commit),c=commit.credential;
  const visible=`NOT EXISTS (SELECT 1 FROM json_each(?) ids WHERE NOT EXISTS (SELECT 1 FROM tickets t
   WHERE t.tenant_id=? AND t.id=ids.value AND (?<>'agent' OR t.group_id IS NULL OR EXISTS
   (SELECT 1 FROM user_groups g WHERE g.tenant_id=t.tenant_id AND g.user_id=? AND g.group_id=t.group_id))))`;
  await this.db.batch([this.guard(commit,{sql:`${current.sql} AND ${visible}`,values:[...current.values,JSON.stringify(ids),this.scope.tenantId,c.role,c.actorId]}),
   ...budgetGrantOperationStatements(this.db,this.scope,commit.authority)]);
 }
}
