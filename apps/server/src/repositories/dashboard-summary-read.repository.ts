import type { D1Database,D1PreparedStatement } from '@cloudflare/workers-types';
import { arrayBufferToBase64,base64ToArrayBuffer } from '../utils/encoding';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { SessionBudgetCredential } from './session-budget-authority.repository';
import type { VerifiedTenantScope } from '../types/tenant';
import type { SupportStateDefinition,TicketSupportState } from '../types/support-state';
import { budgetCommitConstraint,budgetGrantOperationStatements } from './budget-commit-fence';
import { DEFAULT_SLA_CALENDAR, type SlaPauseInterval } from '../domain/sla-clock';
import { projectSlaClock } from './sla-clock.repository';
import type { TicketSlaClock, TicketSlaProjection } from '../types/sla';

export type DashboardSummaryReadOperation='dashboard.stats.read'|'dashboard.support-states.read'|'dashboard.sla-policy.read'
  |'dashboard.ticket.support-state.read'|'dashboard.ticket.sla.read'|'dashboard.ticket.sla-batch.read'
  |'dashboard.ticket.reply-capability.read';
export type DashboardSummaryReadTarget=Readonly<{limit?:number;cursor?:string|null;includeInactive?:boolean;
  ticketId?:string;ticketIds?:readonly string[]}>;
export type DashboardStatsSnapshot=Readonly<{kind:'stats';ticketRows:number;userRows:number;groupRows:number}>;
export type DashboardPolicySnapshot=Readonly<{kind:'policy';calendarBytes:number}>;
export type DashboardTicketSnapshot=Readonly<{ticketId:string;pauseRows:number;calendarBytes:number;handlerBytes:number}>;
export type DashboardSlaSnapshot=Readonly<{kind:'sla';tickets:readonly DashboardTicketSnapshot[]}>;
export type DashboardSummaryReadSnapshot=DashboardStatsSnapshot|DashboardPolicySnapshot|DashboardSlaSnapshot|undefined;
export type DashboardSummaryReadCommit=Readonly<{operation:DashboardSummaryReadOperation;requestKey:string;
  target:DashboardSummaryReadTarget;credential:SessionBudgetCredential;snapshot:DashboardSummaryReadSnapshot;authority:BudgetCommitAuthority}>;

export class DashboardSummaryReadFenceError extends Error {}

type Constraint=Readonly<{sql:string;values:unknown[]}>;
export type SlaMainRow=Readonly<Record<string,unknown>&{ticket_id:string;handler_name:string|null;calendar_json:string|null;
  response_started_at:string;response_completed_at:string|null;resolution_started_at:string;resolution_completed_at:string|null;
  paused_at:string|null;pause_reason:'waiting'|null;last_support_state_revision:number;revision:number;
  response_target_ms:number|null;resolution_target_ms:number|null;response_reopen_policy:string|null;
  resolution_reopen_policy:string|null;policy_revision:number}>;
export type DashboardSlaRows=Readonly<{main:SlaMainRow;pauses:readonly {started_at:string;ended_at:string|null}[]}>;

/** Evaluates the accepted clock semantics after the atomic read fence returns the complete pause history. */
export function projectDashboardSlaRows(rows: DashboardSlaRows, now = new Date()): TicketSlaProjection {
  const clock: TicketSlaClock = { ticketId: rows.main.ticket_id, responseStartedAt: rows.main.response_started_at,
    responseCompletedAt: rows.main.response_completed_at, resolutionStartedAt: rows.main.resolution_started_at,
    resolutionCompletedAt: rows.main.resolution_completed_at, pausedAt: rows.main.paused_at, pauseReason: rows.main.pause_reason,
    supportStateRevision: rows.main.last_support_state_revision, revision: rows.main.revision, policyRevision: rows.main.policy_revision,
    policyCalendarJson: rows.main.calendar_json, policyResponseTargetMs: rows.main.response_target_ms,
    policyResolutionTargetMs: rows.main.resolution_target_ms,
    policyResponseReopenPolicy: rows.main.response_reopen_policy === 'restart' ? 'restart' : 'continue',
    policyResolutionReopenPolicy: rows.main.resolution_reopen_policy === 'restart' ? 'restart' : 'continue' };
  const pauses: SlaPauseInterval[] = rows.pauses.map(pause => ({ startsAt: new Date(pause.started_at), endsAt: new Date(pause.ended_at ?? now.toISOString()) }));
  return projectSlaClock(clock, { calendar: DEFAULT_SLA_CALENDAR, responseTargetMs: null, resolutionTargetMs: null,
    reopenPolicy: { response: 'continue', resolution: 'continue' }, revision: 0 }, pauses, rows.main.handler_name, now);
}

