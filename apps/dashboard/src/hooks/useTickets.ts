import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import { Ticket, TicketWithDetails, PaginatedResponse } from '@luminatick/shared';

export function useTickets(params: Record<string, string> = {}) {
  const queryParams = new URLSearchParams(params).toString();
  return useQuery({
    queryKey: ['tickets', params],
    queryFn: async () => {
      const data = await dashboardApi.get<PaginatedResponse<Ticket>>(`/tickets?${queryParams}`);
      return data;
    },
    refetchInterval: () => document.visibilityState === 'visible' ? 30000 : false,
  });
}

type TicketPage = TicketWithDetails & { pagination?: { next_cursor: string | null; has_more: boolean } };
export function useTicket(id: string) {
  const query = useInfiniteQuery({
    queryKey: ['ticket', id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => dashboardApi.get<TicketPage>(`/tickets/${id}${pageParam ? `?article_cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (page) => page.pagination?.next_cursor ?? undefined,
    enabled: !!id,
    refetchInterval: () => document.visibilityState === 'visible' ? 30000 : false,
  });
  const first = query.data?.pages[0];
  return { ...query, data: first ? { ...first, articles: query.data!.pages.flatMap(page => page.articles) } : undefined };
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Ticket> & { id: string }) =>
      dashboardApi.patch<Ticket>(`/tickets/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.id] });
    },
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      subject: string;
      customer_email: string;
      body: string;
      priority?: string;
      status?: string;
      group_id?: string;
      assigned_to?: string;
      custom_fields?: Record<string, any>;
    }) => dashboardApi.post<Ticket>('/tickets', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}
