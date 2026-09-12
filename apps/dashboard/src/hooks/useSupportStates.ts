import { useMutation, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';

export type SupportLifecycle = 'open' | 'pending' | 'resolved' | 'closed';

export type SupportStateDefinition = Readonly<{
  id: string;
  legacy_status: SupportLifecycle;
  internal_label: string;
  public_label: string;
  waiting_reason_required: number;
  next_action_required: number;
  is_compatibility_default: number;
  is_active: number;
}>;

export type TicketSupportState = Readonly<{
  ticket_id: string;
  definition_id: string;
  lifecycle: SupportLifecycle;
  internal_label: string;
  public_label: string;
  waiting_reason: string | null;
  next_action: string | null;
  snoozed_until: string | null;
  resurface_reason: 'manual' | 'due' | 'customer_reply' | null;
  changed_at: string;
  revision: number;
}>;

export type SupportStateDefinitionInput = Readonly<{
  id: string;
  legacyStatus: SupportLifecycle;
  internalLabel: string;
  publicLabel: string;
  waitingReasonRequired: boolean;
  nextActionRequired: boolean;
}>;

export function useSupportStates(includeInactive = false) {
  const query = useInfiniteQuery({
    queryKey: ['support-states', { includeInactive }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      // The guarded local-beta read policy caps list pages at 50. Keep the
      // dashboard under that shared bound and continue explicitly by cursor.
      const params = new URLSearchParams({ limit: '50' });
      if (includeInactive) params.set('include_inactive', 'true');
      if (pageParam) params.set('cursor', pageParam);
      const response = await dashboardApi.getWithHeaders<SupportStateDefinition[]>(`/support-states?${params}`);
      return { definitions: response.data, nextCursor: response.headers.get('X-Next-Cursor') };
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  return {
    ...query,
    data: query.data?.pages.flatMap(page => page.definitions) ?? [],
    loadMore: () => query.fetchNextPage({ cancelRefetch: false }),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    isLoadMoreError: query.isFetchNextPageError,
  };
}

export function useTicketSupportState(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: ['ticket', ticketId, 'support-state'],
    queryFn: () => dashboardApi.get<TicketSupportState>(`/tickets/${ticketId}/support-state`),
    enabled: Boolean(ticketId) && enabled,
  });
}

export function useTransitionSupportState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, ...body }: {
      ticketId: string;
      definitionId: string;
      waitingReason?: string | null;
      nextAction?: string | null;
      snoozedUntil?: string | null;
      expectedRevision: number;
    }) => dashboardApi.patch<TicketSupportState>(`/tickets/${ticketId}/support-state`, body),
    onSuccess: (state, { ticketId }) => Promise.all([
      queryClient.setQueryData(['ticket', ticketId, 'support-state'], state),
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] }),
      queryClient.invalidateQueries({ queryKey: ['tickets'] }),
    ]),
  });
}

export function useCreateSupportState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SupportStateDefinitionInput) => dashboardApi.post<SupportStateDefinition>('/support-states', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-states'] }),
  });
}

export function useUpdateSupportState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SupportStateDefinitionInput> & { id: string }) => dashboardApi.patch<SupportStateDefinition>(`/support-states/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-states'] }),
  });
}

export function useDeactivateSupportState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, replacementId, waitingReason, nextAction }: { id: string; replacementId: string; waitingReason?: string | null; nextAction?: string | null }) =>
      dashboardApi.post<{ success: true }>(`/support-states/${id}/deactivate`, { replacementId, waitingReason, nextAction }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-states'] }),
  });
}
