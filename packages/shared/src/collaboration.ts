/**
 * Advisory, tenant-qualified collaboration messages carried by the existing
 * realtime connection. The server derives actor, tenant and session authority
 * from its websocket attachment; clients must never supply those fields.
 */
export const COLLABORATION_TYPING_EVENT = 'collaboration.typing.v1' as const;
export const COLLABORATION_TYPING_PROTOCOL_VERSION = 1 as const;
export const COLLABORATION_MAX_TICKET_ID_LENGTH = 100;
export const COLLABORATION_MAX_ACTOR_ID_LENGTH = 128;
export const COLLABORATION_MAX_ACTOR_NAME_LENGTH = 120;
/** Match the existing NotificationDO connection ceiling; never retain unbounded hints. */
export const COLLABORATION_MAX_TYPING_PRESENCES = 128;
export const COLLABORATION_TYPING_TTL_MS = 6_000;
export const COLLABORATION_TYPING_IDLE_MS = 3_500;
export const COLLABORATION_TYPING_MIN_EMIT_INTERVAL_MS = 1_000;
/** Internal notes may address a bounded set of current staff recipients. */
export const COLLABORATION_MAX_MENTION_RECIPIENTS = 16;
const COLLABORATION_MENTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Canonicalize mention intent before it enters either a draft or a ticket
 * mutation. Recipient existence and tenant/group access remain server-side
 * checks at the canonical commit boundary.
 */
export function normalizeCollaborationMentionIds(
  input: readonly string[] | undefined,
  mode: 'public' | 'internal',
  actorId: string,
): readonly string[] | null {
  const ids = [...new Set(input ?? [])].sort();
  if (ids.length > COLLABORATION_MAX_MENTION_RECIPIENTS
    || ids.some(id => !COLLABORATION_MENTION_ID.test(id) || id === actorId)
    || (ids.length > 0 && mode !== 'internal')) return null;
  return ids;
}

export type CollaborationTypingClientPayload = Readonly<{
  version: typeof COLLABORATION_TYPING_PROTOCOL_VERSION;
  ticketId: string;
  baseConversationRevision: number;
  active: boolean;
}>;

/** This payload is server-authored after ticket and session authorization. */
export type CollaborationTypingPresence = Readonly<{
  version: typeof COLLABORATION_TYPING_PROTOCOL_VERSION;
  ticketId: string;
  actor: Readonly<{ id: string; name: string }>;
  active: boolean;
  expiresAt: number;
}>;

export type CollaborationTypingMessage = Readonly<{
  type: typeof COLLABORATION_TYPING_EVENT;
  payload: CollaborationTypingPresence;
}>;

export function createCollaborationTypingPayload(ticketId: string, baseConversationRevision: number, active: boolean): CollaborationTypingClientPayload | null {
  if (typeof ticketId !== 'string' || ticketId.length === 0 || ticketId.length > COLLABORATION_MAX_TICKET_ID_LENGTH) return null;
  if (!Number.isSafeInteger(baseConversationRevision) || baseConversationRevision < 0) return null;
  return { version: COLLABORATION_TYPING_PROTOCOL_VERSION, ticketId, baseConversationRevision, active };
}

/** Reject malformed broadcasts before they can become a visible collaboration hint. */
export function parseCollaborationTypingMessage(message: unknown): CollaborationTypingMessage | null {
  if (!message || typeof message !== 'object') return null;
  const candidate = message as { type?: unknown; payload?: unknown };
  if (candidate.type !== COLLABORATION_TYPING_EVENT || !candidate.payload || typeof candidate.payload !== 'object') return null;
  const payload = candidate.payload as { version?: unknown; ticketId?: unknown; actor?: unknown; active?: unknown; expiresAt?: unknown };
  if (payload.version !== COLLABORATION_TYPING_PROTOCOL_VERSION || typeof payload.ticketId !== 'string' ||
    payload.ticketId.length === 0 || payload.ticketId.length > COLLABORATION_MAX_TICKET_ID_LENGTH ||
    typeof payload.active !== 'boolean' || typeof payload.expiresAt !== 'number' || !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt > Date.now() + COLLABORATION_TYPING_TTL_MS) return null;
  if (!payload.actor || typeof payload.actor !== 'object') return null;
  const actor = payload.actor as { id?: unknown; name?: unknown };
  if (typeof actor.id !== 'string' || actor.id.length === 0 || actor.id.length > COLLABORATION_MAX_ACTOR_ID_LENGTH ||
    typeof actor.name !== 'string' || actor.name.length === 0 || actor.name.length > COLLABORATION_MAX_ACTOR_NAME_LENGTH) return null;
  return { type: COLLABORATION_TYPING_EVENT, payload: {
    version: COLLABORATION_TYPING_PROTOCOL_VERSION, ticketId: payload.ticketId,
    actor: { id: actor.id, name: actor.name }, active: payload.active, expiresAt: payload.expiresAt,
  } };
}
