import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDO } from '../NotificationDO';

describe('realtime session lifecycle', () => {
  let state: any, env: any, user: any, sockets: any[], instance: NotificationDO;
  const socket = (overrides = {}) => {
    let attachment = { connectionId: 'c', userId: 'u', name: 'Agent', location: null,
      tenantId: 'A', role: 'agent', version: 0, expiresAt: Math.floor(Date.now() / 1000) + 60, ...overrides };
    return { send: vi.fn(), close: vi.fn(), serializeAttachment: vi.fn(value => { attachment = value; }), deserializeAttachment: () => attachment };
  };
  beforeEach(() => {
    vi.useFakeTimers();
    user = { tenant_id: 'A', id: 'u', role: 'agent', session_version: 0 };
    sockets = [];
    state = { id: { equals: (id: string) => id === 'tenant:A' }, getWebSockets: () => sockets,
      acceptWebSocket: (ws: any) => sockets.push(ws), storage: { setAlarm: vi.fn(), deleteAlarm: vi.fn() } };
    env = { NOTIFICATION_DO: { idFromName: (name: string) => name },
      DB: { prepare: () => ({ bind: () => ({ first: async () => user }) }) } };
    instance = new NotificationDO(state, env);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('delivers only to current staff in this tenant and rejects legacy attachments', async () => {
    const valid = socket(), foreign = socket({ tenantId: 'B' }), legacy = socket({ expiresAt: undefined });
    sockets.push(valid, foreign, legacy);
    await instance.broadcast({ type: 'ticket.updated' });
    expect(valid.send).toHaveBeenCalledOnce();
    for (const ws of [foreign, legacy]) { expect(ws.send).not.toHaveBeenCalled(); expect(ws.close).toHaveBeenCalled(); }
  });
  it('records a fixed D1 outcome for a revalidation without exposing its session data', async () => {
    const log=vi.spyOn(console,'log').mockImplementation(()=>{});
    env.ENVIRONMENT='test'; env.OBSERVABILITY_MODE='isolated-evidence';
    const ws=socket({userId:'private-user',tenantId:'private-tenant'}); sockets.push(ws);
    state.id.equals=(id:string)=>id==='tenant:private-tenant';
    env.NOTIFICATION_DO.idFromName=(name:string)=>name;
    await instance.broadcast({type:'private-event',payload:{private:'content'}});
    const emitted=log.mock.calls.map(([value])=>JSON.parse(value));
    expect(emitted).toEqual(expect.arrayContaining([expect.objectContaining({type:'resource.operation',resource:'d1',operation:'invoke',outcome:'success'})]));
    expect(JSON.stringify(emitted)).not.toContain('private-user');
    expect(JSON.stringify(emitted)).not.toContain('content');
  });
  it.each(['logout', 'demotion', 'deletion', 'expiry', 'database'])('denies outbound and inbound activity after %s, including a fresh DO instance', async reason => {
    const ws = socket(); sockets.push(ws);
    await instance.broadcast({ type: 'before' }); expect(ws.send).toHaveBeenCalledOnce(); ws.send.mockClear();
    if (reason === 'logout') user.session_version++;
    if (reason === 'demotion') user.role = 'customer';
    if (reason === 'deletion') user = null;
    if (reason === 'expiry') vi.advanceTimersByTime(60_000);
    if (reason === 'database') env.DB.prepare = () => { throw new Error('offline'); };
    instance = new NotificationDO(state, env);
    await instance.broadcast({ type: 'secret' });
    await instance.webSocketMessage(ws as any, '{"type":"presence.update","payload":{"location":"secret"}}');
    expect(ws.send).not.toHaveBeenCalled(); expect(ws.serializeAttachment).not.toHaveBeenCalled(); expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
  });
  it('expires idle connections with durable alarms', async () => {
    const ws = socket({ expiresAt: Math.floor(Date.now() / 1000) + 5 }); sockets.push(ws);
    await instance.alarm(); expect(state.storage.setAlarm).toHaveBeenCalledWith((Math.floor(Date.now() / 1000) + 5) * 1000);
    vi.advanceTimersByTime(5000); await new NotificationDO(state, env).alarm();
    expect(ws.close).toHaveBeenCalled(); expect(state.storage.deleteAlarm).toHaveBeenCalled();
  });
  it('bounds presence updates and does not disclose authorization attachments', async () => {
    const ws = socket(), other = socket({ connectionId: 'other' }); sockets.push(ws, other);
    await instance.webSocketMessage(ws as any, JSON.stringify({ type: 'presence.update', payload: { location: 'x'.repeat(300) } }));
    const event = JSON.parse(other.send.mock.calls[0][0]);
    expect(event.payload.location).toHaveLength(100);
    for (const privateField of ['version', 'expiresAt', 'role', 'tenantId']) expect(event.payload).not.toHaveProperty(privateField);
  });
  it('initializes a valid connection and schedules expiry before returning the upgrade', async () => {
    const server = socket();
    vi.stubGlobal('WebSocketPair', class { 0 = {}; 1 = server; });
    vi.stubGlobal('Response', class { status: number; constructor(_body: any, init: any) { this.status = init.status; } });
    const response = await instance.fetch(new Request('https://internal/api/realtime', { headers: {
      Upgrade: 'websocket', 'X-User-ID': 'u', 'X-User-Name': 'Agent', 'X-Tenant-ID': 'A',
      'X-Session-Role': 'agent', 'X-Session-Version': '0', 'X-Session-Expiry': String(Math.floor(Date.now() / 1000) + 60),
    } }));
    expect(response.status).toBe(101); expect(state.storage.setAlarm).toHaveBeenCalled();
    expect(server.send).toHaveBeenCalledWith(expect.stringContaining('presence.sync'));
  });
  it('counts each fresh-session revalidation as its own bounded DO composition', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.mockClear();
    env.ENVIRONMENT = 'test'; env.OBSERVABILITY_MODE = 'isolated-evidence';
    const server = socket();
    vi.stubGlobal('WebSocketPair', class { 0 = {}; 1 = server; });
    vi.stubGlobal('Response', class { status: number; constructor(_body: any, init: any) { this.status = init.status; } });
    await instance.fetch(new Request('https://internal/api/realtime', { headers: {
      Upgrade: 'websocket', 'X-User-ID': 'u', 'X-User-Name': 'Agent', 'X-Tenant-ID': 'A',
      'X-Session-Role': 'agent', 'X-Session-Version': '0', 'X-Session-Expiry': String(Math.floor(Date.now() / 1000) + 60),
    } }));
    const d1Revalidations = log.mock.calls.map(([value]) => JSON.parse(value))
      .filter(event => event.type === 'resource.operation' && event.resource === 'd1' && event.operation === 'invoke');
    expect(d1Revalidations).toHaveLength(3);
  });
});
