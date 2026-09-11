import type { D1Database } from '@cloudflare/workers-types';
import { capabilityWriteConstraint, requireCapabilityWrite, type CapabilityWriteFence } from '../auth/capability-policy';
import { DEFAULT_SLA_CALENDAR, SlaClockError as DomainSlaClockError, evaluateResolutionSla, evaluateResponseSla, parseSlaCalendar, type SlaCalendar, type SlaPauseInterval, type SlaReopenPolicy } from '../domain/sla-clock';
import type { VerifiedTenantScope } from '../types/tenant';
import type { SlaPolicy, SlaPolicyInput, SlaTargetProjection, TicketSlaClock, TicketSlaProjection } from '../types/sla';
import type { TicketStateWriteFence } from './support-state.repository';

const maximumTargetMs = 7_776_000_000;

function ticketWriteConstraint(fence: TicketStateWriteFence, ticketAlias: string): { sql: string; values: unknown[] } {
  return {
    sql: `EXISTS (SELECT 1 FROM users actor WHERE actor.tenant_id=${ticketAlias}.tenant_id
      AND actor.id=? AND actor.role=? AND actor.session_version=?
      AND (actor.role <> 'agent' OR ${ticketAlias}.group_id IS NULL OR EXISTS (
        SELECT 1 FROM user_groups membership WHERE membership.tenant_id=${ticketAlias}.tenant_id
          AND membership.user_id=actor.id AND membership.group_id=${ticketAlias}.group_id)))`,
    values: [fence.actorId, fence.role, fence.sessionVersion],
  };
}

export class SlaClockError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'unavailable' | 'conflict', message: string) { super(message); }
}

/** Shared pure projection over an already authorized, complete clock snapshot. */
export function projectSlaClock(clock: TicketSlaClock, currentPolicy: SlaPolicy, pauses: SlaPauseInterval[], handlerName: string | null, now = new Date()): TicketSlaProjection {
  const frozenPolicy = clock.policyCalendarJson ? {
    calendar: calendar(JSON.parse(clock.policyCalendarJson)), responseTargetMs: clock.policyResponseTargetMs,
    resolutionTargetMs: clock.policyResolutionTargetMs,
    reopenPolicy: { response: clock.policyResponseReopenPolicy ?? 'continue', resolution: clock.policyResolutionReopenPolicy ?? 'continue' }, revision: clock.policyRevision,
  } : currentPolicy;
  const projectTarget = (targetMs: number | null, startedAt: string, completedAt: string | null, pausedAt: string | null,
    kind: 'response' | 'resolution'): SlaTargetProjection => {
    if (targetMs === null) return { state: 'unavailable', phase: 'unavailable', completedAt: null, dueAt: null, remainingWorkingMilliseconds: null, targetWorkingMilliseconds: null };
    const evaluatedAt = new Date(completedAt ?? pausedAt ?? now.toISOString());
    const cutoff = evaluatedAt.getTime();
    const applicablePauses = pauses.flatMap(pause => {
      const startsAt = Math.max(new Date(pause.startsAt).getTime(), new Date(startedAt).getTime());
      const endsAt = Math.min(new Date(pause.endsAt).getTime(), cutoff);
      return startsAt < endsAt ? [{ startsAt, endsAt }] : [];
    });
    const result = kind === 'response'
      ? evaluateResponseSla({ calendar: frozenPolicy.calendar, startedAt: new Date(startedAt), evaluatedAt, targetWorkingMilliseconds: targetMs, pauses: applicablePauses })
      : evaluateResolutionSla({ calendar: frozenPolicy.calendar, startedAt: new Date(startedAt), evaluatedAt, targetWorkingMilliseconds: targetMs, pauses: applicablePauses });
    return { state: result.state, phase: completedAt ? 'completed' : pausedAt ? 'paused' : 'running', completedAt,
      dueAt: !completedAt && pausedAt ? null : result.dueAt?.toISOString() ?? null,
      remainingWorkingMilliseconds: result.state === 'unavailable' ? null : result.remainingWorkingMilliseconds, targetWorkingMilliseconds: targetMs };
  };
  return { response: projectTarget(frozenPolicy.responseTargetMs, clock.responseStartedAt, clock.responseCompletedAt, clock.pausedAt, 'response'),
    resolution: projectTarget(frozenPolicy.resolutionTargetMs, clock.resolutionStartedAt, clock.resolutionCompletedAt, clock.pausedAt, 'resolution'), handlerName };
}

