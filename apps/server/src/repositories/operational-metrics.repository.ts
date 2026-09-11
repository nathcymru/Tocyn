import type { D1Database } from '@cloudflare/workers-types';
import type { SlaPauseInterval } from '../domain/sla-clock';
import type { VerifiedTenantScope } from '../types/tenant';
import { evaluateSlaMetricClock, type SlaMetricClockRow } from './sla-operational-metrics';

export const OPERATIONAL_METRICS_VERSION = '2026-09-11.3' as const;
export const OPERATIONAL_METRICS_FRESHNESS_MS = 60_000;
export const OPERATIONAL_METRICS_TENANT_TICKET_CANDIDATE_LIMIT = 1_000;
export const OPERATIONAL_METRICS_TENANT_EVENT_CANDIDATE_LIMIT = 1_000;
export const OPERATIONAL_METRICS_ASSIGNEE_LIMIT = 100;

/** Versioned numerator, denominator, and time contracts; routing values remain unavailable. */
export const OPERATIONAL_METRIC_DEFINITIONS = Object.freeze({
  definitionVersion: OPERATIONAL_METRICS_VERSION,
  currentWork: Object.freeze({
    numerator: 'visible tenant tickets whose current status is open or pending',
    denominator: 'the same current-state ticket set at the projection snapshot',
    timeBasis: 'D1 statement snapshot; repository-issued server clock for asOf and freshThrough',
  }),
  sla: Object.freeze({
    status: 'available-or-unavailable' as const,
    firstResponse: Object.freeze({
      numerator: 'tickets with an eligible first staff response at or before a configured response deadline',
      denominator: 'tickets with an accepted intake, configured SLA policy, and response deadline in the selected window',
      timeBasis: 'server-recorded canonical event time, calendar, pause, and waiting semantics supplied by #73/#136',
    }),
    resolution: Object.freeze({
      numerator: 'tickets resolved at or before a configured resolution deadline',
      denominator: 'tickets with an accepted intake, configured SLA policy, and resolution deadline in the selected window',
      timeBasis: 'server-recorded canonical event time, calendar, pause, and waiting semantics supplied by #73/#136',
    }),
  }),
  routing: Object.freeze({
    status: 'unavailable' as const,
    assignmentLoad: Object.freeze({
      numerator: 'visible current-work tickets assigned to an actor', denominator: 'visible current-work tickets at the same snapshot',
      timeBasis: 'D1 statement snapshot; no historical throughput or employee score',
    }),
    eligibleCapacity: Object.freeze({
      numerator: 'eligible routing candidates with remaining configured capacity',
      denominator: 'candidates with current availability, group eligibility, and a configured ceiling',
      timeBasis: 'availability leases, ceilings, and routing policy supplied by #137',
    }),
  }),
  canonicalEvents: Object.freeze({
    denominator: 'persisted canonical conversation events joined through the same visible ticket set',
    lateEvent: 'included when persisted on the next rebuilt projection; provider occurrence time is unavailable',
    replay: 'an accepted replay reuses its receipt and must not create a second canonical event',
  }),
});

export class OperationalMetricAccessError extends Error {
  constructor() { super('Operational metrics require a current verified staff or system scope'); this.name = 'OperationalMetricAccessError'; }
}

