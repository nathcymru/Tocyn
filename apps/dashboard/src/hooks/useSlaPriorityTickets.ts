import { useLayoutEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaginatedResponse, Ticket } from '@luminatick/shared';
import { ApiError, dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { assignmentIdentity } from './useTicketAssignment';
import { parseTicketSla, type TicketSla } from './useTicketSla';

export type TicketQueryPage = PaginatedResponse<Ticket> & {
  sla?: Record<string, TicketSla | null>; asOf?: string; next?: string | null;
};
const restartError = () => new ApiError('The SLA queue changed or expired. Restart SLA ordering.', 409, 'sla_sort_restart');

/** Cursor state belongs to one identity, filter and explicit snapshot refresh.
 * A restored page number alone never reconstructs a signed cursor. */
export function useSlaPriorityTickets(params: Record<string, string>, enabled: boolean) {
  const user = useAuthStore(state => state.user);
  const generation = useAuthStore(state => state.sessionGeneration);
  const identity = JSON.stringify([generation, user?.tenant_id, user?.id, user?.role]);
  const [revision, setRevision] = useState(0);
  const selection = JSON.stringify(Object.entries(params).filter(([key]) => !['page', 'sort', 'cursor'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  const ledger = useMemo(() => ({ active: false, cursors: new Map<number, string | undefined>([[1, undefined]]), asOf: '' }), [identity, selection, revision]);
  useLayoutEffect(() => { ledger.active = true; return () => { ledger.active = false; }; }, [ledger]);
  const page = Number(params.page ?? '1');
  const missingCursor = enabled && (!Number.isSafeInteger(page) || page < 1 || !ledger.cursors.has(page));
  const query = useQuery<TicketQueryPage>({
    queryKey: ['tickets', 'sla-priority', identity, selection, revision, page, page > 1 ? ledger.asOf : 'first'],
    enabled: enabled && !missingCursor && Boolean(user?.tenant_id && user.id),
    retry: false,
    // All pages describe one explicit snapshot. Background refresh would silently
    // mix different snapshots when moving backwards through cached pages.
    staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false,
    queryFn: async () => {
      if (!ledger.active || assignmentIdentity() !== identity) throw new DOMException('Obsolete SLA queue', 'AbortError');
      const cursor = ledger.cursors.get(page);
      if (page > 1 && (!cursor || Date.now() - Date.parse(ledger.asOf) >= 30_000)) throw restartError();
      const search = new URLSearchParams(JSON.parse(selection));
      search.set('sort', 'sla_priority');
      if (cursor) search.set('cursor', cursor);
      const result = await dashboardApi.get<TicketQueryPage>(`/tickets?${search}`);
      if (!ledger.active || assignmentIdentity() !== identity) throw new DOMException('Obsolete SLA queue', 'AbortError');
      if (!Array.isArray(result.data) || !result.meta || result.meta.page !== page || !Number.isSafeInteger(result.meta.total)
        || !Number.isSafeInteger(result.meta.limit) || result.meta.limit < 1 || result.meta.limit > 50
        || result.data.length > result.meta.limit || !Number.isSafeInteger(result.meta.total_pages)
        || result.meta.total_pages !== Math.ceil(result.meta.total / result.meta.limit) || result.meta.total < result.data.length || typeof result.asOf !== 'string' || !Number.isFinite(Date.parse(result.asOf))
        || (result.next !== null && (typeof result.next !== 'string' || result.next.length > 2048))
        || !result.sla || typeof result.sla !== 'object') throw new Error('Malformed SLA queue response');
      if (page > 1 && result.asOf !== ledger.asOf) throw restartError();
      const sla: Record<string, TicketSla | null> = Object.create(null);
      for (const ticket of result.data) {
        if (!ticket || typeof ticket.id !== 'string' || Object.hasOwn(sla, ticket.id) || !Object.hasOwn(result.sla, ticket.id)) throw new Error('Malformed SLA queue row');
        sla[ticket.id] = result.sla[ticket.id] === null ? null : parseTicketSla(result.sla[ticket.id]);
      }
      if (page === 1) { ledger.cursors.clear(); ledger.cursors.set(1, undefined); ledger.asOf = result.asOf; }
      if (result.next) ledger.cursors.set(page + 1, result.next);
      return { ...result, sla };
    },
  });
  const error = missingCursor ? restartError() : query.error;
  return { ...query, error, isError: Boolean(error), isLoading: missingCursor ? false : query.isLoading,
    data: error ? undefined : query.data, restartSla: () => setRevision(value => value + 1) };
}
