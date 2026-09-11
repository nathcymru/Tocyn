import { Env } from '../bindings';
import { UserAuthResolver } from '../auth/user-auth-resolver';
import { createResourceOperationEmitter } from '../observability/resource-operation';
import { MAX_NOTIFICATION_CONNECTIONS } from './notification-limits';

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
  constructor(public state: DurableObjectState, private env: Env) {}

  private belongsToThisObject(session: SessionAttachment | null): session is SessionAttachment {
    return !!session && !!session.tenantId &&
      this.state.id.equals(this.env.NOTIFICATION_DO.idFromName(`tenant:${session.tenantId}`));
  }

  private async authorized(session: SessionAttachment | null): Promise<boolean> {
    try {
      if (this.belongsToThisObject(session) && Number.isSafeInteger(session.expiresAt) && session.expiresAt * 1000 > Date.now() &&
          Number.isSafeInteger(session.version) && session.version >= 0 && ['agent', 'admin'].includes(session.role)) {
        // Each revalidation is an independently capped #159 diagnostic composition.
        const user = await UserAuthResolver.fromEnvironment(this.env, createResourceOperationEmitter(this.env))
          .resolveUserById(session.tenantId, session.userId);
        return !!user && user.role === session.role && user.sessionVersion === session.version &&
          session.expiresAt * 1000 > Date.now();
      }
    } catch { /* Database failures deny delivery, including after hibernation. */ }
    return false;
  }

  private async active(ws: WebSocket, closeInvalid = true): Promise<boolean> {
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (await this.authorized(ws.deserializeAttachment() as SessionAttachment | null)) return true;
    if (closeInvalid) {
      try { ws.close(1008, 'Session no longer authorized'); } catch { /* Already closed. */ }
    }
    return false;
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
    if (!await this.active(ws)) return;
    if (typeof message !== 'string' || message.length > 4096) { ws.close(1009, 'Message too large'); return; }
    try {
      const data = JSON.parse(message);
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
