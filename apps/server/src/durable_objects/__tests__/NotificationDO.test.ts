import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDO } from '../NotificationDO';

describe('realtime session lifecycle', () => {
  let state: any, env: any, user: any, sockets: any[], instance: NotificationDO;
  const socket = (overrides = {}) => {
    let attachment = { connectionId: 'c', userId: 'u', name: 'Agent', location: null,
      tenantId: 'A', role: 'agent', version: 0, expiresAt: Math.floor(Date.now() / 1000) + 60, ...overrides };
    return { readyState: 1, send: vi.fn(), close: vi.fn(), serializeAttachment: vi.fn(value => { attachment = value; }), deserializeAttachment: () => attachment };
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
  it('derives a bounded typing actor after current ticket and group authorization', async () => {
    const alice = socket({ connectionId: 'alice', userId: 'alice', name: 'Spoofed sender' });
    const bob = socket({ connectionId: 'bob', userId: 'bob' });
    const outsider = socket({ connectionId: 'outsider', userId: 'outsider' });
    sockets.push(alice, bob, outsider);
    const users: Record<string, any> = {
      alice: { tenant_id: 'A', id: 'alice', role: 'agent', session_version: 0, full_name: 'Alice Authoritative' },
      bob: { tenant_id: 'A', id: 'bob', role: 'agent', session_version: 0, full_name: 'Bob' },
      outsider: { tenant_id: 'A', id: 'outsider', role: 'agent', session_version: 0, full_name: 'Outsider' },
    };
    env.DB.prepare = (sql: string) => ({ bind: (...values: string[]) => ({ first: async () => {
      if (sql.includes('FROM users')) return users[values[1]] ?? null;
      if (sql.includes('FROM tickets')) return values[1] === 'ticket-1' ? { group_id: 'group-1' } : null;
      if (sql.includes('FROM user_groups')) return ['alice', 'bob'].includes(values[1]) ? { allowed: 1 } : null;
      return null;
    } }) });
    await instance.webSocketMessage(alice as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: {
      version: 1, ticketId: 'ticket-1', baseConversationRevision: 7, active: true,
      actor: { id: 'customer-supplied', name: 'Customer supplied' }, expiresAt: Date.now() + 600_000,
    } }));
    expect(alice.send).not.toHaveBeenCalled(); expect(outsider.send).not.toHaveBeenCalled();
    const event = JSON.parse(bob.send.mock.calls[0][0]);
    expect(event).toMatchObject({ type: 'collaboration.typing.v1', payload: {
      version: 1, ticketId: 'ticket-1', actor: { id: 'alice', name: 'Alice Authoritative' }, active: true,
    } });
    expect(event.payload.expiresAt).toBe(Date.now() + 6000);
    expect(event.payload).not.toHaveProperty('baseConversationRevision');
  });
  it('rejects invalid, unauthorized and throttled typing messages without disclosing a ticket', async () => {
    const sender = socket({ connectionId: 'sender', userId: 'sender' }), recipient = socket({ connectionId: 'recipient', userId: 'recipient' });
    sockets.push(sender, recipient);
    env.DB.prepare = (sql: string) => ({ bind: (...values: string[]) => ({ first: async () => {
      if (sql.includes('FROM users')) return { tenant_id: 'A', id: values[1], role: 'agent', session_version: 0, full_name: values[1] };
      if (sql.includes('FROM tickets')) return values[1] === 'allowed' ? { group_id: null } : null;
      return null;
    } }) });
    await instance.webSocketMessage(sender as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'missing', baseConversationRevision: 0, active: true } }));
    await instance.webSocketMessage(sender as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 2, ticketId: 'allowed', baseConversationRevision: 0, active: true } }));
    await instance.webSocketMessage(sender as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'allowed', baseConversationRevision: -1, active: true } }));
    expect(recipient.send).not.toHaveBeenCalled();
    await instance.webSocketMessage(sender as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'allowed', baseConversationRevision: 0, active: true } }));
    await instance.webSocketMessage(sender as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'allowed', baseConversationRevision: 0, active: false } }));
    expect(recipient.send).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    await instance.webSocketMessage(sender as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'allowed', baseConversationRevision: 0, active: false } }));
    expect(recipient.send).toHaveBeenCalledTimes(2);
  });
  it('does not evict live ticket throttles when a connection rotates 17 ticket ids', async () => {
    const sender = socket({ connectionId: 'sender', userId: 'sender' }), recipient = socket({ connectionId: 'recipient', userId: 'recipient' });
    sockets.push(sender, recipient);
    env.DB.prepare = (sql: string) => ({ bind: (...values: string[]) => ({ first: async () => {
      if (sql.includes('FROM users')) return { tenant_id: 'A', id: values[1], role: 'agent', session_version: 0, full_name: values[1] };
      if (sql.includes('FROM tickets')) return { group_id: null };
      return null;
    } }) });
    const message = (ticketId: string) => JSON.stringify({ type: 'collaboration.typing.v1', payload: {
      version: 1, ticketId, baseConversationRevision: 0, active: true,
    } });
    for (let index = 0; index < 16; index++) await instance.webSocketMessage(sender as any, message(`ticket-${index}`));
    await instance.webSocketMessage(sender as any, message('ticket-16'));
    await instance.webSocketMessage(sender as any, message('ticket-0'));
    expect(recipient.send).toHaveBeenCalledTimes(16);
    vi.advanceTimersByTime(6000);
    await instance.webSocketMessage(sender as any, message('ticket-16'));
    expect(recipient.send).toHaveBeenCalledTimes(17);
  });
  it('clears transient typing throttles on a reconnect and denies revoked recipients', async () => {
    const sender = socket({ connectionId: 'sender', userId: 'sender' }), revoked = socket({ connectionId: 'revoked', userId: 'revoked', version: 0 });
    sockets.push(sender, revoked);
    env.DB.prepare = (sql: string) => ({ bind: (...values: string[]) => ({ first: async () => {
      if (sql.includes('FROM users')) return { tenant_id: 'A', id: values[1], role: 'agent', session_version: values[1] === 'revoked' ? 1 : 0, full_name: values[1] };
      if (sql.includes('FROM tickets')) return { group_id: null };
      return null;
    } }) });
    await instance.webSocketMessage(sender as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'ticket', baseConversationRevision: 0, active: true } }));
    expect(revoked.send).not.toHaveBeenCalled(); expect(revoked.close).toHaveBeenCalledWith(1008, expect.any(String));
    await instance.webSocketClose(sender as any, 1000, '', true);
    const reconnected = socket({ connectionId: 'reconnected', userId: 'sender' }); sockets.splice(sockets.indexOf(sender), 1, reconnected);
    await instance.webSocketMessage(reconnected as any, JSON.stringify({ type: 'collaboration.typing.v1', payload: { version: 1, ticketId: 'ticket', baseConversationRevision: 0, active: true } }));
    // The revoked socket remains denied; the newly connected sender was not throttled by its old connection.
    expect(revoked.send).not.toHaveBeenCalled();
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
