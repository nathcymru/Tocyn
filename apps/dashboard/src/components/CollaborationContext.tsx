import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COLLABORATION_TYPING_EVENT,
  COLLABORATION_TYPING_IDLE_MS,
  COLLABORATION_MAX_TYPING_PRESENCES,
  COLLABORATION_TYPING_MIN_EMIT_INTERVAL_MS,
  createCollaborationTypingPayload,
  parseCollaborationTypingMessage,
  type CollaborationTypingPresence,
} from '@luminatick/shared';
import { useRealtime, type RealtimePresence } from '../hooks/useRealtime';
import { useAuthStore } from '../store/authStore';

type TypingAnnouncement = Readonly<{ ticketId: string; baseConversationRevision: number; active: boolean }>;
type CollaborationContextValue = Readonly<{
  isConnected: boolean;
  lastMessage: ReturnType<typeof useRealtime>['lastMessage'];
  connectionDetails: ReturnType<typeof useRealtime>['connectionDetails'];
  manualReconnect: ReturnType<typeof useRealtime>['manualReconnect'];
  updateLocation: ReturnType<typeof useRealtime>['updateLocation'];
  viewersForTicket: (ticketId: string) => readonly RealtimePresence[];
  typingForTicket: (ticketId: string) => readonly CollaborationTypingPresence[];
  announceTyping: (announcement: TypingAnnouncement) => void;
  stopTyping: (ticketId: string, baseConversationRevision: number) => void;
}>;

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

type LocalTypingState = { ticketId: string; baseConversationRevision: number; active: boolean; lastSentAt: number; idleTimer: number | null };

/** One dashboard-wide realtime consumer. Presence and typing never grant access or lock a ticket. */
export function CollaborationProvider({ children }: { children: ReactNode }) {
  const realtime = useRealtime();
  const sessionGeneration = useAuthStore(state => state.sessionGeneration);
  const [typing, setTyping] = useState<readonly CollaborationTypingPresence[]>([]);
  const typingRef = useRef<readonly CollaborationTypingPresence[]>([]);
  const localRef = useRef<LocalTypingState | null>(null);
  const realtimeRef = useRef({
    isConnected: realtime.isConnected,
    sendRealtime: realtime.sendRealtime,
    updateLocation: realtime.updateLocation,
    manualReconnect: realtime.manualReconnect,
  });
  realtimeRef.current = {
    isConnected: realtime.isConnected,
    sendRealtime: realtime.sendRealtime,
    updateLocation: realtime.updateLocation,
    manualReconnect: realtime.manualReconnect,
  };

  const replaceTyping = useCallback((next: readonly CollaborationTypingPresence[]) => {
    const bounded = next.slice(-COLLABORATION_MAX_TYPING_PRESENCES);
    typingRef.current = bounded;
    setTyping(bounded);
  }, []);
  const clearLocalTimer = useCallback(() => {
    const local = localRef.current;
    if (local && local.idleTimer !== null) window.clearTimeout(local.idleTimer);
    if (local) local.idleTimer = null;
  }, []);
  const emit = useCallback((ticketId: string, baseConversationRevision: number, active: boolean) => {
    const payload = createCollaborationTypingPayload(ticketId, baseConversationRevision, active);
    if (!payload || !realtimeRef.current.isConnected || document.visibilityState === 'hidden') return false;
    const sent = realtimeRef.current.sendRealtime?.({ type: COLLABORATION_TYPING_EVENT, payload }) === true;
    if (sent) {
      const local = localRef.current;
      if (local) { local.active = active; local.lastSentAt = Date.now(); }
    }
    return sent;
  }, []);

  const stopTyping = useCallback((ticketId: string, baseConversationRevision: number) => {
    const local = localRef.current;
    if (!local || local.ticketId !== ticketId) return;
    clearLocalTimer();
    if (local.active) emit(ticketId, baseConversationRevision, false);
    localRef.current = null;
  }, [clearLocalTimer, emit]);

  const announceTyping = useCallback(({ ticketId, baseConversationRevision, active }: TypingAnnouncement) => {
    if (!active) { stopTyping(ticketId, baseConversationRevision); return; }
    // The indicator is static, including for motion-sensitive operators. While
    // a tab is hidden, no hint is sent and a reconnect never replays stale intent.
    if (document.visibilityState === 'hidden') return;
    const current = localRef.current;
    if (current && current.ticketId !== ticketId) stopTyping(current.ticketId, current.baseConversationRevision);
    const local = localRef.current ?? { ticketId, baseConversationRevision, active: false, lastSentAt: 0, idleTimer: null };
    local.baseConversationRevision = baseConversationRevision;
    localRef.current = local;
    const now = Date.now();
    if (!local.active || now - local.lastSentAt >= COLLABORATION_TYPING_MIN_EMIT_INTERVAL_MS) emit(ticketId, baseConversationRevision, true);
    clearLocalTimer();
    local.idleTimer = window.setTimeout(() => stopTyping(ticketId, baseConversationRevision), COLLABORATION_TYPING_IDLE_MS);
  }, [clearLocalTimer, emit, stopTyping]);

  useEffect(() => {
    const parsed = parseCollaborationTypingMessage(realtime.lastMessage);
    if (!parsed) return;
    const incoming = parsed.payload;
    const withoutActor = typingRef.current.filter(candidate => candidate.ticketId !== incoming.ticketId || candidate.actor.id !== incoming.actor.id);
    replaceTyping(incoming.active && incoming.expiresAt > Date.now() ? [...withoutActor, incoming] : withoutActor);
  }, [realtime.lastMessage, replaceTyping]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const current = typingRef.current.filter(candidate => candidate.expiresAt > now);
      if (current.length !== typingRef.current.length) replaceTyping(current);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [replaceTyping]);

  useEffect(() => {
    clearLocalTimer();
    localRef.current = null;
    replaceTyping([]);
  }, [sessionGeneration, realtime.isConnected, clearLocalTimer, replaceTyping]);

  useEffect(() => {
    const clearForHiddenDocument = () => {
      if (document.visibilityState !== 'hidden') return;
      clearLocalTimer();
      localRef.current = null;
      replaceTyping([]);
    };
    document.addEventListener('visibilitychange', clearForHiddenDocument);
    return () => document.removeEventListener('visibilitychange', clearForHiddenDocument);
  }, [clearLocalTimer, replaceTyping]);

  useEffect(() => () => clearLocalTimer(), [clearLocalTimer]);

  const updateLocation = useCallback((location: string | null) => realtimeRef.current.updateLocation(location), []);
  const manualReconnect = useCallback(() => realtimeRef.current.manualReconnect(), []);

  const value = useMemo<CollaborationContextValue>(() => ({
    isConnected: realtime.isConnected, lastMessage: realtime.lastMessage, connectionDetails: realtime.connectionDetails,
    manualReconnect, updateLocation,
    viewersForTicket: ticketId => {
      const scoped = realtime.presence.filter(viewer => viewer.location === `ticket:${ticketId}`);
      return Array.from(new Map(scoped.map(viewer => [viewer.userId, viewer])).values());
    },
    typingForTicket: ticketId => typing.filter(candidate => candidate.ticketId === ticketId && candidate.expiresAt > Date.now()),
    announceTyping, stopTyping,
  }), [announceTyping, manualReconnect, realtime.connectionDetails, realtime.isConnected, realtime.lastMessage, realtime.presence, stopTyping, typing, updateLocation]);

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>;
}

export function useCollaboration() {
  const context = useContext(CollaborationContext);
  if (!context) throw new Error('CollaborationProvider is required for dashboard collaboration.');
  return context;
}
