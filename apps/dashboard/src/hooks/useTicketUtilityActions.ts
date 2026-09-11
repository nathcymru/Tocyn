import { useQuery } from '@tanstack/react-query';
import {
  TICKET_UTILITY_ACTION_VERSION,
  isAllowedTicketUtilityLink,
  type TicketUtilityAction,
  type TicketUtilityActionsV1,
} from '@luminatick/shared';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const ids = new Set(['copy-ticket-reference', 'view-ticket-reference', 'open-governed-action-guidance']);

/** Reject a malformed or broadened manifest before it can alter dashboard behavior. */
export function parseTicketUtilityActions(value: unknown, ticketId: string): TicketUtilityActionsV1 {
  const invalid = () => { throw new Error('Ticket actions are unavailable.'); };
  if (!record(value) || value.version !== TICKET_UTILITY_ACTION_VERSION || value.ticketId !== ticketId || !Array.isArray(value.actions) || value.actions.length !== 3) return invalid();
  const seen = new Set<string>();
  const actions: TicketUtilityAction[] = [];
  for (const candidate of value.actions) {
    if (!record(candidate) || typeof candidate.id !== 'string' || !ids.has(candidate.id) || seen.has(candidate.id)
      || typeof candidate.label !== 'string' || candidate.label.length < 1 || candidate.label.length > 120
      || typeof candidate.description !== 'string' || candidate.description.length < 1 || candidate.description.length > 240
      || candidate.capability !== 'tools.reference.read' || (candidate.slot !== 'action-bar' && candidate.slot !== 'more')
      || typeof candidate.enabled !== 'boolean') return invalid();
    if (candidate.enabled === false && (typeof candidate.reason !== 'string' || candidate.reason.length < 1 || candidate.reason.length > 240)) return invalid();
    if (candidate.enabled === true && candidate.reason !== undefined) return invalid();
    seen.add(candidate.id);
    if (candidate.id === 'copy-ticket-reference') {
      if (candidate.kind !== 'application-command' || candidate.command !== 'copy-ticket-reference' || candidate.slot !== 'action-bar') return invalid();
    } else if (candidate.id === 'view-ticket-reference') {
      if (candidate.kind !== 'internal-dialog' || candidate.dialog !== 'ticket-reference' || candidate.slot !== 'more') return invalid();
    } else if (candidate.kind !== 'external-link' || candidate.slot !== 'more' || !isAllowedTicketUtilityLink(candidate.href)) return invalid();
    actions.push(candidate as TicketUtilityAction);
  }
  return { version: TICKET_UTILITY_ACTION_VERSION, ticketId, actions };
}

export function useTicketUtilityActions(ticketId: string) {
  const generation = useAuthStore(state => state.sessionGeneration);
  return useQuery({
    queryKey: ['ticket-utility-actions', generation, ticketId],
    queryFn: async () => parseTicketUtilityActions(await dashboardApi.get<unknown>(`/tickets/${encodeURIComponent(ticketId)}/utility-actions`), ticketId),
    enabled: Boolean(ticketId),
    retry: false,
  });
}
