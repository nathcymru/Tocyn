import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { assignmentIdentity } from './useTicketAssignment';
import { Ticket, TicketWithDetails } from '@luminatick/shared';
import { isPriorityMatrixSort, usePriorityMatrixTickets } from './usePriorityMatrixTickets';
import { useSlaPriorityTickets, type TicketQueryPage } from './useSlaPriorityTickets';

export function useTickets(params: Record<string, string> = {}, enabled = true) {
  const user = useAuthStore(state => state.user);
  const generation = useAuthStore(state => state.sessionGeneration);
  const identity = JSON.stringify([generation, user?.tenant_id, user?.id, user?.role]);
  const queryParams = new URLSearchParams(params).toString();
  const sla = useSlaPriorityTickets(params, enabled && params.sort === 'sla_priority');
  const priorityMatrixSort = isPriorityMatrixSort(params.sort);
  const priorityMatrix = usePriorityMatrixTickets(params, enabled && priorityMatrixSort);
  const ordinary = useQuery({
    enabled: enabled && params.sort !== 'sla_priority' && !priorityMatrixSort && Boolean(user?.id),
    queryKey: ['tickets', params, identity],
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === identity ? previous : undefined,
    queryFn: async () => {
      if (assignmentIdentity() !== identity) throw new DOMException('Obsolete ticket list response', 'AbortError');
      const data = await dashboardApi.get<TicketQueryPage>(`/tickets?${queryParams}`);
      if (assignmentIdentity() !== identity) throw new DOMException('Obsolete ticket list response', 'AbortError');
      return data;
    },
    refetchInterval: () => document.visibilityState === 'visible' ? 30000 : false,
  });
  if (params.sort === 'sla_priority') return { ...sla, restartPriorityMatrix: priorityMatrix.restartPriorityMatrix };
  if (priorityMatrixSort) return { ...priorityMatrix, restartSla: sla.restartSla };
  return { ...ordinary, restartSla: sla.restartSla, restartPriorityMatrix: priorityMatrix.restartPriorityMatrix };
}

type TicketPage = TicketWithDetails & { pagination?: { next_cursor: string | null; has_more: boolean } };
export function useTicket(id: string) {
  const user = useAuthStore(state => state.user);
  const generation = useAuthStore(state => state.sessionGeneration);
  const identity = assignmentIdentity();
  const query = useInfiniteQuery({
    queryKey: ['ticket', id, user?.tenant_id, user?.id, user?.role, generation],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const result = await dashboardApi.get<TicketPage>(`/tickets/${id}${pageParam ? `?article_cursor=${encodeURIComponent(pageParam)}` : ''}`);
      if (assignmentIdentity() !== identity) throw new DOMException('Obsolete ticket response', 'AbortError');
      return result;
    },
    getNextPageParam: (page) => page.pagination?.next_cursor ?? undefined,
    enabled: !!id,
    refetchInterval: () => document.visibilityState === 'visible' ? 30000 : false,
  });
  const first = query.data?.pages[0];
  return { ...query, data: first ? { ...first, articles: query.data!.pages.flatMap(page => page.articles) } : undefined };
}

export type TicketChanges = Omit<Partial<Ticket>, 'assigned_to' | 'group_id'> & { assigned_to?: string | null; group_id?: string | null };

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: TicketChanges & { id: string }) =>
      dashboardApi.patch<{ success: true }>(`/tickets/${id}`, data),
    onSuccess: (_, variables) => {
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
        queryClient.invalidateQueries({ queryKey: ['ticket', variables.id] }),
      ]);
    },
  });
}

/** The #137 owner transition is distinct from ordinary ticket field edits. */
export function useAssignResponsibleOwner() {
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: () => assignmentIdentity(),
    mutationFn: ({ id, ownerId, expectedOwnerId, idempotencyKey }: {
      id: string; ownerId: string | null; expectedOwnerId: string | null; idempotencyKey: string;
    }) => dashboardApi.patch<{ success: true; responsibleOwnerId: string | null }>(`/tickets/${id}/responsible-owner`,
      { ownerId, expectedOwnerId }, { headers: { 'Idempotency-Key': idempotencyKey } }),
    onSuccess: (_, variables, identity) => {
      if (identity !== assignmentIdentity()) return;
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
        queryClient.invalidateQueries({ queryKey: ['ticket', variables.id] }),
      ]);
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

export type StandardQueueKey='all'|'actionable'|'mine'|'unassigned'|'mentions'|'drafts'|'snoozed';
export function useStandardQueueCounts(){
  return useQuery({queryKey:['tickets','standard-queue-counts'],
    queryFn:async()=>{
      const result=await dashboardApi.get<{scope:string;counts:Record<StandardQueueKey,number>}>('/tickets/queue-counts');
      if(result.scope!=='standard_queues'||!result.counts||(['all','actionable','mine','unassigned','mentions','drafts','snoozed'] as const)
        .some(key=>!Number.isSafeInteger(result.counts[key])||result.counts[key]<0))throw new Error('Queue counts unavailable');
      return result.counts;
    },refetchInterval:()=>document.visibilityState==='visible'?30000:false});
}
