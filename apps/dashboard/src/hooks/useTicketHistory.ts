import { useInfiniteQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

export type TicketHistoryActor = Readonly<{
  kind: 'api-key' | 'customer' | 'staff' | 'system';
  id: string | null;
  provenance: 'api-key' | 'authenticated-customer' | 'mfa-staff';
}>;

export type TicketHistoryEvent = Readonly<{
  id: string;
  kind: string;
  recordedAt: string;
  source: string;
  visibility: 'public' | 'internal';
  actor: TicketHistoryActor;
  facts: Record<string, unknown>;
  articleId: string | null;
  sequence?: number;
}>;

export type TicketHistoryResponse = Readonly<{
  events: readonly TicketHistoryEvent[];
  nextCursor: string | null;
}>;

export function useTicketHistory(ticketId: string, enabled: boolean) {
  // TicketDetail remounts on authenticated identity changes; the API client
  // also aborts in-flight responses from the prior session.
  const { sessionGeneration: generation, user } = useAuthStore.getState();
  return useInfiniteQuery({
    queryKey: ['ticket', ticketId, 'history', generation, user?.tenant_id, user?.id, user?.role],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '5' });
      if (pageParam) params.set('cursor', pageParam);
      return dashboardApi.get<TicketHistoryResponse>(`/tickets/${ticketId}/history?${params}`);
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: !!ticketId && enabled,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });
}
