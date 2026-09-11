import { Env } from '../bindings';
import { UserAuthResolver } from '../auth/user-auth-resolver';
import { createResourceOperationEmitter } from '../observability/resource-operation';

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

/** Revalidate hibernated sessions before any event delivery and at least every 30s. */
export class NotificationDO {
  constructor(public state: DurableObjectState, private env: Env) {}

  private async active(ws: WebSocket): Promise<boolean> {
    try {
      const session = ws.deserializeAttachment() as SessionAttachment | null;
      if (session && Number.isSafeInteger(session.expiresAt) && session.expiresAt * 1000 > Date.now() &&
          Number.isSafeInteger(session.version) && session.version >= 0 &&
          ['agent', 'admin'].includes(session.role) && session.tenantId &&
          this.state.id.equals(this.env.NOTIFICATION_DO.idFromName(`tenant:${session.tenantId}`))) {
        // A Durable Object callback is a separate active composition from the
        // ingress request. Its revalidation read retains the same bounded,
        // privacy-safe D1 envelope and cannot affect delivery authorization.
        const user = await UserAuthResolver.fromEnvironment(this.env, createResourceOperationEmitter(this.env))
          .resolveUserById(session.tenantId, session.userId);
        if (user && user.role === session.role && user.sessionVersion === session.version) return true;
      }
    } catch { /* Database failures deny delivery, including after hibernation. */ }
    try { ws.close(1008, 'Session no longer authorized'); } catch { /* Already closed. */ }
    return false;
  }

  private presence(session: SessionAttachment) {
    return { connectionId: session.connectionId, userId: session.userId, name: session.name, location: session.location };
  }

  private async scheduleAlarm() {
    const expiries = this.state.getWebSockets().map(ws => (ws.deserializeAttachment() as SessionAttachment | null)?.expiresAt)
      .filter((expiry): expiry is number => typeof expiry === 'number' && expiry * 1000 > Date.now());
    if (expiries.length) await this.state.storage.setAlarm(Math.min(Date.now() + 30_000, ...expiries.map(expiry => expiry * 1000)));
    else await this.state.storage.deleteAlarm();
  }

  async alarm() {
    try { await Promise.all(this.state.getWebSockets().map(ws => this.active(ws))); }
    finally { await this.scheduleAlarm(); }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/broadcast') {
      await this.broadcast(await request.json());
      return new Response('OK');
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected Upgrade: websocket', { status: 426 });
    const session: SessionAttachment = {
      connectionId: crypto.randomUUID(), userId: request.headers.get('X-User-ID') || '',
      name: request.headers.get('X-User-Name') || '', location: null,
      tenantId: request.headers.get('X-Tenant-ID') || '', role: request.headers.get('X-Session-Role') || '',
      version: Number(request.headers.get('X-Session-Version') ?? NaN),
      expiresAt: Number(request.headers.get('X-Session-Expiry') ?? NaN),
    };
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    server.serializeAttachment(session);
    if (!await this.active(server)) return new Response('Unauthorized', { status: 401 });
    await this.scheduleAlarm();
    const sessions = [];
    for (const ws of this.state.getWebSockets()) {
      if (await this.active(ws)) sessions.push(this.presence(ws.deserializeAttachment() as SessionAttachment));
    }
    await this.send(server, { type: 'presence.sync', payload: sessions });
    await this.broadcast({ type: 'presence.update', payload: { ...this.presence(session), status: 'online' } }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (!await this.active(ws)) return;
    if (typeof message !== 'string' || message.length > 4096) { ws.close(1009, 'Message too large'); return; }
    try {
      const data = JSON.parse(message);
      if (data.type !== 'presence.update') return;
      const session = ws.deserializeAttachment() as SessionAttachment;
      session.location = typeof data.payload?.location === 'string' ? data.payload.location.slice(0, 100) : null;
      ws.serializeAttachment(session);
      await this.broadcast({ type: 'presence.update', payload: { ...this.presence(session), status: 'online' } });
    } catch { console.error('Invalid realtime message'); }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    const session = ws.deserializeAttachment() as SessionAttachment | null;
    if (session) await this.broadcast({ type: 'presence.update', payload: { ...this.presence(session), status: 'offline' } }, ws);
    await this.scheduleAlarm();
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    try { ws.close(1011, 'Connection error'); } catch { /* Already closed. */ }
    await this.webSocketClose(ws, 1011, '', false);
  }

  async broadcast(message: unknown, excludeWs?: WebSocket) {
    await Promise.all(this.state.getWebSockets().filter(ws => ws !== excludeWs).map(ws => this.send(ws, message)));
  }

  async send(ws: WebSocket, message: unknown) {
    if (!await this.active(ws)) return;
    try { ws.send(JSON.stringify(message)); } catch { /* Closed connection. */ }
  }
}
