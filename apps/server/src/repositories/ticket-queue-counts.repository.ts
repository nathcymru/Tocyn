import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { SessionBudgetCredential } from './session-budget-authority.repository';
import { budgetCommitConstraint,budgetGrantOperationStatements } from './budget-commit-fence';
import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { TicketQueueCounts } from '../types/ticket-queue';
import { ticketMentionPredicate, ticketQueuePredicate } from './ticket-queue-predicate';
import { ticketListCurrentCredentialSql, ticketListScanAssertionSql, TicketListScanError,
  type TicketListCurrentCredential, type TicketListScanSnapshot } from './ticket-list-scan.repository';

export type TicketQueueCountCommit = Readonly<{ operation:'dashboard.ticket.queue-counts'; requestKey:string;
  credential:SessionBudgetCredential; snapshot:TicketListScanSnapshot; draftNotExpiredAt?:string; authority:BudgetCommitAuthority }>;

export type TicketQueueCountOptions = Readonly<{
  credential: TicketListCurrentCredential;
  commit?:TicketQueueCountCommit;
  snapshot?: TicketListScanSnapshot;
  draftNotExpiredAt?: string;
  /** Trusted server instant. If omitted by an internal caller, use the server clock. */
  asOfMs?: number;
}>;

/** Visible flags are materialized once; ownership classifications reuse the stored actionable flag. */
export function ticketQueueCountsSql(scope: VerifiedTenantScope, options: TicketQueueCountOptions) {
  if (!['admin','agent'].includes(options.credential.role) || !scope.roles.includes(options.credential.role))
    throw new TicketListScanError('authority_changed');
  const asOfMs=options.asOfMs??Date.now();
  if(!Number.isSafeInteger(asOfMs)||asOfMs<0)throw new TicketListScanError('unavailable');
  const current=ticketListCurrentCredentialSql(scope.tenantId,scope.actorId,options.credential);
  const fence=options.snapshot?ticketListScanAssertionSql(scope.tenantId,options.snapshot):undefined;
  const authority={sql:fence?`${fence.sql.replace(/\s+LIMIT 1\s*$/,'')} AND ${current.sql} LIMIT 1`:`SELECT 1 AS admitted WHERE ${current.sql}`,
    values:[...(fence?.values??[]),...current.values]};
  if(options.commit){
    const commit=options.commit,c=commit.credential;
    const valid=commit.operation==='dashboard.ticket.queue-counts'&&commit.requestKey===commit.authority.operationFingerprint
      &&c.tenantId===scope.tenantId&&c.actorId===scope.actorId&&c.sessionVersion===scope.authVersion&&c.mfaVerified===true
      &&c.role===options.credential.role&&c.sessionVersion===options.credential.sessionVersion&&c.expiresAt===options.credential.expiresAt
      &&JSON.stringify(commit.snapshot)===JSON.stringify(options.snapshot)&&commit.draftNotExpiredAt===options.draftNotExpiredAt
      &&commit.authority.operationId.length>0;
    const budget=budgetCommitConstraint(commit.authority,scope.tenantId);
    authority.sql=`SELECT 1 AS admitted WHERE ?=1 AND EXISTS (${authority.sql}) AND ${budget.sql}`;
    authority.values=[valid?1:0,...authority.values,...budget.values];
  }
  const group=options.credential.role==='agent'
    ? {sql:' AND (tickets.group_id IS NULL OR EXISTS (SELECT 1 FROM user_groups membership WHERE membership.tenant_id=tickets.tenant_id AND membership.user_id=? AND membership.group_id=tickets.group_id))',values:[scope.actorId]}: {sql:'',values:[]};
  const actionable=ticketQueuePredicate('actionable');
  const snoozed=ticketQueuePredicate('snoozed');
  const drafts=ticketQueuePredicate('drafts','tickets',{actorId:scope.actorId,notExpiredAt:options.draftNotExpiredAt});
  const mentions=ticketMentionPredicate('tickets',scope.actorId);
  // The fixed-hour triage clock is distinct from contractual calendar SLAs.
  // Match projectPriorityClock's active elapsed calculation: accrued time plus
  // nonnegative time since active_since, with the deadline itself overdue.
  const activeSinceMs=`(CAST(strftime('%s',priority_clock.active_since) AS INTEGER)*1000+
    CAST(substr(strftime('%f',priority_clock.active_since),4,3) AS INTEGER))`;
  const windowMs=`MIN(CASE tickets.contract_sla_tier WHEN 'alpha' THEN 1 WHEN 'bravo' THEN 4
    WHEN 'charlie' THEN 24 WHEN 'delta' THEN 48 END,
    CASE tickets.criticality_tier WHEN 4 THEN 1 WHEN 3 THEN 4 WHEN 2 THEN 24 WHEN 1 THEN 48 END)*3600000`;
  const overdue=`CASE WHEN tickets.status NOT IN ('resolved','closed')
    AND priority_clock.stop_reason IS NULL AND priority_clock.active_since IS NOT NULL
    AND tickets.contract_sla_tier IN ('alpha','bravo','charlie','delta')
    AND tickets.criticality_tier IN (1,2,3,4)
    AND ${activeSinceMs} IS NOT NULL
    AND priority_clock.accrued_active_ms+MAX(0,?-${activeSinceMs})>=${windowMs}
    THEN 1 ELSE 0 END`;
  return {authority,sql:`WITH authority AS MATERIALIZED (${authority.sql}),
    visible AS MATERIALIZED (
      SELECT tickets.id,tickets.tenant_id,tickets.assigned_to,tickets.status,
        tickets.contract_sla_tier,tickets.criticality_tier FROM tickets CROSS JOIN authority
      WHERE tickets.tenant_id=?${group.sql}
    ), queue_flags AS MATERIALIZED (
      SELECT tickets.assigned_to,${actionable.sql} AS actionable,${snoozed.sql} AS snoozed,
        ${drafts.sql} AS drafts,${mentions.sql} AS mentions,${overdue} AS triage_overdue
      FROM visible tickets LEFT JOIN ticket_priority_clocks priority_clock
        ON priority_clock.tenant_id=tickets.tenant_id AND priority_clock.ticket_id=tickets.id
    )
    SELECT COUNT(*) AS all_count,COALESCE(SUM(actionable),0) AS actionable,
      COALESCE(SUM(actionable AND assigned_to=?),0) AS mine,
      COALESCE(SUM(actionable AND assigned_to IS NULL),0) AS unassigned,
      COALESCE(SUM(actionable AND mentions),0) AS mentions,
      COALESCE(SUM(drafts),0) AS drafts,COALESCE(SUM(snoozed),0) AS snoozed,
      COALESCE(SUM(triage_overdue),0) AS triage_overdue_count FROM queue_flags`,
    values:[...authority.values,scope.tenantId,...group.values,...drafts.values,...mentions.values,asOfMs,scope.actorId]};
}

