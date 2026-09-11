import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationDO } from '../NotificationDO';
import { MAX_NOTIFICATION_CONNECTIONS } from '../notification-limits';
import {
  estimateDirectNotificationBroadcastEnvelope,
  estimateNotificationBroadcastWithCleanupEnvelope,
  estimateNotificationTypingEnvelope,
  estimateNotificationTypingWithCleanupEnvelope,
} from '../notification-resource-envelope';

const attachment = () => ({ connectionId: 'c', userId: 'u', name: 'Staff', location: null,
  tenantId: 'A', role: 'agent', version: 0, expiresAt: Math.floor(Date.now() / 1000) + 60 });
const socket = () => {
  let value = attachment();
  return { readyState: 1, send: vi.fn(), close: vi.fn(), deserializeAttachment: () => value,
    serializeAttachment: (next: typeof value) => { value = next; } };
};
function fixture(count = 0) {
  const sockets = Array.from({ length: count }, socket);
  const first = vi.fn(async () => ({ tenant_id: 'A', id: 'u', role: 'agent', session_version: 0 }));
  const accept = vi.fn((ws: ReturnType<typeof socket>) => sockets.push(ws));
  const state: any = { id: { equals: (id: string) => id === 'tenant:A' }, getWebSockets: () => [...sockets],
    acceptWebSocket: accept, storage: { setAlarm: vi.fn(), deleteAlarm: vi.fn() } };
  const env: any = { NOTIFICATION_DO: { idFromName: (id: string) => id }, DB: { prepare: () => ({ bind: () => ({ first }) }) } };
  vi.stubGlobal('WebSocketPair', class { 0 = {}; 1 = socket(); });
  vi.stubGlobal('Response', class { status: number; headers: Headers; constructor(_body: any, init: any = {}) {
    this.status = init.status ?? 200; this.headers = new Headers(init.headers);
  } });
  return { instance: new NotificationDO(state, env), state, env, sockets, first, accept };
}
const request = (tenant = 'A') => new Request('https://internal/connect', { headers: {
  Upgrade: 'websocket', 'X-User-ID': 'u', 'X-Tenant-ID': tenant, 'X-Session-Role': 'agent',
  'X-Session-Version': '0', 'X-Session-Expiry': String(Math.floor(Date.now() / 1000) + 60),
} });
afterEach(() => vi.unstubAllGlobals());

