import { Env } from '../bindings';
import { UserAuthResolver, type UserAuthResolution } from '../auth/user-auth-resolver';
import { createResourceOperationEmitter } from '../observability/resource-operation';
import { observeD1 } from '../repositories/observed-d1';
import { MAX_NOTIFICATION_CONNECTIONS } from './notification-limits';
import {
  COLLABORATION_MAX_ACTOR_ID_LENGTH,
  COLLABORATION_MAX_ACTOR_NAME_LENGTH,
  COLLABORATION_MAX_TICKET_ID_LENGTH,
  COLLABORATION_TYPING_EVENT,
  COLLABORATION_TYPING_MIN_EMIT_INTERVAL_MS,
  COLLABORATION_TYPING_PROTOCOL_VERSION,
  COLLABORATION_TYPING_TTL_MS,
  createCollaborationTypingPayload,
} from '@luminatick/shared';

interface SessionAttachment {
  connectionId: string;
  userId: string;
  name: string;
  location: string | null;
  tenantId: string;
  role: string;
  version: number;
  expiresAt: number;
}

/** Revalidate before delivery and every 30s within the supported registry bound; legacy overcapacity denies delivery. */
export class NotificationDO {
  /** Transient only: hibernation and reconnects intentionally discard typing state. */
  private readonly typingUpdates = new Map<WebSocket, Map<string, number>>();

  constructor(public state: DurableObjectState, private env: Env) {}

  private belongsToThisObject(session: SessionAttachment | null): session is SessionAttachment {
    return !!session && !!session.tenantId &&
      this.state.id.equals(this.env.NOTIFICATION_DO.idFromName(`tenant:${session.tenantId}`));
  }

  private async currentStaff(session: SessionAttachment | null): Promise<UserAuthResolution | null> {
    try {
      if (this.belongsToThisObject(session) && Number.isSafeInteger(session.expiresAt) && session.expiresAt * 1000 > Date.now() &&
          Number.isSafeInteger(session.version) && session.version >= 0 && ['agent', 'admin'].includes(session.role)) {
        // Each revalidation is an independently capped #159 diagnostic composition.
        const user = await UserAuthResolver.fromEnvironment(this.env, createResourceOperationEmitter(this.env))
          .resolveUserById(session.tenantId, session.userId);
        if (user && user.tenantId === session.tenantId && user.userId === session.userId &&
          user.role === session.role && user.sessionVersion === session.version && session.expiresAt * 1000 > Date.now()) return user;
      }
    } catch { /* Database failures deny delivery, including after hibernation. */ }
    return null;
  }

  private async authorized(session: SessionAttachment | null): Promise<boolean> {
    return !!await this.currentStaff(session);
  }

  private async activeStaff(ws: WebSocket, closeInvalid = true): Promise<UserAuthResolution | null> {
    if (ws.readyState !== WebSocket.OPEN) return null;
    const user = await this.currentStaff(ws.deserializeAttachment() as SessionAttachment | null);
    if (user) return user;
    if (closeInvalid) {
      try { ws.close(1008, 'Session no longer authorized'); } catch { /* Already closed. */ }
    }
    return null;
  }

  private async active(ws: WebSocket, closeInvalid = true): Promise<boolean> {
    return !!await this.activeStaff(ws, closeInvalid);
  }

  /** Never truncate recipients. Legacy overcapacity needs connections to drain before service resumes. */
  private boundedSockets(): WebSocket[] | null {
    const sockets = this.state.getWebSockets();
    return sockets.length <= MAX_NOTIFICATION_CONNECTIONS ? sockets : null;
  }

  private capacityDenied(): Response {
    return new Response('Realtime capacity temporarily unavailable', { status: 503, headers: { 'Retry-After': '30' } });
  }

  private presence(session: SessionAttachment) {
    return { connectionId: session.connectionId, userId: session.userId, name: session.name, location: session.location };
  }