export class TicketQueueCountsRepository {
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope) {}
  async counts(options:TicketQueueCountOptions):Promise<TicketQueueCounts> {
    const query=ticketQueueCountsSql(this.scope,options);
    const read=this.db.prepare(query.sql).bind(...query.values);
    const result=options.commit?await this.db.batch([
      this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN EXISTS (${query.authority.sql}) THEN 1 ELSE 0 END)
        ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId,...query.authority.values),
      ...budgetGrantOperationStatements(this.db,this.scope,options.commit.authority),read,
      this.db.prepare('SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?').bind(this.scope.tenantId),
    ]):await this.db.batch([this.db.prepare(query.authority.sql).bind(...query.authority.values),read]);
    if(options.commit?(result.at(-1)?.results?.[0] as {accepted?:number}|undefined)?.accepted!==1:!result[0]?.results?.[0])throw new TicketListScanError('authority_changed');
    const row=result[options.commit?3:1]?.results?.[0] as Record<string,unknown>|undefined;
    const keys=['all','actionable','mine','unassigned','mentions','drafts','snoozed'] as const;
    const counts={} as Record<typeof keys[number],number>;
    for(const key of keys){const value=row?.[key==='all'?'all_count':key];
      if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new TicketListScanError('unavailable');
      counts[key]=value;
    }
    const triageOverdueCount=row?.triage_overdue_count;
    if(typeof triageOverdueCount!=='number'||!Number.isSafeInteger(triageOverdueCount)||triageOverdueCount<0)
      throw new TicketListScanError('unavailable');
    return {scope:'standard_queues',counts,triageOverdueCount};
  }
}
