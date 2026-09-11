import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';

export type SlaTarget = Readonly<{
  state: 'unavailable' | 'on-track' | 'breached';
  /** Lifecycle is separate from the preserved breach outcome. */
  phase: 'unavailable' | 'running' | 'paused' | 'completed';
  completedAt: string | null;
  dueAt: string | null;
  remainingWorkingMilliseconds: number | null;
  targetWorkingMilliseconds: number | null;
}>;

export type TicketSla = Readonly<{ response: SlaTarget; resolution: SlaTarget; handlerName: string | null }>;

const targetStates = new Set<SlaTarget['state']>(['unavailable', 'on-track', 'breached']);
const targetPhases = new Set<SlaTarget['phase']>(['unavailable', 'running', 'paused', 'completed']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)));
}

function isNullableDuration(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function parseSlaTarget(value: unknown): SlaTarget | null {
  if (!isRecord(value) || !targetStates.has(value.state as SlaTarget['state']) || !targetPhases.has(value.phase as SlaTarget['phase']) ||
    !isNullableTimestamp(value.completedAt) || !isNullableTimestamp(value.dueAt) ||
    !isNullableDuration(value.remainingWorkingMilliseconds) || !isNullableDuration(value.targetWorkingMilliseconds)) return null;
  return value as SlaTarget;
}

/** Reject malformed server data before it reaches a shared query cache or SLA surface. */
export function parseTicketSla(value: unknown): TicketSla {
  if (!isRecord(value)) throw new Error('Malformed service level response');
  const response = parseSlaTarget(value.response);
  const resolution = parseSlaTarget(value.resolution);
  if (!response || !resolution || (value.handlerName !== null && typeof value.handlerName !== 'string')) {
    throw new Error('Malformed service level response');
  }
  return { response, resolution, handlerName: value.handlerName };
}

function parseTicketSlaBatch(value: unknown): Record<string, TicketSla> {
  if (!isRecord(value)) throw new Error('Malformed service level response');
  return Object.fromEntries(Object.entries(value).map(([ticketId, projection]) => [ticketId, parseTicketSla(projection)]));
}

export function useTicketSla(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: ['ticket', ticketId, 'sla'],
    queryFn: async () => parseTicketSla(await dashboardApi.get<unknown>(`/tickets/${ticketId}/sla`)),
    enabled: Boolean(ticketId) && enabled,
    retry: false,
    // One shared query key per detail ticket refreshes live due/breach state;
    // list rows receive a supplied batch projection and create no timers.
    refetchInterval: 30_000,
  });
}

/** Covers every visible row with sequential requests of at most 25 IDs each.
 * A failed chunk rejects the refresh rather than publishing an incomplete map.
 */
export async function fetchTicketSlaBatch(ticketIds: readonly string[]): Promise<Record<string, TicketSla>> {
  const ids = [...new Set(ticketIds)];
  const projections: Record<string, TicketSla> = {};
  for (let offset = 0; offset < ids.length; offset += 25) {
    Object.assign(projections, parseTicketSlaBatch(await dashboardApi.post<unknown>('/ticket-sla/projections', { ticketIds: ids.slice(offset, offset + 25) })));
  }
  return projections;
}

export function useTicketSlaBatch(ticketIds: readonly string[], enabled = true) {
  const ids = [...new Set(ticketIds)];
  return useQuery({ queryKey: ['ticket-sla', ids], queryFn: () => fetchTicketSlaBatch(ids),
    enabled: enabled && ids.length > 0, retry: false, refetchInterval: 30_000 });
}