  /** Current tenant, staff session, ticket and group membership are all required for this advisory signal. */
  private async authorizedForTicket(session: SessionAttachment | null, user: UserAuthResolution, ticketId: string): Promise<boolean> {
    if (!this.belongsToThisObject(session) || ticketId.length === 0 || ticketId.length > COLLABORATION_MAX_TICKET_ID_LENGTH) return false;
    try {
      const db = observeD1(this.env.DB, createResourceOperationEmitter(this.env));
      const ticket = await db.prepare('SELECT group_id FROM tickets WHERE tenant_id = ? AND id = ? LIMIT 1')
        .bind(session.tenantId, ticketId).first<{ group_id: string | null }>();
      if (!ticket) return false;
      if (user.role === 'admin' || ticket.group_id === null) return true;
      const membership = await db.prepare('SELECT 1 FROM user_groups WHERE tenant_id = ? AND user_id = ? AND group_id = ? LIMIT 1')
        .bind(session.tenantId, user.userId, ticket.group_id).first();
      return !!membership;
    } catch { /* A failed current authorization check must never disclose a typing event. */ }
    return false;
  }

  /** A small, transient per-socket map preserves ticket-specific throttling without retaining unbounded client keys. */
  private typingAllowed(ws: WebSocket, ticketId: string, now: number): boolean {
    const updates = this.typingUpdates.get(ws) ?? new Map<string, number>();
    this.typingUpdates.set(ws, updates);
    for (const [key, timestamp] of updates) if (now - timestamp >= COLLABORATION_TYPING_TTL_MS) updates.delete(key);
    const previous = updates.get(ticketId);
    if (previous !== undefined && now - previous < COLLABORATION_TYPING_MIN_EMIT_INTERVAL_MS) return false;
    // Do not evict a live key: rotating ticket ids could otherwise bypass its one-second throttle.
    // New keys wait for the short transient window to expire once this bounded map is full.
    if (!updates.has(ticketId) && updates.size >= 16) return false;
    updates.set(ticketId, now);
    return true;
  }

  private async fanoutTyping(sender: WebSocket, ticketId: string, message: unknown): Promise<boolean> {
    const sockets = this.boundedSockets();
    if (!sockets) return false;
    const results = await Promise.all(sockets.filter(ws => ws !== sender).map(async ws => {
      const recipient = await this.activeStaff(ws);
      if (!recipient) return true;
      if (!await this.authorizedForTicket(ws.deserializeAttachment() as SessionAttachment | null, recipient, ticketId)) return true;
      try { ws.send(JSON.stringify(message)); return true; }
      catch { return false; }
    }));
    return results.every(Boolean);
  }

  private async scheduleAlarm() {
    // Do not walk or repeatedly alarm an unbounded registry inherited from an older version.
    const sockets = this.boundedSockets();
    const expiries = (sockets ?? []).filter(ws => ws.readyState === WebSocket.OPEN).map(ws => (ws.deserializeAttachment() as SessionAttachment | null)?.expiresAt)
      .filter((expiry): expiry is number => typeof expiry === 'number' && expiry * 1000 > Date.now());
    if (expiries.length) await this.state.storage.setAlarm(Math.min(Date.now() + 30_000, ...expiries.map(expiry => expiry * 1000)));
    else await this.state.storage.deleteAlarm();
  }