type BoundedCurrentWork = Readonly<{
  status: 'available' | 'truncated'; reason: 'tenant_ticket_candidate_cap_exceeded' | null;
  denominator: 'tickets with current status open or pending visible to the current verified actor';
  total: number | null; unassigned: number | null; assigned: number | null;
  byAssignee: readonly Readonly<{ actorId: string; count: number }>[]; truncated: boolean;
}>;
type BoundedCanonicalEvents = Readonly<{
  status: 'available' | 'truncated'; reason: 'tenant_ticket_candidate_cap_exceeded' | 'tenant_event_candidate_cap_exceeded' | null;
  denominator: 'persisted canonical conversation events visible through the same tenant and group boundary';
  total: number | null; latestRecordedAt: string | null; lateOrReplayed: 'not-derived';
}>;
export type SlaMetricWindow = Readonly<{ startsAt: string; endsAt: string }>;
type SlaMetricCounts = Readonly<{
  numerator: number | null;
  denominator: number | null;
  denominatorDescription: string;
}>;
type AvailableSlaMetricProjection = Readonly<{
  status: 'available'; reason: null; selectedWindow: SlaMetricWindow; asOf: string; freshThrough: string;
  firstResponse: SlaMetricCounts; resolution: SlaMetricCounts;
}>;
type UnavailableSlaMetricProjection = Readonly<{
  status: 'unavailable';
  reason: 'invalid_selected_window' | 'tenant_sla_clock_candidate_cap_exceeded' | 'tenant_sla_pause_candidate_cap_exceeded' | 'malformed_sla_clock_or_calendar' | 'sla_calendar_work_cap_exceeded';
  selectedWindow: SlaMetricWindow | null; asOf: string | null; freshThrough: string | null;
  firstResponse: Readonly<{ numerator: null; denominator: null }>;
  resolution: Readonly<{ numerator: null; denominator: null }>;
}>;
export type SlaMetricProjection = AvailableSlaMetricProjection | UnavailableSlaMetricProjection;
export type OperationalMetricProjection = Readonly<{
  definitionVersion: typeof OPERATIONAL_METRICS_VERSION; asOf: string; freshThrough: string;
  resourceLimits: Readonly<{ tenantTicketCandidates: number; tenantEventCandidates: number; assignees: number }>;
  currentWork: BoundedCurrentWork; canonicalEvents: BoundedCanonicalEvents;
  sla: Readonly<{ status: 'unavailable'; reason: 'SLA values require an explicitly selected window via slaForWindow' }>;
  routing: Readonly<{ status: 'unavailable'; reason: 'availability, ceilings, and routing decisions are owned by #137' }>;
}>;

/** Evaluate a receipt with a server-owned clock; serialized receipts do not self-update. */
export function isOperationalMetricProjectionFresh(projection: Pick<OperationalMetricProjection, 'freshThrough'>, clock: () => Date = () => new Date()): boolean {
  const expiry = Date.parse(projection.freshThrough); const now = clock().getTime();
  return Number.isFinite(expiry) && Number.isFinite(now) && now <= expiry;
}

type ProjectionRow = { row_kind: 'summary' | 'assignee'; actor_authorized: number | null; tenant_ticket_candidate_count: number | null; tenant_event_candidate_count: number | null; canonical_event_total: number | null; total: number | null; unassigned: number | null; latest_recorded_at: string | null; actor_id: string | null; assignee_count: number | null; };
export const OPERATIONAL_METRICS_SLA_CLOCK_CANDIDATE_LIMIT = 100;
export const OPERATIONAL_METRICS_SLA_PAUSE_CANDIDATE_LIMIT = 1_000;
export const OPERATIONAL_METRICS_SLA_CALENDAR_DAY_LIMIT = 20_000;
export const OPERATIONAL_METRICS_SLA_CALENDAR_INTERVAL_LIMIT = 100_000;
type ProjectionLimits = Readonly<{ tenantTicketCandidates: number; tenantEventCandidates: number; assignees: number; slaClockCandidates: number; slaPauseCandidates: number; slaCalendarDays: number; slaCalendarIntervals: number }>;
const DEFAULT_LIMITS: ProjectionLimits = Object.freeze({ tenantTicketCandidates: OPERATIONAL_METRICS_TENANT_TICKET_CANDIDATE_LIMIT, tenantEventCandidates: OPERATIONAL_METRICS_TENANT_EVENT_CANDIDATE_LIMIT, assignees: OPERATIONAL_METRICS_ASSIGNEE_LIMIT, slaClockCandidates: OPERATIONAL_METRICS_SLA_CLOCK_CANDIDATE_LIMIT, slaPauseCandidates: OPERATIONAL_METRICS_SLA_PAUSE_CANDIDATE_LIMIT, slaCalendarDays: OPERATIONAL_METRICS_SLA_CALENDAR_DAY_LIMIT, slaCalendarIntervals: OPERATIONAL_METRICS_SLA_CALENDAR_INTERVAL_LIMIT });
function boundedLimit(value: number | undefined, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || value < 1 || value > fallback) throw new Error('Invalid operational metric resource limit'); return value; }
function resolveLimits(limits?: Partial<ProjectionLimits>): ProjectionLimits { return Object.freeze({ tenantTicketCandidates: boundedLimit(limits?.tenantTicketCandidates, DEFAULT_LIMITS.tenantTicketCandidates), tenantEventCandidates: boundedLimit(limits?.tenantEventCandidates, DEFAULT_LIMITS.tenantEventCandidates), assignees: boundedLimit(limits?.assignees, DEFAULT_LIMITS.assignees), slaClockCandidates: boundedLimit(limits?.slaClockCandidates, DEFAULT_LIMITS.slaClockCandidates), slaPauseCandidates: boundedLimit(limits?.slaPauseCandidates, DEFAULT_LIMITS.slaPauseCandidates), slaCalendarDays: boundedLimit(limits?.slaCalendarDays, DEFAULT_LIMITS.slaCalendarDays), slaCalendarIntervals: boundedLimit(limits?.slaCalendarIntervals, DEFAULT_LIMITS.slaCalendarIntervals) }); }

