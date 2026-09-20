import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Ticket } from '@luminatick/shared';
import { ApiError, dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { assignmentIdentity } from './useTicketAssignment';
import { parseTicketSla, type TicketSla } from './useTicketSla';
import type { TicketQueryPage } from './useSlaPriorityTickets';

export const PRIORITY_MATRIX_SORTS = ['priority_focus', 'priority_criticality', 'priority_commitment'] as const;
export type PriorityMatrixSort = typeof PRIORITY_MATRIX_SORTS[number];
export function isPriorityMatrixSort(value: string | undefined): value is PriorityMatrixSort {
  return PRIORITY_MATRIX_SORTS.some(sort => sort === value);
}

/** A server-sampled fixed-hour clock, separate from the calendar-aware SLA. */
export type PriorityClockProjection = Readonly<{
  remainingHours: number;
  paused: boolean;
  asOf: string;
}>;

export type PriorityMatrixTicketQueryPage = TicketQueryPage & Readonly<{
  data: Ticket[];
  sla: Record<string, TicketSla | null>;
  priorityClocks: Record<string, PriorityClockProjection | null>;
  /** Whole eligible queue, counted before page slicing. */
  triageOverdueCount: number;
  asOf: string;
  next: string | null;
}>;

const restartError = () => new ApiError('The priority view changed or expired. Restart priority ordering.', 409, 'priority_sort_restart');
let nextLedgerId = 0;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Reject partial or malformed snapshots before they can enter the Inbox cache. */
export function parsePriorityMatrixPage(value: unknown, expectedPage: number): PriorityMatrixTicketQueryPage {
  const response = record(value);
  const meta = record(response?.meta);
  const data = response?.data;
  const slaInput = record(response?.sla);
  const clocksInput = record(response?.priorityClocks);
  const next = response?.next;
  if (!response || !meta || !Array.isArray(data) || !slaInput || !clocksInput
    || meta.page !== expectedPage || !Number.isSafeInteger(meta.total) || (meta.total as number) < 0
    || !Number.isSafeInteger(meta.limit) || (meta.limit as number) < 1 || (meta.limit as number) > 50
    || data.length > (meta.limit as number) || (meta.total as number) < data.length
    || !Number.isSafeInteger(meta.total_pages)
    || meta.total_pages !== Math.ceil((meta.total as number) / (meta.limit as number))
    || !Number.isSafeInteger(response.triageOverdueCount) || (response.triageOverdueCount as number) < 0
    || !validTimestamp(response.asOf)
    || (next !== null && (typeof next !== 'string' || !next || next.length > 2048))) {
    throw new Error('Malformed priority queue response');
  }

  const sla: Record<string, TicketSla | null> = Object.create(null);
  const priorityClocks: Record<string, PriorityClockProjection | null> = Object.create(null);
  for (const item of data) {
    const ticket = record(item);
    const id = ticket?.id;
    if (typeof id !== 'string' || !id || Object.hasOwn(priorityClocks, id)
      || !Object.hasOwn(slaInput, id) || !Object.hasOwn(clocksInput, id)) {
      throw new Error('Malformed priority queue row');
    }
    sla[id] = slaInput[id] === null ? null : parseTicketSla(slaInput[id]);
    const clock = clocksInput[id];
    if (clock === null) { priorityClocks[id] = null; continue; }
    const projection = record(clock);
    if (!projection || !Number.isFinite(projection.remainingHours)
      || typeof projection.paused !== 'boolean' || !validTimestamp(projection.asOf)) {
      throw new Error('Malformed priority clock projection');
    }
    priorityClocks[id] = {
      remainingHours: projection.remainingHours as number,
      paused: projection.paused,
      asOf: projection.asOf,
    };
  }
  return { ...response, data: data as Ticket[], meta: meta as PriorityMatrixTicketQueryPage['meta'],
    sla, priorityClocks, triageOverdueCount: response.triageOverdueCount as number,
    asOf: response.asOf, next: next as string | null };
}

/** Three mathematical views share one scoped cursor ledger, never a page-local sort. */
export function usePriorityMatrixTickets(params: Record<string, string>, enabled: boolean, onPeriodicRestart?: () => void) {
  const user = useAuthStore(state => state.user);
  const generation = useAuthStore(state => state.sessionGeneration);
  const identity = JSON.stringify([generation, user?.tenant_id, user?.id, user?.role]);
  const sort = isPriorityMatrixSort(params.sort) ? params.sort : 'priority_focus';
  const [revision, setRevision] = useState(0);
  const periodicRestartRef = useRef(onPeriodicRestart);
  useLayoutEffect(() => { periodicRestartRef.current = onPeriodicRestart; }, [onPeriodicRestart]);
  const selection = JSON.stringify(Object.entries(params).filter(([key]) => !['page', 'sort', 'cursor'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  // A cursor is meaningful only for the ledger that received page one. Give a
  // new ledger a new cache key, including after a route remount or sort return;
  // otherwise React Query can restore page one without restoring its cursor.
  const ledger = useMemo(() => ({ id: ++nextLedgerId, active: false, cursors: new Map<number, string | undefined>([[1, undefined]]), asOf: '' }), [identity, selection, sort, revision]);
  useLayoutEffect(() => { ledger.active = true; return () => { ledger.active = false; }; }, [ledger]);
  const page = Number(params.page ?? '1');
  const missingCursor = enabled && (!Number.isSafeInteger(page) || page < 1 || !ledger.cursors.has(page));
  const query = useQuery<PriorityMatrixTicketQueryPage>({
    queryKey: ['tickets', 'priority-matrix', identity, sort, selection, ledger.id, page, page > 1 ? ledger.asOf : 'first'],
    enabled: enabled && !missingCursor && Boolean(user?.tenant_id && user.id),
    retry: false,
    // The complete queue is ordered at one instant. A background refresh must
    // not mix rows from a new instant into old cursor pages.
    staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false,
    queryFn: async () => {
      if (!ledger.active || assignmentIdentity() !== identity) throw new DOMException('Obsolete priority queue', 'AbortError');
      const cursor = ledger.cursors.get(page);
      if (page > 1 && (!cursor || Date.now() - Date.parse(ledger.asOf) >= 30_000)) throw restartError();
      const search = new URLSearchParams(JSON.parse(selection));
      search.set('sort', sort);
      if (cursor) search.set('cursor', cursor);
      const value = await dashboardApi.get<unknown>(`/tickets?${search}`);
      if (!ledger.active || assignmentIdentity() !== identity) throw new DOMException('Obsolete priority queue', 'AbortError');
      const result = parsePriorityMatrixPage(value, page);
      if (page > 1 && result.asOf !== ledger.asOf) throw restartError();
      if (page === 1) { ledger.cursors.clear(); ledger.cursors.set(1, undefined); ledger.asOf = result.asOf; }
      if (result.next) ledger.cursors.set(page + 1, result.next);
      return result;
    },
  });
  useLayoutEffect(() => {
    if (!enabled || !user?.tenant_id || !user.id || !query.data?.asOf || query.error) return;
    let requested = false;
    const restart = () => {
      if (requested || !ledger.active || assignmentIdentity() !== identity || document.visibilityState !== 'visible') return;
      // A later page's signed cursor is tied to the old whole-queue snapshot.
      // Move the list to page one before changing the ledger; leave detail/draft alone.
      if (page > 1 && !periodicRestartRef.current) return;
      requested = true;
      periodicRestartRef.current?.();
      setRevision(value => value + 1);
    };
    // Paging does not extend the server snapshot's 30-second lifetime. Keep a
    // small floor for skewed/stale timestamps so malformed upstream timing
    // cannot create an unbounded request loop.
    const remaining = 30_000 - (Date.now() - Date.parse(ledger.asOf));
    const delay = Math.min(30_000, Math.max(1_000, remaining));
    const interval = window.setInterval(restart, delay);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - Date.parse(ledger.asOf) >= 30_000) restart();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, identity, ledger, page, query.data?.asOf, query.error, user?.id, user?.tenant_id]);
  const error = missingCursor ? restartError() : query.error;
  return { ...query, error, isError: Boolean(error), isLoading: missingCursor ? false : query.isLoading,
    data: error ? undefined : query.data, restartPriorityMatrix: () => setRevision(value => value + 1) };
}
