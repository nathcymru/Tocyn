import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';

export type TicketHistoryActor = Readonly<{
  kind: 'api-key' | 'customer' | 'staff';
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
  return useQuery({
    queryKey: ['ticket', ticketId, 'history'],
    queryFn: () => dashboardApi.get<TicketHistoryResponse>(`/tickets/${ticketId}/history?limit=5`),
    enabled: !!ticketId && enabled,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });
}