describe('bounded realtime capacity', () => {
  it('admits exactly the last slot under concurrent asynchronous authorization', async () => {
    const f = fixture(MAX_NOTIFICATION_CONNECTIONS - 1);
    const results = await Promise.all([f.instance.fetch(request()), f.instance.fetch(request()), f.instance.fetch(request())]);
    expect(results.map(r => r.status).sort()).toEqual([101, 503, 503]);
    expect(f.accept).toHaveBeenCalledOnce(); expect(f.sockets).toHaveLength(MAX_NOTIFICATION_CONNECTIONS);
    expect(results.find(r => r.status === 503)?.headers.get('Retry-After')).toBe('30');
  });
  it('reserves full diagnostics for three complete direct fanouts', () => {
    const envelope = estimateDirectNotificationBroadcastEnvelope();
    expect(envelope).toMatchObject({ doRequests: 3, d1RowsRead: 1_152, logEvents: 49_155 });
    expect(estimateNotificationBroadcastWithCleanupEnvelope()).toMatchObject({
      doRequests: 771, doRowsWritten: 768, d1RowsRead: 99_456, logEvents: 6_341_379,
    });
  });
  it('accounts separately for ticket-authorized advisory typing and its bounded cleanup', () => {
    expect(estimateNotificationTypingEnvelope()).toMatchObject({
      doRequests: 1, d1RowsRead: 384, logEvents: 16_385,
    });
    expect(estimateNotificationTypingWithCleanupEnvelope()).toMatchObject({
      doRequests: 257, doRowsWritten: 256, d1RowsRead: 33_152, logEvents: 2_113_793,
    });
  });
  it('never accepts foreign, revoked, malformed or unavailable authority', async () => {
    const f = fixture();
    expect((await f.instance.fetch(request('B'))).status).toBe(401);
    expect(f.first).not.toHaveBeenCalled();
    const malformed = request(); malformed.headers.set('X-Session-Expiry', 'invalid');
    expect((await f.instance.fetch(malformed)).status).toBe(401);
    f.first.mockResolvedValue({ tenant_id: 'A', id: 'u', role: 'agent', session_version: 1 });
    expect((await f.instance.fetch(request())).status).toBe(401);
    f.first.mockRejectedValue(new Error('unavailable'));
    expect((await f.instance.fetch(request())).status).toBe(401);
    expect(f.accept).not.toHaveBeenCalled();
  });
  it('keeps closing sockets charged until the runtime releases them, then recovers', async () => {
    const f = fixture(MAX_NOTIFICATION_CONNECTIONS);
    f.sockets[0].readyState = 2;
    expect((await f.instance.fetch(request())).status).toBe(503);
    expect(await f.instance.broadcast({ type: 'live' })).toBe(true);
    expect(f.sockets[0].send).not.toHaveBeenCalled();
    for (const ws of f.sockets.slice(1)) expect(ws.send).toHaveBeenCalledOnce();
    f.sockets.shift(); // Runtime unregisters the completed close handshake.
    expect((await f.instance.fetch(request())).status).toBe(101);
  });
  it('revalidates all 128 recipients and explicitly reports a send failure', async () => {
    const f = fixture(MAX_NOTIFICATION_CONNECTIONS);
    f.sockets[0].send.mockImplementation(() => { throw new Error('send failed'); });
    expect(await f.instance.broadcast({ type: 'all' })).toBe(false);
    expect(f.first).toHaveBeenCalledTimes(MAX_NOTIFICATION_CONNECTIONS);
    for (const ws of f.sockets) expect(ws.send).toHaveBeenCalledOnce();
  });
  it('fails closed after hibernation into legacy overcapacity without truncated fanout or alarm loops', async () => {
    const f = fixture(MAX_NOTIFICATION_CONNECTIONS + 1);
    expect(await f.instance.broadcast({ type: 'private' })).toBe(false);
    expect((await f.instance.fetch(new Request('https://internal/broadcast', { method: 'POST', body: '{}' }))).status).toBe(503);
    await f.instance.alarm();
    expect(f.first).not.toHaveBeenCalled();
    for (const ws of f.sockets) expect(ws.send).not.toHaveBeenCalled();
    expect(f.state.storage.deleteAlarm).toHaveBeenCalledOnce();
    await f.instance.webSocketMessage(f.sockets[0] as any, '{"type":"presence.update"}');
    expect(f.sockets[0].close).toHaveBeenCalledWith(1013, expect.any(String));
    f.sockets.pop();
    expect(await new NotificationDO(f.state, f.env).broadcast({ type: 'recovered' })).toBe(true);
  });
  it('reports cleanup send failure with one fixed diagnostic', async () => {
    const f = fixture(2);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    f.sockets[1].send.mockImplementation(() => { throw new Error('transport failure'); });
    await f.instance.webSocketClose(f.sockets[0] as any, 1000, '', true);
    expect(log).toHaveBeenCalledExactlyOnceWith('Realtime cleanup delivery failed');
    log.mockRestore();
  });
  it('cleanup serves current recipients without recursively closing invalid recipients', async () => {
    const f = fixture(3);
    const [closing, invalid, valid] = f.sockets;
    valid.serializeAttachment({ ...attachment(), version: 1 });
    f.first.mockResolvedValue({ tenant_id: 'A', id: 'u', role: 'agent', session_version: 1 });
    await f.instance.webSocketClose(closing as any, 1000, '', true);
    expect(invalid.send).not.toHaveBeenCalled(); expect(invalid.close).not.toHaveBeenCalled();
    expect(valid.send).toHaveBeenCalledWith(expect.stringContaining('offline'));
    await f.instance.webSocketError(closing as any, new Error('connection error'));
    expect(invalid.close).not.toHaveBeenCalled(); expect(valid.send).toHaveBeenCalledTimes(2);
    // Ordinary delivery still actively revokes the invalid connection.
    await f.instance.broadcast({ type: 'next.normal' });
    expect(invalid.send).not.toHaveBeenCalled(); expect(invalid.close).toHaveBeenCalledWith(1008, expect.any(String));
  });
  it('closes revoked sockets without sending and never announces a foreign legacy attachment', async () => {
    const f = fixture(1);
    f.first.mockResolvedValue({ tenant_id: 'A', id: 'u', role: 'agent', session_version: 1 });
    expect(await f.instance.broadcast({ type: 'private' })).toBe(true);
    expect(f.sockets[0].send).not.toHaveBeenCalled();
    expect(f.sockets[0].close).toHaveBeenCalledWith(1008, expect.any(String));
    const foreign = socket(); foreign.serializeAttachment({ ...attachment(), tenantId: 'B' });
    f.first.mockClear();
    await f.instance.webSocketClose(foreign as any, 1000, '', true);
    expect(f.first).not.toHaveBeenCalled();
  });
});
