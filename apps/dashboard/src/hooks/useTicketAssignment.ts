import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

export const assignmentIdentity = () => {
  const { user, sessionGeneration } = useAuthStore.getState();
  return JSON.stringify([sessionGeneration, user?.tenant_id, user?.id, user?.role]);
};
type Attempt = { key: string; kind: 'balance' } | {
  key: string; kind: 'override'; body: { ownerId: string; expectedOwnerId: string | null; capacityOverride: { reason: string } };
};
type State = { phase: 'idle' | 'pending' | 'uncertain' | 'refreshing' | 'refresh-error' | 'denied'; message: string };

function assignmentController(ticketId: string, identity: string, refreshTicket: () => Promise<void>, invalidate: () => Promise<void>) {
  let state: State = { phase: 'idle', message: '' };
  let active = false;
  let attempt: Attempt | undefined;
  let acknowledged = '';
  const listeners = new Set<() => void>();
  const current = () => {
    const user = useAuthStore.getState().user;
    return active && assignmentIdentity() === identity && Boolean(user?.tenant_id && user.id && ['admin', 'agent'].includes(user.role));
  };
  const set = (next: State) => { state = next; listeners.forEach(listener => listener()); };
  const refresh = async () => {
    if (!current()) return;
    set({ phase: 'refreshing', message: acknowledged || 'Refreshing current ownership…' });
    try {
      await Promise.all([refreshTicket(), invalidate()]);
      if (!current()) return;
      attempt = undefined;
      set({ phase: 'idle', message: acknowledged || 'Current ownership refreshed. Review before submitting a new action.' });
    } catch {
      if (current()) set({ phase: 'refresh-error', message: `${acknowledged || 'Current ownership is not confirmed.'} Refresh the ticket before another action.` });
    }
  };
  const execute = async (operation: Attempt) => {
    if (!current() || state.phase === 'pending' || state.phase === 'refreshing') return;
    if (attempt !== operation) acknowledged = '';
    attempt = operation;
    set({ phase: 'pending', message: 'Submitting assignment…' });
    try {
      const headers = { 'Idempotency-Key': operation.key };
      const result = operation.kind === 'balance'
        ? await dashboardApi.post<unknown>(`/tickets/${encodeURIComponent(ticketId)}/balanced-assignment`, {}, { headers })
        : await dashboardApi.patch<unknown>(`/tickets/${encodeURIComponent(ticketId)}/responsible-owner`, operation.body, { headers });
      if (!current()) return;
      const value = result as Record<string, unknown> | null;
      if (!value || typeof value !== 'object') throw new Error('Invalid assignment response');
      if (operation.kind === 'balance') {
        if (typeof value.replayed !== 'boolean' || !['assigned', 'no_capacity'].includes(String(value.outcome))
          || (value.outcome === 'assigned' ? typeof value.ownerId !== 'string' : value.ownerId !== null)) throw new Error('Invalid routing response');
        acknowledged = value.replayed ? 'Previous routing result restored; current ownership is shown after refresh.'
          : value.outcome === 'no_capacity' ? 'No operator had capacity at this attempt. Current ownership is shown after refresh.'
            : 'Balanced assignment confirmed.';
      } else {
        if (value.success !== true || value.responsibleOwnerId !== operation.body.ownerId) throw new Error('Invalid assignment response');
        acknowledged = 'Assignment override confirmed and audited.';
      }
      attempt = undefined;
      await refresh();
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && error.status === 409) {
        attempt = undefined;
        acknowledged = 'Ticket eligibility, ownership or capacity changed. Your entered values are retained.';
        await refresh();
      } else if (error instanceof ApiError && [400, 403, 404, 410].includes(error.status)) {
        attempt = undefined;
        set({ phase: 'denied', message: 'Assignment was not authorized or is no longer available. Refresh current ownership before another action.' });
      } else {
        set({ phase: 'uncertain', message: 'The assignment outcome could not be confirmed. Retry this same action; it may already have committed.' });
      }
    }
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => state,
    start: () => { active = true; return () => { active = false; attempt = undefined; }; },
    balance: () => { if (current() && state.phase === 'idle') void execute({ kind: 'balance', key: crypto.randomUUID() }); },
    override: (ownerId: string, expectedOwnerId: string | null, reason: string) => {
      const user = useAuthStore.getState().user;
      if (!current() || state.phase !== 'idle' || user?.role !== 'admin' || !ownerId || !reason.trim()
        || new TextEncoder().encode(reason.trim()).length > 512) return;
      void execute({ kind: 'override', key: crypto.randomUUID(), body: { ownerId, expectedOwnerId, capacityOverride: { reason: reason.trim() } } });
    },
    retry: () => { if (state.phase === 'uncertain' && attempt) void execute(attempt); },
    refresh: () => { if (['refresh-error', 'denied'].includes(state.phase)) void refresh(); },
  };
}

export function useTicketAssignment(ticketId: string, refreshTicket: () => Promise<void>) {
  const user = useAuthStore(state => state.user);
  const generation = useAuthStore(state => state.sessionGeneration);
  const identity = JSON.stringify([generation, user?.tenant_id, user?.id, user?.role]);
  const refreshRef = useRef(refreshTicket);
  useLayoutEffect(() => { refreshRef.current = refreshTicket; }, [refreshTicket]);
  const client = useQueryClient();
  const controller = useMemo(() => assignmentController(ticketId, identity, () => refreshRef.current(), () =>
    client.invalidateQueries({ queryKey: ['tickets'] })), [ticketId, identity, client]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(controller.start, [controller]);
  return { ...state, identity, balance: controller.balance, override: controller.override, retry: controller.retry, refresh: controller.refresh,
    blocked: state.phase !== 'idle', inFlight: state.phase === 'pending' || state.phase === 'refreshing' };
}
