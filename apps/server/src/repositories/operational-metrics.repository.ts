import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';

export const OPERATIONAL_METRICS_VERSION = '2026-09-11.3' as const;
export const OPERATIONAL_METRICS_FRESHNESS_MS = 60_000;
export const OPERATIONAL_METRICS_TENANT_TICKET_CANDIDATE_LIMIT = 1_000;
export const OPERATIONAL_METRICS_TENANT_EVENT_CANDIDATE_LIMIT = 1_000;
export const OPERATIONAL_METRICS_ASSIGNEE_LIMIT = 100;

/** Versioned numerator, denominator, and time contracts; SLA/routing values remain unavailable. */
export const OPERATIONAL_METRIC_DEFINITIONS = Object.freeze({
  definitionVersion: OPERATIONAL_METRICS_VERSION,
  currentWork: Object.freeze({
    numerator: 'visible tenant tickets whose current status is open or pending',
    denominator: 'the same current-state ticket set at the projection snapshot',
    timeBasis: 'D1 statement snapshot; repository-issued server clock for asOf and freshThrough',
  }),
  sla: Object.freeze({
    status: 'unavailable' as const,
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
export type OperationalMetricProjection = Readonly<{
  definitionVersion: typeof OPERATIONAL_METRICS_VERSION; asOf: string; freshThrough: string;
  resourceLimits: Readonly<{ tenantTicketCandidates: number; tenantEventCandidates: number; assignees: number }>;
  currentWork: BoundedCurrentWork; canonicalEvents: BoundedCanonicalEvents;
  sla: Readonly<{ status: 'unavailable'; reason: 'SLA clocks, calendars, and pause semantics are owned by #73/#136' }>;
  routing: Readonly<{ status: 'unavailable'; reason: 'availability, ceilings, and routing decisions are owned by #137' }>;
}>;

/** Evaluate a receipt with a server-owned clock; serialized receipts do not self-update. */
export function isOperationalMetricProjectionFresh(projection: Pick<OperationalMetricProjection, 'freshThrough'>, clock: () => Date = () => new Date()): boolean {
  const expiry = Date.parse(projection.freshThrough); const now = clock().getTime();
  return Number.isFinite(expiry) && Number.isFinite(now) && now <= expiry;
}

type ProjectionRow = { row_kind: 'summary' | 'assignee'; actor_authorized: number | null; tenant_ticket_candidate_count: number | null; tenant_event_candidate_count: number | null; canonical_event_total: number | null; total: number | null; unassigned: number | null; latest_recorded_at: string | null; actor_id: string | null; assignee_count: number | null; };
type ProjectionLimits = Readonly<{ tenantTicketCandidates: number; tenantEventCandidates: number; assignees: number }>;
const DEFAULT_LIMITS: ProjectionLimits = Object.freeze({ tenantTicketCandidates: OPERATIONAL_METRICS_TENANT_TICKET_CANDIDATE_LIMIT, tenantEventCandidates: OPERATIONAL_METRICS_TENANT_EVENT_CANDIDATE_LIMIT, assignees: OPERATIONAL_METRICS_ASSIGNEE_LIMIT });
function boundedLimit(value: number | undefined, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || value < 1 || value > fallback) throw new Error('Invalid operational metric resource limit'); return value; }
function resolveLimits(limits?: Partial<ProjectionLimits>): ProjectionLimits { return Object.freeze({ tenantTicketCandidates: boundedLimit(limits?.tenantTicketCandidates, DEFAULT_LIMITS.tenantTicketCandidates), tenantEventCandidates: boundedLimit(limits?.tenantEventCandidates, DEFAULT_LIMITS.tenantEventCandidates), assignees: boundedLimit(limits?.assignees, DEFAULT_LIMITS.assignees) }); }

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
      sla: { status: 'unavailable', reason: 'SLA clocks, calendars, and pause semantics are owned by #73/#136' },
      routing: { status: 'unavailable', reason: 'availability, ceilings, and routing decisions are owned by #137' },
    };
  }
}