type SlaProjectionRow = {
  row_kind: 'summary' | 'clock' | 'pause'; actor_authorized: number | null; tenant_clock_candidate_count: number | null; tenant_pause_candidate_count: number | null;
  ticket_id: string | null; response_started_at: string | null; response_completed_at: string | null; resolution_started_at: string | null; resolution_completed_at: string | null; paused_at: string | null;
  policy_calendar_json: string | null; policy_response_target_ms: number | null; policy_resolution_target_ms: number | null;
  current_policy_calendar_json: string | null; current_policy_response_target_ms: number | null; current_policy_resolution_target_ms: number | null;
  pause_started_at: string | null; pause_ended_at: string | null;
};
function selectedWindow(value: SlaMetricWindow): { startsAt: Date; endsAt: Date; receipt: SlaMetricWindow } | null {
  const startsAt = new Date(value?.startsAt); const endsAt = new Date(value?.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt.getTime() >= endsAt.getTime()) return null;
  return { startsAt, endsAt, receipt: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } };
}
function unavailableSla(reason: UnavailableSlaMetricProjection['reason'], selected: SlaMetricWindow | null, now?: Date): UnavailableSlaMetricProjection {
  const validNow = now && Number.isFinite(now.getTime()) ? now : null;
  return { status: 'unavailable', reason, selectedWindow: selected, asOf: validNow?.toISOString() ?? null, freshThrough: validNow ? new Date(validNow.getTime() + OPERATIONAL_METRICS_FRESHNESS_MS).toISOString() : null, firstResponse: { numerator: null, denominator: null }, resolution: { numerator: null, denominator: null } };
}