function target(value: number | null, name: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 60_000 || value > maximumTargetMs) {
    throw new SlaClockError('invalid', `${name} target must be between one minute and ninety days`);
  }
  return value;
}

function calendar(value: unknown): SlaCalendar {
  try { return parseSlaCalendar(value); }
  catch (error) {
    if (error instanceof DomainSlaClockError) throw new SlaClockError('invalid', error.message);
    throw error;
  }
}

function policy(row: any | null): SlaPolicy {
  if (!row) return { calendar: DEFAULT_SLA_CALENDAR, responseTargetMs: null, resolutionTargetMs: null,
    reopenPolicy: { response: 'continue', resolution: 'continue' }, revision: 0 };
  return { calendar: calendar(JSON.parse(row.calendar_json)), responseTargetMs: row.response_target_ms,
    resolutionTargetMs: row.resolution_target_ms, reopenPolicy: { response: row.response_reopen_policy, resolution: row.resolution_reopen_policy }, revision: row.revision };
}

/** Tenant-qualified policy and persisted projection access. Clock arithmetic stays pure in domain/sla-clock. */
export class SlaClockRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async getPolicy(): Promise<SlaPolicy> {
    const row = await this.db.prepare('SELECT * FROM sla_policies WHERE tenant_id=?').bind(this.scope.tenantId).first();
    return policy(row);
  }

  async setPolicy(input: SlaPolicyInput, fence: CapabilityWriteFence): Promise<SlaPolicy> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new SlaClockError('invalid', 'A policy revision is required');
    const parsedCalendar = calendar(input.calendar);
    const serializedCalendar = JSON.stringify(parsedCalendar);
    const responseTargetMs = target(input.responseTargetMs, 'Response');
    const resolutionTargetMs = target(input.resolutionTargetMs, 'Resolution');
    const reopen: SlaReopenPolicy = { response: input.reopenPolicy?.response ?? 'continue', resolution: input.reopenPolicy?.resolution ?? 'continue' };
    if (!['continue', 'restart'].includes(reopen.response) || !['continue', 'restart'].includes(reopen.resolution)) {
      throw new SlaClockError('invalid', 'Invalid reopen policy');
    }
    const guard = capabilityWriteConstraint(fence);
    const results = await this.db.batch<{ revision: number }>([
      this.db.prepare(`INSERT INTO sla_policies
      (tenant_id,calendar_json,response_target_ms,resolution_target_ms,response_reopen_policy,resolution_reopen_policy)
      SELECT ?,?,?,?,?,? WHERE ${guard.sql} AND (?=0 OR EXISTS (SELECT 1 FROM sla_policies WHERE tenant_id=?))
      ON CONFLICT(tenant_id) DO UPDATE SET calendar_json=excluded.calendar_json,response_target_ms=excluded.response_target_ms,
        resolution_target_ms=excluded.resolution_target_ms,response_reopen_policy=excluded.response_reopen_policy,
        resolution_reopen_policy=excluded.resolution_reopen_policy,revision=sla_policies.revision+1,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE sla_policies.revision=? AND ${guard.sql} RETURNING revision`)
      .bind(this.scope.tenantId,serializedCalendar,responseTargetMs,resolutionTargetMs,reopen.response,reopen.resolution,...guard.values,input.expectedRevision,this.scope.tenantId,input.expectedRevision,...guard.values),
      this.db.prepare(`INSERT OR IGNORE INTO sla_policy_events (tenant_id,id,revision,actor_id,facts)
        SELECT ?,lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),revision,?,
          json_object('calendar',calendar_json,'responseTargetMs',response_target_ms,'resolutionTargetMs',resolution_target_ms,
            'responseReopenPolicy',response_reopen_policy,'resolutionReopenPolicy',resolution_reopen_policy)
        FROM sla_policies WHERE changes()=1 AND tenant_id=? AND revision=? AND calendar_json=? AND response_target_ms IS ? AND resolution_target_ms IS ?
          AND response_reopen_policy=? AND resolution_reopen_policy=?`)
      .bind(this.scope.tenantId,this.scope.actorId,this.scope.tenantId,input.expectedRevision + 1,serializedCalendar,responseTargetMs,resolutionTargetMs,reopen.response,reopen.resolution),
    ]);
    if (!results[0]?.results?.[0]) throw new SlaClockError('conflict', 'SLA policy changed before it could be saved');
    requireCapabilityWrite(results[0], fence);
    return this.getPolicy();
  }

  async getClock(ticketId: string): Promise<TicketSlaClock | null> {
    const row = await this.db.prepare(`SELECT ticket_id,response_started_at,response_completed_at,resolution_started_at,
      resolution_completed_at,paused_at,pause_reason,last_support_state_revision,revision,policy_revision,policy_calendar_json,
      policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy FROM ticket_sla_clocks
      WHERE tenant_id=? AND ticket_id=?`).bind(this.scope.tenantId, ticketId).first<any>();
    if (!row) return null;
    return { ticketId: row.ticket_id, responseStartedAt: row.response_started_at, responseCompletedAt: row.response_completed_at,
      resolutionStartedAt: row.resolution_started_at, resolutionCompletedAt: row.resolution_completed_at,
      pausedAt: row.paused_at, pauseReason: row.pause_reason, supportStateRevision: row.last_support_state_revision, revision: row.revision,
      policyRevision: row.policy_revision, policyCalendarJson: row.policy_calendar_json, policyResponseTargetMs: row.policy_response_target_ms,
      policyResolutionTargetMs: row.policy_resolution_target_ms, policyResponseReopenPolicy: row.policy_response_reopen_policy,
      policyResolutionReopenPolicy: row.policy_resolution_reopen_policy };
  }

  /**
   * Starts one pre-SLA ticket at the acknowledged initialization time.  This is
   * deliberately not a tenant-wide backfill and never assumes that a policy
   * configured today applied at the ticket's historical creation time.
   */
  async initializeExistingTicket(ticketId: string, fence: TicketStateWriteFence): Promise<boolean> {
    const live = ticketWriteConstraint(fence, 't');
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
    const results = await this.db.batch([
      this.db.prepare(`SELECT 1 FROM tickets t WHERE t.tenant_id=? AND t.id=? AND ${live.sql}`)
        .bind(this.scope.tenantId, ticketId, ...live.values),
      this.db.prepare(`INSERT OR IGNORE INTO sla_policies
        (tenant_id,calendar_json,response_target_ms,resolution_target_ms,response_reopen_policy,resolution_reopen_policy)
        SELECT ?,?,NULL,NULL,'continue','continue' FROM tickets t WHERE t.tenant_id=? AND t.id=? AND ${live.sql}`)
        .bind(this.scope.tenantId, JSON.stringify(DEFAULT_SLA_CALENDAR), this.scope.tenantId, ticketId, ...live.values),
      this.db.prepare(`INSERT OR IGNORE INTO ticket_sla_clocks
        (tenant_id,ticket_id,response_started_at,resolution_started_at,paused_at,pause_reason,last_support_state_revision,
         policy_revision,policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,policy_response_reopen_policy,policy_resolution_reopen_policy)
        SELECT t.tenant_id,t.id,${now},${now},
          CASE WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL THEN ${now} ELSE NULL END,
          CASE WHEN d.legacy_status='pending' AND s.waiting_reason IS NOT NULL THEN 'waiting' ELSE NULL END,COALESCE(s.revision,0),
          p.revision,p.calendar_json,p.response_target_ms,p.resolution_target_ms,p.response_reopen_policy,p.resolution_reopen_policy
        FROM tickets t JOIN sla_policies p ON p.tenant_id=t.tenant_id
        LEFT JOIN ticket_support_state s ON s.tenant_id=t.tenant_id AND s.ticket_id=t.id
        LEFT JOIN support_state_definitions d ON d.tenant_id=s.tenant_id AND d.id=s.definition_id
        WHERE t.tenant_id=? AND t.id=? AND ${live.sql}`)
        .bind(this.scope.tenantId, ticketId, ...live.values),
      this.db.prepare(`INSERT OR IGNORE INTO ticket_sla_pause_intervals (tenant_id,ticket_id,started_at,reason,support_state_revision)
        SELECT c.tenant_id,c.ticket_id,c.paused_at,'waiting',c.last_support_state_revision
        FROM ticket_sla_clocks c JOIN tickets t ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id
        WHERE c.tenant_id=? AND c.ticket_id=? AND c.paused_at IS NOT NULL AND ${live.sql}`)
        .bind(this.scope.tenantId, ticketId, ...live.values),
      this.db.prepare(`INSERT OR IGNORE INTO ticket_sla_events (tenant_id,id,ticket_id,kind,support_state_revision,actor_id,facts)
        SELECT c.tenant_id,lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
          c.ticket_id,'clock.initialized',c.last_support_state_revision,?,json_object('source','explicit-existing-ticket-initialization','startedAt',c.response_started_at)
        FROM ticket_sla_clocks c JOIN tickets t ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id
        WHERE c.tenant_id=? AND c.ticket_id=? AND ${live.sql}`)
        .bind(this.scope.actorId, this.scope.tenantId, ticketId, ...live.values),
    ]);
    if (!results[0]?.results?.[0]) throw new SlaClockError('not_found', 'Ticket not found');
    return (results[2]?.meta?.changes ?? 0) === 1;
  }

  async recordFirstResponse(ticketId: string, articleId: string): Promise<void> {
    const result = await this.db.batch<{ response_completed_at: string; last_support_state_revision: number }>([
      this.db.prepare(`UPDATE ticket_sla_clocks SET response_completed_at=(SELECT a.created_at FROM articles a
        WHERE a.tenant_id=ticket_sla_clocks.tenant_id AND a.id=? AND a.ticket_id=ticket_sla_clocks.ticket_id AND a.sender_type='agent' AND a.is_internal=0),
      revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant_id=? AND ticket_id=? AND response_completed_at IS NULL AND EXISTS (
        SELECT 1 FROM articles a WHERE a.tenant_id=ticket_sla_clocks.tenant_id AND a.id=? AND a.ticket_id=ticket_sla_clocks.ticket_id
          AND a.sender_type='agent' AND a.is_internal=0) RETURNING response_completed_at,last_support_state_revision`)
        .bind(articleId,this.scope.tenantId,ticketId,articleId),
      this.db.prepare(`INSERT OR IGNORE INTO ticket_sla_events (tenant_id,id,ticket_id,kind,support_state_revision,facts)
        SELECT ?,lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),?,
          'clock.responded',last_support_state_revision,json_object('articleId',?)
        FROM ticket_sla_clocks WHERE tenant_id=? AND ticket_id=? AND response_completed_at=(SELECT created_at FROM articles WHERE tenant_id=? AND id=?)`)
        .bind(this.scope.tenantId,ticketId,articleId,this.scope.tenantId,ticketId,this.scope.tenantId,articleId),
    ]);
    if (result[0]?.results?.[0] && result[1]?.meta?.changes !== 1) throw new SlaClockError('invalid', 'SLA response audit could not be recorded');
  }

  private async pauses(ticketId: string, now: Date): Promise<SlaPauseInterval[]> {
    const rows = await this.db.prepare(`SELECT started_at,ended_at FROM ticket_sla_pause_intervals
      WHERE tenant_id=? AND ticket_id=? ORDER BY started_at LIMIT 4097`).bind(this.scope.tenantId,ticketId).all<{ started_at: string; ended_at: string | null }>();
    if (rows.results.length > 4096) throw new SlaClockError('unavailable', 'SLA pause history exceeds the bounded evaluation limit');
    return rows.results.map(row => ({ startsAt: new Date(row.started_at), endsAt: new Date(row.ended_at ?? now.toISOString()) }));
  }

  async getProjection(ticketId: string, now = new Date()): Promise<TicketSlaProjection | null> {
    const clock = await this.getClock(ticketId);
    if (!clock) return null;
    const [currentPolicy, pauses, handler] = await Promise.all([
      this.getPolicy(), this.pauses(ticketId, now),
      this.db.prepare(`SELECT u.full_name FROM tickets t LEFT JOIN users u ON u.tenant_id=t.tenant_id AND u.id=t.assigned_to
        WHERE t.tenant_id=? AND t.id=?`).bind(this.scope.tenantId,ticketId).first<{ full_name: string | null }>(),
    ]);
    return projectSlaClock(clock, currentPolicy, pauses, handler?.full_name ?? null, now);
  }
}