const cursorVersion=1;
const maxCursorLength=1024;
function decodeCursor(value:string):{compatibility:number;label:string;id:string}{
  try{
    if(value.length>maxCursorLength||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('invalid');
    const padded=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4);
    const decoded=JSON.parse(new TextDecoder().decode(base64ToArrayBuffer(padded))) as Record<string,unknown>;
    if(decoded.v!==cursorVersion||!Number.isInteger(decoded.compatibility)||(decoded.compatibility!==0&&decoded.compatibility!==1)
      ||typeof decoded.label!=='string'||typeof decoded.id!=='string'||!decoded.label||!decoded.id
      ||decoded.label.length>120||decoded.id.length>120)throw new Error('invalid');
    return {compatibility:decoded.compatibility,label:decoded.label,id:decoded.id};
  }catch{throw new Error('invalid_support_state_cursor');}
}
function encodeCursor(value:{compatibility:number;label:string;id:string}):string{
  return arrayBufferToBase64(new TextEncoder().encode(JSON.stringify({v:cursorVersion,...value})))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function checked(value:unknown):number{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new DashboardSummaryReadFenceError('Invalid read population');
  return value;
}

export class DashboardSummaryReadRepository{
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope){}

  async snapshot(operation:DashboardSummaryReadOperation,target:DashboardSummaryReadTarget):Promise<DashboardSummaryReadSnapshot>{
    if(operation==='dashboard.stats.read'){
      const [tickets,directory]=await this.db.batch([
        this.db.prepare('SELECT ticket_rows FROM ticket_list_scan_counters WHERE tenant_id=?').bind(this.scope.tenantId),
        this.db.prepare('SELECT user_count,group_count FROM group_directory_tenant_population WHERE tenant_id=?').bind(this.scope.tenantId),
      ]);
      const ticket=tickets.results[0] as {ticket_rows:number}|undefined;
      const row=directory.results[0] as {user_count:number;group_count:number}|undefined;
      return {kind:'stats',ticketRows:checked(ticket?.ticket_rows??0),userRows:checked(row?.user_count??0),groupRows:checked(row?.group_count??0)};
    }
    if(operation==='dashboard.sla-policy.read'){
      const row=await this.db.prepare('SELECT length(CAST(calendar_json AS BLOB)) AS bytes FROM sla_policies WHERE tenant_id=?')
        .bind(this.scope.tenantId).first<{bytes:number}>();
      return {kind:'policy',calendarBytes:checked(row?.bytes??0)};
    }
    if(operation==='dashboard.ticket.sla.read'||operation==='dashboard.ticket.sla-batch.read'){
      const ids=operation==='dashboard.ticket.sla.read'?[target.ticketId!]:[...new Set(target.ticketIds??[])];
      if(!ids.length)return {kind:'sla',tickets:[]};
      const rows=await this.db.batch(ids.map(id=>this.db.prepare(`SELECT ? AS ticket_id,
        COALESCE((SELECT pause_rows_upper_bound FROM dashboard_sla_pause_read_counters WHERE tenant_id=? AND ticket_id=?),0) AS pause_rows,
        COALESCE((SELECT length(CAST(COALESCE(c.policy_calendar_json,p.calendar_json,'') AS BLOB)) FROM ticket_sla_clocks c
          LEFT JOIN sla_policies p ON p.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.ticket_id=?),0) AS calendar_bytes,
        COALESCE((SELECT length(CAST(COALESCE(u.full_name,'') AS BLOB)) FROM tickets t LEFT JOIN users u
          ON u.tenant_id=t.tenant_id AND u.id=t.assigned_to WHERE t.tenant_id=? AND t.id=?),0) AS handler_bytes`)
        .bind(id,this.scope.tenantId,id,this.scope.tenantId,id,this.scope.tenantId,id)));
      return {kind:'sla',tickets:rows.map((result,index)=>{
        const row=result.results[0] as {ticket_id:string;pause_rows:number;calendar_bytes:number;handler_bytes:number}|undefined;
        return {ticketId:ids[index],pauseRows:checked(row?.pause_rows??0),calendarBytes:checked(row?.calendar_bytes??0),handlerBytes:checked(row?.handler_bytes??0)};
      })};
    }
    return undefined;
  }

  private authority(commit:DashboardSummaryReadCommit,operation:DashboardSummaryReadOperation,target:DashboardSummaryReadTarget):Constraint{
    const c=commit.credential;
    const valid=commit.operation===operation&&JSON.stringify(commit.target)===JSON.stringify(target)
      &&commit.requestKey===commit.authority.operationFingerprint&&c.tenantId===this.scope.tenantId&&c.actorId===this.scope.actorId
      &&this.scope.roles.includes(c.role)&&c.sessionVersion===this.scope.authVersion&&c.mfaVerified===true
      &&Number.isSafeInteger(c.sessionVersion)&&Number.isSafeInteger(c.expiresAt)&&commit.authority.operationId.length>0;
    const budget=budgetCommitConstraint(commit.authority,this.scope.tenantId);
    const sql=[`?=1`,`EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=? AND mfa_enabled=1 AND ?>unixepoch())`,budget.sql];
    const values:unknown[]=[valid?1:0,this.scope.tenantId,c.actorId,c.role,c.sessionVersion,c.expiresAt,...budget.values];
    if(operation==='dashboard.stats.read'){
      const s=commit.snapshot as DashboardStatsSnapshot|undefined;
      if(!s||s.kind!=='stats')sql.push('0');
      else{
        sql.push('COALESCE((SELECT ticket_rows FROM ticket_list_scan_counters WHERE tenant_id=?),0)<=?');values.push(this.scope.tenantId,s.ticketRows);
        sql.push('COALESCE((SELECT user_count FROM group_directory_tenant_population WHERE tenant_id=?),0)<=?');values.push(this.scope.tenantId,s.userRows);
        sql.push('COALESCE((SELECT group_count FROM group_directory_tenant_population WHERE tenant_id=?),0)<=?');values.push(this.scope.tenantId,s.groupRows);
      }
    }else if(operation==='dashboard.sla-policy.read'){
      const s=commit.snapshot as DashboardPolicySnapshot|undefined;
      if(!s||s.kind!=='policy')sql.push('0');
      else{sql.push('COALESCE((SELECT length(CAST(calendar_json AS BLOB)) FROM sla_policies WHERE tenant_id=?),0)<=?');values.push(this.scope.tenantId,s.calendarBytes);}
    }else if(operation==='dashboard.ticket.sla.read'||operation==='dashboard.ticket.sla-batch.read'){
      const s=commit.snapshot as DashboardSlaSnapshot|undefined;
      if(!s||s.kind!=='sla')sql.push('0');
      else for(const item of s.tickets){
        sql.push('COALESCE((SELECT pause_rows_upper_bound FROM dashboard_sla_pause_read_counters WHERE tenant_id=? AND ticket_id=?),0)<=?');
        values.push(this.scope.tenantId,item.ticketId,item.pauseRows);
        sql.push(`COALESCE((SELECT length(CAST(COALESCE(c.policy_calendar_json,p.calendar_json,'') AS BLOB)) FROM ticket_sla_clocks c
          LEFT JOIN sla_policies p ON p.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.ticket_id=?),0)<=?`);
        values.push(this.scope.tenantId,item.ticketId,item.calendarBytes);
        sql.push(`COALESCE((SELECT length(CAST(COALESCE(u.full_name,'') AS BLOB)) FROM tickets t LEFT JOIN users u
          ON u.tenant_id=t.tenant_id AND u.id=t.assigned_to WHERE t.tenant_id=? AND t.id=?),0)<=?`);
        values.push(this.scope.tenantId,item.ticketId,item.handlerBytes);
      }
    }else if(commit.snapshot!==undefined)sql.push('0');
    return {sql:sql.join(' AND '),values};
  }

  private async batch(commit:DashboardSummaryReadCommit,operation:DashboardSummaryReadOperation,target:DashboardSummaryReadTarget,
    statements:readonly D1PreparedStatement[]){
    const authority=this.authority(commit,operation,target);
    const guard=this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN ${authority.sql} THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId,...authority.values);
    try{
      const results=await this.db.batch([guard,...budgetGrantOperationStatements(this.db,this.scope,commit.authority),...statements,
        this.db.prepare('SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?').bind(this.scope.tenantId)]);
      const accepted=results.at(-1)?.results?.[0] as {accepted?:number}|undefined;
      if(accepted?.accepted!==1)throw new DashboardSummaryReadFenceError('Dashboard read authority changed');
      return results;
    }
    catch{throw new DashboardSummaryReadFenceError('Dashboard read authority changed');}
  }

  private admitted(alias='a'):string{return `EXISTS (SELECT 1 FROM budget_mutation_assertion ${alias} WHERE ${alias}.tenant_id=? AND ${alias}.accepted=1)`;}
  private staffTicket(alias:string):string{return `EXISTS (SELECT 1 FROM users actor WHERE actor.tenant_id=${alias}.tenant_id
    AND actor.id=? AND actor.role=? AND actor.session_version=? AND actor.mfa_enabled=1
    AND (actor.role<>'agent' OR ${alias}.group_id IS NULL OR EXISTS (SELECT 1 FROM user_groups membership
      WHERE membership.tenant_id=${alias}.tenant_id AND membership.user_id=actor.id AND membership.group_id=${alias}.group_id)))`;}
  private ticketValues(commit:DashboardSummaryReadCommit):unknown[]{const c=commit.credential;return[c.actorId,c.role,c.sessionVersion];}

  async stats(commit:DashboardSummaryReadCommit){
    const target={};const admitted=this.admitted();
    const result=await this.batch(commit,'dashboard.stats.read',target,[
      this.db.prepare(`SELECT status,COUNT(*) AS count FROM tickets WHERE tenant_id=? AND ${admitted} GROUP BY status`).bind(this.scope.tenantId,this.scope.tenantId),
      this.db.prepare(`SELECT priority,COUNT(*) AS count FROM tickets WHERE tenant_id=? AND ${admitted} GROUP BY priority`).bind(this.scope.tenantId,this.scope.tenantId),
      this.db.prepare(`SELECT COALESCE(user_count,0) AS count FROM group_directory_tenant_population WHERE tenant_id=? AND ${admitted}`).bind(this.scope.tenantId,this.scope.tenantId),
      this.db.prepare(`SELECT COALESCE(group_count,0) AS count FROM group_directory_tenant_population WHERE tenant_id=? AND ${admitted}`).bind(this.scope.tenantId,this.scope.tenantId),
    ]);
    return {ticketsByStatus:result[3].results??[],ticketsByPriority:result[4].results??[],
      totalUsers:(result[5].results?.[0] as {count:number}|undefined)?.count??0,totalGroups:(result[6].results?.[0] as {count:number}|undefined)?.count??0};
  }

  async supportStates(target:{limit:number;cursor:string|null;includeInactive:boolean},commit:DashboardSummaryReadCommit){
    if(!Number.isInteger(target.limit)||target.limit<1||target.limit>100)throw new Error('invalid_support_state_page');
    const decoded=target.cursor?decodeCursor(target.cursor):null;
    const active=target.includeInactive?'':'AND is_active=1';
    const after=decoded?`AND (is_compatibility_default<? OR (is_compatibility_default=? AND
      (internal_label COLLATE NOCASE>? OR (internal_label COLLATE NOCASE=? AND id>?))))`:'';
    const values:unknown[]=decoded?[this.scope.tenantId,decoded.compatibility,decoded.compatibility,decoded.label,decoded.label,decoded.id]
      :[this.scope.tenantId];
    const rows=await this.batch(commit,'dashboard.support-states.read',target,[this.db.prepare(`SELECT * FROM support_state_definitions
      WHERE tenant_id=? ${active} ${after} AND ${this.admitted()} ORDER BY is_compatibility_default DESC,internal_label COLLATE NOCASE,id LIMIT ?`)
      .bind(...values,this.scope.tenantId,target.limit+1)]);
    const all=(rows[3].results??[]) as SupportStateDefinition[];const hasMore=all.length>target.limit;const results=all.slice(0,target.limit);const last=results.at(-1);
    return {results,nextCursor:hasMore&&last?encodeCursor({compatibility:last.is_compatibility_default,label:last.internal_label,id:last.id}):null};
  }

  async policy(commit:DashboardSummaryReadCommit):Promise<Record<string,unknown>>{
    const rows=await this.batch(commit,'dashboard.sla-policy.read',{},[this.db.prepare(`SELECT * FROM sla_policies WHERE tenant_id=? AND ${this.admitted()}`)
      .bind(this.scope.tenantId,this.scope.tenantId)]);
    const row=rows[3].results?.[0] as {calendar_json:string;response_target_ms:number|null;resolution_target_ms:number|null;
      response_reopen_policy:'continue'|'restart';resolution_reopen_policy:'continue'|'restart';revision:number}|undefined;
    if(!row)return {calendar:DEFAULT_SLA_CALENDAR,responseTargetMs:null,resolutionTargetMs:null,
      reopenPolicy:{response:'continue',resolution:'continue'},revision:0};
    return {calendar:JSON.parse(row.calendar_json),responseTargetMs:row.response_target_ms,resolutionTargetMs:row.resolution_target_ms,
      reopenPolicy:{response:row.response_reopen_policy,resolution:row.resolution_reopen_policy},revision:row.revision};
  }

  async ticketSupportState(ticketId:string,commit:DashboardSummaryReadCommit):Promise<TicketSupportState|null>{
    const target={ticketId},c=commit.credential;
    const rows=await this.batch(commit,'dashboard.ticket.support-state.read',target,[this.db.prepare(`SELECT s.ticket_id,s.definition_id,d.legacy_status AS lifecycle,
      d.internal_label,d.public_label,s.waiting_reason,s.next_action,s.changed_at,s.revision
      FROM tickets t JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
      JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
      WHERE t.tenant_id=? AND t.id=? AND ${this.staffTicket('t')} AND ${this.admitted()}`)
      .bind(this.scope.tenantId,ticketId,...this.ticketValues(commit),this.scope.tenantId)]);
    return (rows[3].results?.[0] as TicketSupportState|undefined)??null;
  }

  async sla(target:{ticketIds:readonly string[]},operation:'dashboard.ticket.sla.read'|'dashboard.ticket.sla-batch.read',commit:DashboardSummaryReadCommit):Promise<Map<string,DashboardSlaRows>>{
    const statements:D1PreparedStatement[]=[];
    for(const ticketId of target.ticketIds){
      statements.push(this.db.prepare(`SELECT c.ticket_id,c.response_started_at,c.response_completed_at,c.resolution_started_at,
        c.resolution_completed_at,c.paused_at,c.pause_reason,c.last_support_state_revision,c.revision,c.policy_revision,
        COALESCE(c.policy_calendar_json,p.calendar_json) AS calendar_json,
        CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_response_target_ms ELSE p.response_target_ms END AS response_target_ms,
        CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_resolution_target_ms ELSE p.resolution_target_ms END AS resolution_target_ms,
        CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_response_reopen_policy ELSE p.response_reopen_policy END AS response_reopen_policy,
        CASE WHEN c.policy_calendar_json IS NOT NULL THEN c.policy_resolution_reopen_policy ELSE p.resolution_reopen_policy END AS resolution_reopen_policy,
        u.full_name AS handler_name FROM ticket_sla_clocks c JOIN tickets t ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id
        LEFT JOIN sla_policies p ON p.tenant_id=c.tenant_id LEFT JOIN users u ON u.tenant_id=t.tenant_id AND u.id=t.assigned_to
        WHERE c.tenant_id=? AND c.ticket_id=? AND ${this.staffTicket('t')} AND ${this.admitted()}`)
        .bind(this.scope.tenantId,ticketId,...this.ticketValues(commit),this.scope.tenantId));
      statements.push(this.db.prepare(`SELECT p.started_at,p.ended_at FROM ticket_sla_pause_intervals p JOIN tickets t
        ON t.tenant_id=p.tenant_id AND t.id=p.ticket_id WHERE p.tenant_id=? AND p.ticket_id=?
        AND ${this.staffTicket('t')} AND ${this.admitted()} ORDER BY p.started_at`)
        .bind(this.scope.tenantId,ticketId,...this.ticketValues(commit),this.scope.tenantId));
    }
    const results=await this.batch(commit,operation,operation==='dashboard.ticket.sla.read'?{ticketId:target.ticketIds[0]}:{ticketIds:target.ticketIds},statements);
    const output=new Map<string,DashboardSlaRows>();
    target.ticketIds.forEach((ticketId,index)=>{
      const main=results[3+index*2]?.results?.[0] as SlaMainRow|undefined;
      if(main)output.set(ticketId,{main,pauses:(results[4+index*2]?.results??[]) as {started_at:string;ended_at:string|null}[]});
    });
    return output;
  }

  async replyCapability(ticketId:string,commit:DashboardSummaryReadCommit):Promise<{status:'missing'|'forbidden'|'ok';revision?:number}>{
    const c=commit.credential,target={ticketId};
    const rows=await this.batch(commit,'dashboard.ticket.reply-capability.read',target,[
      this.db.prepare(`SELECT t.id,CASE WHEN ${this.staffTicket('t')} THEN 1 ELSE 0 END AS allowed FROM tickets t
        WHERE t.tenant_id=? AND t.id=? AND ${this.admitted()}`).bind(...this.ticketValues(commit),this.scope.tenantId,ticketId,this.scope.tenantId),
      this.db.prepare(`SELECT COALESCE((SELECT sequence FROM conversation_events WHERE tenant_id=t.tenant_id AND ticket_id=t.id
          ORDER BY sequence DESC LIMIT 1),0) AS revision FROM tickets t WHERE t.tenant_id=? AND t.id=?
        AND ${this.staffTicket('t')} AND ${this.admitted()}`).bind(this.scope.tenantId,ticketId,...this.ticketValues(commit),this.scope.tenantId),
    ]);
    const ticket=rows[3].results?.[0] as {allowed:number}|undefined;if(!ticket)return {status:'missing'};
    if(ticket.allowed!==1)return {status:'forbidden'};
    return {status:'ok',revision:(rows[4].results?.[0] as {revision:number}|undefined)?.revision??0};
  }
}
