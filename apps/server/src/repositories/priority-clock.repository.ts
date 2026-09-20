import type { D1Database } from '@cloudflare/workers-types';
import { absoluteWindowHours, type ContractTier, type CriticalityTier } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import type { TicketStateWriteFence } from './support-state.repository';

export interface PriorityClockRow {
  ticket_id: string;
  started_at: string;
  active_since: string | null;
  accrued_active_ms: number;
  stop_reason: 'waiting' | 'snoozed' | 'resolved' | null;
  last_support_state_revision: number;
  revision: number;
  updated_at: string;
  contract_sla_tier: ContractTier | null;
  criticality_tier: CriticalityTier | null;
}

export interface PriorityClockProjection {
  ticketId: string;
  elapsedActiveMs: number;
  timeRemainingHours: number;
  paused: boolean;
  stopReason: 'waiting' | 'snoozed' | 'resolved' | null;
  supportStateRevision: number;
  clockRevision: number;
}

function instant(value: string): number {
  if (typeof value !== 'string' || value.length > 64 ||
    !/^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/.test(value)) {
    throw new RangeError('Invalid priority clock timestamp');
  }
  const parsed = Date.parse(value.includes(' ') ? value.replace(' ', 'T') + 'Z' : value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError('Invalid priority clock timestamp');
  return parsed;
}

/** Projects one persisted clock at a server-supplied instant; negative hours mean overdue. */
export function projectPriorityClock(row: PriorityClockRow, asOfMs: number): PriorityClockProjection | null {
  if (!Number.isSafeInteger(asOfMs) || asOfMs < 0) throw new RangeError('Invalid priority clock evaluation instant');
  if (row.contract_sla_tier === null || row.criticality_tier === null) return null;
  const window = absoluteWindowHours(row.contract_sla_tier, row.criticality_tier);
  const startedAt = instant(row.started_at);
  const updatedAt = instant(row.updated_at);
  if (updatedAt < startedAt || !Number.isSafeInteger(row.accrued_active_ms) || row.accrued_active_ms < 0 ||
    !Number.isSafeInteger(row.last_support_state_revision) || row.last_support_state_revision < 1 ||
    !Number.isSafeInteger(row.revision) || row.revision < 1 ||
    (row.active_since === null) !== (row.stop_reason !== null)) {
    throw new RangeError('Invalid persisted priority clock');
  }
  const activeSince = row.active_since === null ? null : instant(row.active_since);
  if (activeSince !== null && (activeSince < startedAt || activeSince > updatedAt)) {
    throw new RangeError('Invalid priority clock active interval');
  }
  const elapsedActiveMs = row.accrued_active_ms + (activeSince === null ? 0 : Math.max(0,asOfMs - activeSince));
  if (!Number.isSafeInteger(elapsedActiveMs)) throw new RangeError('Priority clock elapsed time is outside safe bounds');
  return {
    ticketId: row.ticket_id,
    elapsedActiveMs,
    timeRemainingHours: window - elapsedActiveMs / 3_600_000,
    paused: row.stop_reason !== null,
    stopReason: row.stop_reason,
    supportStateRevision: row.last_support_state_revision,
    clockRevision: row.revision,
  };
}

/** Bounded single-ticket read with live staff, tenant and group fences. */
export class PriorityClockRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  /** Project only an already selected dashboard page, with the current staff visibility fence. */
  async getPageForStaff(ticketIds: readonly string[], fence: TicketStateWriteFence, asOfMs: number): Promise<Record<string, PriorityClockProjection | null>> {
    if (fence.tenantId !== this.scope.tenantId || fence.actorId !== this.scope.actorId ||
      (fence.role !== 'admin' && fence.role !== 'agent') || !Number.isSafeInteger(fence.sessionVersion) ||
      !Number.isSafeInteger(asOfMs) || asOfMs < 0 || ticketIds.length > 100 ||
      ticketIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      new Set(ticketIds).size !== ticketIds.length) throw new RangeError('Invalid priority clock page');
    const clocks: Record<string, PriorityClockProjection | null> = Object.create(null);
    for (const id of ticketIds) clocks[id] = null;
    if (!ticketIds.length) return clocks;
    // D1 limits bound variables per statement. Each page is at most 100 IDs;
    // split it into two fixed-size, staff-fenced reads.
    for (let start = 0; start < ticketIds.length; start += 50) {
      const chunk = ticketIds.slice(start,start+50);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await this.db.prepare(`SELECT c.ticket_id,c.started_at,c.active_since,c.accrued_active_ms,c.stop_reason,
      c.last_support_state_revision,c.revision,c.updated_at,t.contract_sla_tier,t.criticality_tier
      FROM ticket_priority_clocks c JOIN tickets t ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id
      JOIN users actor ON actor.tenant_id=t.tenant_id AND actor.id=? AND actor.role=? AND actor.session_version=?
      WHERE c.tenant_id=? AND c.ticket_id IN (${placeholders}) AND
        (actor.role='admin' OR t.group_id IS NULL OR EXISTS (
          SELECT 1 FROM user_groups membership WHERE membership.tenant_id=t.tenant_id
            AND membership.user_id=actor.id AND membership.group_id=t.group_id))`)
        .bind(fence.actorId,fence.role,fence.sessionVersion,this.scope.tenantId,...chunk).all<PriorityClockRow>();
      for (const row of rows.results) clocks[row.ticket_id] = projectPriorityClock(row,asOfMs);
    }
    return clocks;
  }

  async getForStaff(ticketId: string, fence: TicketStateWriteFence, asOfMs: number): Promise<PriorityClockProjection | null> {
    if (fence.tenantId !== this.scope.tenantId || fence.actorId !== this.scope.actorId ||
      (fence.role !== 'admin' && fence.role !== 'agent') || !Number.isSafeInteger(fence.sessionVersion) ||
      typeof ticketId !== 'string' || !ticketId || ticketId.length > 128) return null;
    const row = await this.db.prepare(`SELECT c.ticket_id,c.started_at,c.active_since,c.accrued_active_ms,c.stop_reason,
      c.last_support_state_revision,c.revision,c.updated_at,t.contract_sla_tier,t.criticality_tier
      FROM ticket_priority_clocks c JOIN tickets t ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id
      JOIN users actor ON actor.tenant_id=t.tenant_id AND actor.id=? AND actor.role=? AND actor.session_version=?
      WHERE c.tenant_id=? AND c.ticket_id=? AND
        (actor.role='admin' OR t.group_id IS NULL OR EXISTS (
          SELECT 1 FROM user_groups membership WHERE membership.tenant_id=t.tenant_id
            AND membership.user_id=actor.id AND membership.group_id=t.group_id))
      LIMIT 1`).bind(fence.actorId,fence.role,fence.sessionVersion,this.scope.tenantId,ticketId).first<PriorityClockRow>();
    return row ? projectPriorityClock(row,asOfMs) : null;
  }
}