  async alarm() {
    try { await Promise.all((this.boundedSockets() ?? []).map(ws => this.active(ws))); }
    finally { await this.scheduleAlarm(); }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/broadcast') {
      if (!this.boundedSockets()) return this.capacityDenied();
      return await this.broadcast(await request.json()) ? new Response('OK') : this.capacityDenied();
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected Upgrade: websocket', { status: 426 });
    const session: SessionAttachment = {
      connectionId: crypto.randomUUID(), userId: request.headers.get('X-User-ID') || '',
      name: request.headers.get('X-User-Name') || '', location: null,
      tenantId: request.headers.get('X-Tenant-ID') || '', role: request.headers.get('X-Session-Role') || '',
      version: Number(request.headers.get('X-Session-Version') ?? NaN),
      expiresAt: Number(request.headers.get('X-Session-Expiry') ?? NaN),
    };
    // Authenticate before accept. The final registry check and acceptance must remain synchronous:
    // concurrent requests can all have passed their asynchronous authority checks.
    if (!await this.authorized(session)) return new Response('Unauthorized', { status: 401 });
    if (this.state.getWebSockets().length >= MAX_NOTIFICATION_CONNECTIONS) return this.capacityDenied();
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    server.serializeAttachment(session);
    await this.scheduleAlarm();
    const sessions = [];
    for (const ws of this.boundedSockets() ?? []) {
      if (await this.active(ws)) sessions.push(this.presence(ws.deserializeAttachment() as SessionAttachment));
    }
    const synced = await this.send(server, { type: 'presence.sync', payload: sessions });
    const announced = await this.broadcast({ type: 'presence.update', payload: { ...this.presence(session), status: 'online' } }, server);
    if (!synced || !announced) server.close(1013, 'Realtime initialization failed');
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (!this.boundedSockets()) { ws.close(1013, 'Realtime capacity temporarily unavailable'); return; }
    if (typeof message !== 'string' || message.length > 4096) { ws.close(1009, 'Message too large'); return; }
    try {
      const data = JSON.parse(message);
      const staff = await this.activeStaff(ws);
      if (!staff) return;
      if (data.type === COLLABORATION_TYPING_EVENT) {
        const payload = createCollaborationTypingPayload(data.payload?.ticketId, data.payload?.baseConversationRevision, data.payload?.active);
        if (!payload || data.payload?.version !== COLLABORATION_TYPING_PROTOCOL_VERSION) return;
        const now = Date.now();
        if (!this.typingAllowed(ws, payload.ticketId, now)) return;
        const session = ws.deserializeAttachment() as SessionAttachment | null;
        if (!await this.authorizedForTicket(session, staff, payload.ticketId)) return;
        const actorId = staff.userId.slice(0, COLLABORATION_MAX_ACTOR_ID_LENGTH);
        const actorName = (staff.fullName?.trim() || 'Staff member').slice(0, COLLABORATION_MAX_ACTOR_NAME_LENGTH);
        const event = { type: COLLABORATION_TYPING_EVENT, payload: {
          version: COLLABORATION_TYPING_PROTOCOL_VERSION, ticketId: payload.ticketId,
          actor: { id: actorId, name: actorName }, active: payload.active, expiresAt: now + COLLABORATION_TYPING_TTL_MS,
        } };
        if (!await this.fanoutTyping(ws, payload.ticketId, event)) ws.close(1013, 'Realtime delivery failed');
        return;
      }
      if (data.type !== 'presence.update') return;
      const session = ws.deserializeAttachment() as SessionAttachment;
      session.location = typeof data.payload?.location === 'string' ? data.payload.location.slice(0, 100) : null;
      ws.serializeAttachment(session);
      if (!await this.broadcast({ type: 'presence.update', payload: { ...this.presence(session), status: 'online' } })) {
        ws.close(1013, 'Realtime delivery failed');
      }
    } catch { console.error('Invalid realtime message'); }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    this.typingUpdates.delete(ws);
    // Complete the close handshake on compatibility dates before automatic close replies.
    try { ws.close(1000, 'Connection closed'); } catch { /* Already closed. */ }
    const session = ws.deserializeAttachment() as SessionAttachment | null;
    if (this.belongsToThisObject(session) && !await this.fanout({ type: 'presence.update', payload: { ...this.presence(session), status: 'offline' } }, ws, false)) {
      console.error('Realtime cleanup delivery failed');
    }
    await this.scheduleAlarm();
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    try { ws.close(1011, 'Connection error'); } catch { /* Already closed. */ }
    await this.webSocketClose(ws, 1011, '', false);
  }

  /** A failed send is explicit; no accepted recipient is silently sliced out of a successful fanout. */
  async broadcast(message: unknown, excludeWs?: WebSocket): Promise<boolean> {
    return this.fanout(message, excludeWs, true);
  }

  private async fanout(message: unknown, excludeWs: WebSocket | undefined, closeInvalid: boolean): Promise<boolean> {
    const sockets = this.boundedSockets();
    if (!sockets) return false;
    const results = await Promise.all(sockets.filter(ws => ws !== excludeWs).map(ws =>
      closeInvalid ? this.send(ws, message) : this.deliver(ws, message, false)));
    return results.every(Boolean);
  }

  async send(ws: WebSocket, message: unknown): Promise<boolean> {
    return this.deliver(ws, message, true);
  }

  private async deliver(ws: WebSocket, message: unknown, closeInvalid: boolean): Promise<boolean> {
    // Cleanup must revalidate, but cannot initiate more closes and recursive offline fanouts.
    // A later ordinary event/alarm still closes invalid sessions. This mode is never client-controlled.
    if (!await this.active(ws, closeInvalid)) return true; // Closed or currently unauthorized recipients cannot receive data.
    if (ws.readyState !== WebSocket.OPEN) return true;
    try { ws.send(JSON.stringify(message)); return true; }
    catch { return false; } // Caller observes bounded failure; successful recipients may already have received it.
  }
}