/** One D1 statement rechecks authorization, group membership, capped tenant candidates, totals, and assignees. */
export class OperationalMetricsRepository {
  private readonly limits: ProjectionLimits;
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope, private readonly clock: () => Date = () => new Date(), limits?: Partial<ProjectionLimits>) { this.limits = resolveLimits(limits); }

  async currentWork(assigneeLimit = this.limits.assignees): Promise<OperationalMetricProjection> {
    if (!Number.isSafeInteger(assigneeLimit) || assigneeLimit < 1 || assigneeLimit > this.limits.assignees) throw new Error('Invalid operational metric assignee limit');
    const now = this.clock(); if (!Number.isFinite(now.getTime())) throw new Error('Operational metrics clock unavailable');
    const system = this.scope.roles.includes('system');
    const staffRole = this.scope.roles.find(role => role === 'admin' || role === 'agent');
    if (!system && !staffRole) throw new OperationalMetricAccessError();
    const authorizationSql = system ? 'SELECT 1 AS authorized' : 'SELECT 1 AS authorized FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=?';
    const authorizationValues: unknown[] = system ? [] : [this.scope.tenantId, this.scope.actorId, staffRole, this.scope.authVersion];
    const groupRestricted = staffRole === 'agent' ? 1 : 0;
    const rows = await this.db.prepare(`WITH
      authorized_actor AS (${authorizationSql}),
      tenant_ticket_candidates AS MATERIALIZED (
        SELECT t.tenant_id,t.id,t.assigned_to,t.status,t.group_id FROM tickets t
        WHERE t.tenant_id=? ORDER BY t.id ASC LIMIT ?
      ),
      visible_tickets AS (
        SELECT t.id,t.assigned_to,t.status FROM tenant_ticket_candidates t
        WHERE EXISTS (SELECT 1 FROM authorized_actor) AND (?=0 OR t.group_id IS NULL OR EXISTS (
          SELECT 1 FROM user_groups ug WHERE ug.tenant_id=t.tenant_id AND ug.group_id=t.group_id AND ug.user_id=?
        ))
      ),
      tenant_event_candidates AS MATERIALIZED (
        SELECT e.ticket_id,e.recorded_at FROM conversation_events e
        WHERE e.tenant_id=? ORDER BY e.ticket_id ASC,e.sequence ASC LIMIT ?
      ),
      active_tickets AS (SELECT assigned_to FROM visible_tickets WHERE status IN ('open','pending')),
      visible_events AS (SELECT e.recorded_at FROM tenant_event_candidates e JOIN visible_tickets t ON t.id=e.ticket_id),
      assignee_boundary AS (
        SELECT assigned_to AS actor_id,count(*) AS assignee_count FROM active_tickets WHERE assigned_to IS NOT NULL
        GROUP BY assigned_to ORDER BY assignee_count DESC,actor_id ASC LIMIT ?
      )
      SELECT 'summary' AS row_kind,(SELECT count(*) FROM authorized_actor) AS actor_authorized,
        (SELECT count(*) FROM tenant_ticket_candidates) AS tenant_ticket_candidate_count,
        (SELECT count(*) FROM tenant_event_candidates) AS tenant_event_candidate_count,
        (SELECT count(*) FROM visible_events) AS canonical_event_total,
        (SELECT count(*) FROM active_tickets) AS total,
        (SELECT count(*) FROM active_tickets WHERE assigned_to IS NULL) AS unassigned,
        (SELECT max(recorded_at) FROM visible_events) AS latest_recorded_at,NULL AS actor_id,NULL AS assignee_count
      UNION ALL
      SELECT 'assignee',NULL,NULL,NULL,NULL,NULL,NULL,NULL,actor_id,assignee_count FROM assignee_boundary`)
      .bind(...authorizationValues, this.scope.tenantId, this.limits.tenantTicketCandidates + 1, groupRestricted, this.scope.actorId, this.scope.tenantId, this.limits.tenantEventCandidates + 1, assigneeLimit + 1)
      .all<ProjectionRow>();
    const projectionRows = rows.results ?? [];
    const summary = projectionRows.find(row => row.row_kind === 'summary');
    if (!summary) throw new Error('Operational metric projection unavailable');
    if (summary.actor_authorized !== 1) throw new OperationalMetricAccessError();
    const ticketsTruncated = (summary.tenant_ticket_candidate_count ?? 0) > this.limits.tenantTicketCandidates;
    const eventsTruncated = (summary.tenant_event_candidate_count ?? 0) > this.limits.tenantEventCandidates;
    const assignees = projectionRows.filter((row): row is ProjectionRow & { actor_id: string; assignee_count: number } => row.row_kind === 'assignee' && row.actor_id !== null && row.assignee_count !== null);
    const asOf = now.toISOString(); const freshThrough = new Date(now.getTime() + OPERATIONAL_METRICS_FRESHNESS_MS).toISOString();
    return {
      definitionVersion: OPERATIONAL_METRICS_VERSION, asOf, freshThrough, resourceLimits: this.limits,
      currentWork: ticketsTruncated ? { status: 'truncated', reason: 'tenant_ticket_candidate_cap_exceeded', denominator: 'tickets with current status open or pending visible to the current verified actor', total: null, unassigned: null, assigned: null, byAssignee: [], truncated: true } : { status: 'available', reason: null, denominator: 'tickets with current status open or pending visible to the current verified actor', total: summary.total ?? 0, unassigned: summary.unassigned ?? 0, assigned: (summary.total ?? 0) - (summary.unassigned ?? 0), byAssignee: assignees.slice(0, assigneeLimit).map(row => ({ actorId: row.actor_id, count: row.assignee_count })), truncated: assignees.length > assigneeLimit },
      canonicalEvents: ticketsTruncated ? { status: 'truncated', reason: 'tenant_ticket_candidate_cap_exceeded', denominator: 'persisted canonical conversation events visible through the same tenant and group boundary', total: null, latestRecordedAt: null, lateOrReplayed: 'not-derived' } : eventsTruncated ? { status: 'truncated', reason: 'tenant_event_candidate_cap_exceeded', denominator: 'persisted canonical conversation events visible through the same tenant and group boundary', total: null, latestRecordedAt: null, lateOrReplayed: 'not-derived' } : { status: 'available', reason: null, denominator: 'persisted canonical conversation events visible through the same tenant and group boundary', total: summary.canonical_event_total ?? 0, latestRecordedAt: summary.latest_recorded_at, lateOrReplayed: 'not-derived' },
      sla: { status: 'unavailable', reason: 'SLA values require an explicitly selected window via slaForWindow' },
      routing: { status: 'unavailable', reason: 'availability, ceilings, and routing decisions are owned by #137' },
    };
  }

  /**
   * Returns tenant-authorized aggregate SLA results for a consumer-selected
   * half-open deadline window. It never substitutes partial/capped data.
   */
  async slaForWindow(window: SlaMetricWindow): Promise<SlaMetricProjection> {
    const parsedWindow = selectedWindow(window);
    if (!parsedWindow) return unavailableSla('invalid_selected_window', null);
    const now = this.clock(); if (!Number.isFinite(now.getTime())) return unavailableSla('malformed_sla_clock_or_calendar', parsedWindow.receipt);
    const system = this.scope.roles.includes('system');
    const staffRole = this.scope.roles.find(role => role === 'admin' || role === 'agent');
    if (!system && !staffRole) throw new OperationalMetricAccessError();
    const authorizationSql = system ? 'SELECT 1 AS authorized' : 'SELECT 1 AS authorized FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=?';
    const authorizationValues: unknown[] = system ? [] : [this.scope.tenantId, this.scope.actorId, staffRole, this.scope.authVersion];
    const groupRestricted = staffRole === 'agent' ? 1 : 0;
    const rows = await this.db.prepare(`WITH
      authorized_actor AS (${authorizationSql}),
      tenant_clock_candidates AS MATERIALIZED (
        SELECT c.tenant_id,c.ticket_id,c.response_started_at,c.response_completed_at,c.resolution_started_at,c.resolution_completed_at,c.paused_at,
          c.policy_calendar_json,c.policy_response_target_ms,c.policy_resolution_target_ms,t.group_id
        FROM ticket_sla_clocks c JOIN tickets t ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id
        WHERE c.tenant_id=? ORDER BY c.ticket_id ASC LIMIT ?
      ),
      visible_clock_candidates AS MATERIALIZED (
        SELECT c.*,p.calendar_json AS current_policy_calendar_json,p.response_target_ms AS current_policy_response_target_ms,p.resolution_target_ms AS current_policy_resolution_target_ms
        FROM tenant_clock_candidates c LEFT JOIN sla_policies p ON p.tenant_id=c.tenant_id
        WHERE EXISTS (SELECT 1 FROM authorized_actor) AND (?=0 OR c.group_id IS NULL OR EXISTS (
          SELECT 1 FROM user_groups ug WHERE ug.tenant_id=c.tenant_id AND ug.group_id=c.group_id AND ug.user_id=?
        ))
      ),
      tenant_pause_candidates AS MATERIALIZED (
        SELECT p.ticket_id,p.started_at,p.ended_at FROM ticket_sla_pause_intervals p
        JOIN visible_clock_candidates c ON c.tenant_id=p.tenant_id AND c.ticket_id=p.ticket_id
        ORDER BY p.ticket_id ASC,p.started_at ASC LIMIT ?
      )
      SELECT 'summary' AS row_kind,(SELECT count(*) FROM authorized_actor) AS actor_authorized,
        (SELECT count(*) FROM tenant_clock_candidates) AS tenant_clock_candidate_count,
        (SELECT count(*) FROM tenant_pause_candidates) AS tenant_pause_candidate_count,
        NULL AS ticket_id,NULL AS response_started_at,NULL AS response_completed_at,NULL AS resolution_started_at,NULL AS resolution_completed_at,NULL AS paused_at,
        NULL AS policy_calendar_json,NULL AS policy_response_target_ms,NULL AS policy_resolution_target_ms,
        NULL AS current_policy_calendar_json,NULL AS current_policy_response_target_ms,NULL AS current_policy_resolution_target_ms,NULL AS pause_started_at,NULL AS pause_ended_at
      UNION ALL SELECT 'clock',NULL,NULL,NULL,ticket_id,response_started_at,response_completed_at,resolution_started_at,resolution_completed_at,paused_at,
        policy_calendar_json,policy_response_target_ms,policy_resolution_target_ms,current_policy_calendar_json,current_policy_response_target_ms,current_policy_resolution_target_ms,NULL,NULL
      FROM visible_clock_candidates
      UNION ALL SELECT 'pause',NULL,NULL,NULL,ticket_id,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,started_at,ended_at FROM tenant_pause_candidates`)
      .bind(...authorizationValues, this.scope.tenantId, this.limits.slaClockCandidates + 1, groupRestricted, this.scope.actorId, this.limits.slaPauseCandidates + 1)
      .all<SlaProjectionRow>();
    const resultRows = rows.results ?? [];
    const summary = resultRows.find(row => row.row_kind === 'summary');
    if (!summary) return unavailableSla('malformed_sla_clock_or_calendar', parsedWindow.receipt, now);
    if (summary.actor_authorized !== 1) throw new OperationalMetricAccessError();
    if ((summary.tenant_clock_candidate_count ?? 0) > this.limits.slaClockCandidates) return unavailableSla('tenant_sla_clock_candidate_cap_exceeded', parsedWindow.receipt, now);
    if ((summary.tenant_pause_candidate_count ?? 0) > this.limits.slaPauseCandidates) return unavailableSla('tenant_sla_pause_candidate_cap_exceeded', parsedWindow.receipt, now);
    const pausesByTicket = new Map<string, SlaPauseInterval[]>();
    for (const row of resultRows) if (row.row_kind === 'pause' && row.ticket_id && row.pause_started_at) {
      const pauses = pausesByTicket.get(row.ticket_id) ?? [];
      pauses.push({ startsAt: new Date(row.pause_started_at), endsAt: new Date(row.pause_ended_at ?? now.toISOString()) });
      pausesByTicket.set(row.ticket_id, pauses);
    }
    let responseNumerator = 0; let responseDenominator = 0; let resolutionNumerator = 0; let resolutionDenominator = 0;
    let calendarDays = 0; let calendarIntervals = 0;
    for (const row of resultRows) if (row.row_kind === 'clock' && row.ticket_id && row.response_started_at && row.resolution_started_at) {
      const evaluation = evaluateSlaMetricClock({
        responseStartedAt: row.response_started_at, responseCompletedAt: row.response_completed_at, resolutionStartedAt: row.resolution_started_at,
        resolutionCompletedAt: row.resolution_completed_at, pausedAt: row.paused_at, policyCalendarJson: row.policy_calendar_json,
        policyResponseTargetMs: row.policy_response_target_ms, policyResolutionTargetMs: row.policy_resolution_target_ms,
        currentPolicyCalendarJson: row.current_policy_calendar_json, currentPolicyResponseTargetMs: row.current_policy_response_target_ms,
        currentPolicyResolutionTargetMs: row.current_policy_resolution_target_ms,
      } satisfies SlaMetricClockRow, pausesByTicket.get(row.ticket_id) ?? [], now);
      if (!evaluation || !evaluation.response || !evaluation.resolution) return unavailableSla('malformed_sla_clock_or_calendar', parsedWindow.receipt, now);
      calendarDays += evaluation.response.inspectedCalendarDays + evaluation.resolution.inspectedCalendarDays;
      calendarIntervals += evaluation.response.inspectedCalendarIntervals + evaluation.resolution.inspectedCalendarIntervals;
      if (calendarDays > this.limits.slaCalendarDays || calendarIntervals > this.limits.slaCalendarIntervals) return unavailableSla('sla_calendar_work_cap_exceeded', parsedWindow.receipt, now);
      for (const [target, kind] of [[evaluation.response, 'response'], [evaluation.resolution, 'resolution']] as const) {
        if (!target) return unavailableSla('malformed_sla_clock_or_calendar', parsedWindow.receipt, now);
        if (!target.dueAt) continue;
        const dueAt = new Date(target.dueAt).getTime();
        if (dueAt < parsedWindow.startsAt.getTime() || dueAt >= parsedWindow.endsAt.getTime()) continue;
        if (kind === 'response') { responseDenominator += 1; if (target.completedOnTime) responseNumerator += 1; }
        else { resolutionDenominator += 1; if (target.completedOnTime) resolutionNumerator += 1; }
      }
    }
    const denominatorDescription = 'accepted intake clocks with a configured target and truthful deadline in the selected half-open window; targetless, legacy, and open-paused clocks are excluded';
    return { status: 'available', reason: null, selectedWindow: parsedWindow.receipt, asOf: now.toISOString(), freshThrough: new Date(now.getTime() + OPERATIONAL_METRICS_FRESHNESS_MS).toISOString(),
      firstResponse: { numerator: responseNumerator, denominator: responseDenominator, denominatorDescription },
      resolution: { numerator: resolutionNumerator, denominator: resolutionDenominator, denominatorDescription },
    };
  }
}
