import { createVerifiedTenantScope } from '../../auth/scope';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BroadcastService } from '../broadcast.service';
import { Env } from '../../bindings';
import { CANONICAL_BROADCAST_ENVELOPE, type CanonicalBroadcastGrant } from '../../budgets/realtime-admission.service';

describe('BroadcastService', () => {
  let service: BroadcastService;
  let mockEnv: Env;
  let mockDO: any;

  beforeEach(() => {
    mockDO = {
      fetch: vi.fn().mockResolvedValue(new Response('OK')),
    };
    mockEnv = {
      NOTIFICATION_DO: {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
        get: vi.fn().mockReturnValue(mockDO),
      },
    } as any;
    service = new BroadcastService(mockEnv, createVerifiedTenantScope('tenant-A','agent',['agent'],1));
  });

  afterEach(() => vi.restoreAllMocks());

  it('should broadcast message to Durable Object', async () => {
    await service.broadcast('test.event', { foo: 'bar' });

    expect(mockEnv.NOTIFICATION_DO.idFromName).toHaveBeenCalledWith('tenant:tenant-A');
    expect(mockEnv.NOTIFICATION_DO.get).toHaveBeenCalled();
    expect(mockDO.fetch).toHaveBeenCalledWith('http://do/broadcast', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ type: 'test.event', payload: { foo: 'bar' } }),
    }));
  });

  it('should retry on failure', async () => {
    // Fail twice, then succeed
    mockDO.fetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(new Response('Error', { status: 500 }))
      .mockResolvedValueOnce(new Response('OK'));

    await expect(service.broadcast('test.event', { foo: 'bar' }, 3)).resolves.toEqual({ status: 'accepted', attempts: 3 });

    expect(mockDO.fetch).toHaveBeenCalledTimes(3);
  });

  it('requires a signed post-commit grant when realtime admission is enabled', async () => {
    mockEnv.REALTIME_BUDGET_ADMISSION_POLICY = 'realtime-v1';
    mockEnv.JWT_SECRET = 'synthetic-realtime-secret-at-least-32-characters';
    await expect(service.broadcast('ticket.updated', { id: 'ticket' })).resolves.toEqual({ status: 'failed', attempts: 0 });
    expect(mockDO.fetch).not.toHaveBeenCalled();
    const grant: CanonicalBroadcastGrant = { version: 1, handoffId: 'canonical-unit-handoff', tenantId: 'tenant-A', operationId: 'operation-unit', operationFingerprint: 'a'.repeat(64),
      reservationId: 'reservation-unit', holderId: 'holder-unit', aggregateId: 'aggregate-unit', expiresAt: Date.now() + 30_000,
      authorityRevision: 1, policyId: 'policy-unit', policyRevision: 1, restrictionRevision: 1,
      notificationEnvelope: CANONICAL_BROADCAST_ENVELOPE, operationEnvelope: CANONICAL_BROADCAST_ENVELOPE };
    await expect(service.broadcast('ticket.updated', { id: 'ticket' }, 2, grant)).resolves.toEqual({ status: 'accepted', attempts: 1 });
    const [, init] = mockDO.fetch.mock.calls[0];
    expect(init.headers['X-Realtime-Canonical-Handoff-Signature']).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(init.headers['X-Realtime-Canonical-Handoff']).grant.reservationId).toBe('reservation-unit');
  });

  it('measures each fetch attempt without exposing payloads and preserves failures', async () => {
    const emit = vi.fn();
    mockDO.fetch.mockRejectedValue(new Error('private failure'));
    await new BroadcastService(mockEnv, createVerifiedTenantScope('tenant-A','agent',['agent'],1), emit).broadcast('private.event', { tenantId: 'secret', body: 'secret' }, 1);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.every(([event]) => event.resource === 'durable_object' && event.operation === 'invoke')).toBe(true);
    expect(JSON.stringify(emit.mock.calls)).not.toContain('secret');
  });

  it('returns a nonthrowing failure after bounded server-error retries', async () => {
    const emit = vi.fn(); mockDO.fetch.mockResolvedValue(new Response('private failure', {status: 503}));
    const result = await new BroadcastService(mockEnv, createVerifiedTenantScope('tenant-A','agent',['agent'],1), emit).broadcast('ticket.updated', {private:'payload'}, 2);
    expect(result).toEqual({ status: 'failed', attempts: 3 });
    expect(mockDO.fetch).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({resource:'durable_object',operation:'invoke',outcome:'failure'}));
    expect(JSON.stringify(emit.mock.calls)).not.toContain('private');
  });

  it.each([301, 400, 401, 403, 404, 409, 429])('rejects non-2xx %s terminally without treating it as accepted', async status => {
    const emit = vi.fn(); const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDO.fetch.mockResolvedValue(new Response('private response details', { status }));
    const result = await new BroadcastService(mockEnv, createVerifiedTenantScope('tenant-A', 'agent', ['agent'], 1), emit)
      .broadcast('private.event', { private: 'payload' }, 99);
    expect(result).toEqual({ status: 'failed', attempts: 1 });
    expect(mockDO.fetch).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    expect(error).toHaveBeenCalledExactlyOnceWith('Broadcast failed');
    expect(JSON.stringify([emit.mock.calls, error.mock.calls, result])).not.toMatch(/private|payload|details/);
  });

  it.each([[-1, 1], [NaN, 1], [Infinity, 1], [1.5, 1], [0, 1], [1, 2], [2, 3], [3, 3], [999999, 3]])(
    'caps attempts for retries=%s at %s', async (retries, attempts) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockDO.fetch.mockRejectedValue(new Error('private network error'));
      await expect(service.broadcast('test', {}, retries)).resolves.toEqual({ status: 'failed', attempts });
      expect(mockDO.fetch).toHaveBeenCalledTimes(attempts);
      expect(error).toHaveBeenCalledTimes(attempts);
      expect(error.mock.calls.every(args => args.length === 1 && args[0] === 'Broadcast failed')).toBe(true);
    });

  it.each([null, '999', true, {}])('does not expand retries for an invalid JavaScript argument: %s', async retries => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDO.fetch.mockRejectedValue(new Error('unavailable'));
    await expect(service.broadcast('test', {}, retries as any)).resolves.toEqual({ status: 'failed', attempts: 1 });
    expect(mockDO.fetch).toHaveBeenCalledOnce();
  });

  it('retries one immutable event envelope and never follows redirects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = { value: 'original' };
    mockDO.fetch.mockImplementationOnce(async () => { payload.value = 'changed'; throw new Error('lost response'); });
    await expect(service.broadcast('test', payload)).resolves.toEqual({ status: 'accepted', attempts: 2 });
    for (const [, init] of mockDO.fetch.mock.calls) {
      expect(init.body).toBe('{"type":"test","payload":{"value":"original"}}');
      expect(init.redirect).toBe('manual');
    }
  });

  it('propagates failure through every notification wrapper without throwing a postcommit failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDO.fetch.mockResolvedValue(new Response('denied', { status: 403 }));
    const ticket = { id: 'ticket', subject: 'Committed ticket', status: 'open', priority: 'normal' };
    for (const notification of [service.notifyTicketCreated(ticket), service.notifyTicketUpdated(ticket),
      service.notifyPresenceUpdate('agent', 'Staff', null, 'offline')]) {
      await expect(notification).resolves.toEqual({ status: 'failed', attempts: 1 });
    }
    expect(mockDO.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not confuse an absent binding with accepted delivery', async () => {
    await expect(new BroadcastService({} as Env).broadcast('test', {})).resolves.toEqual({ status: 'disabled', attempts: 0 });
  });

  it('keeps diagnostic and serialization failures nonthrowing after commit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('broken diagnostic sink'); });
    const payload: any = {}; payload.circular = payload;
    await expect(service.broadcast('test', payload)).resolves.toEqual({ status: 'failed', attempts: 0 });
    expect(mockDO.fetch).not.toHaveBeenCalled();
    mockDO.fetch.mockResolvedValue(new Response('denied', { status: 403 }));
    await expect(service.broadcast('test', {})).resolves.toEqual({ status: 'failed', attempts: 1 });
  });

  it('does not retry a successful broadcast when the diagnostic sink throws', async () => {
    mockDO.fetch.mockResolvedValue(new Response('ok'));
    await new BroadcastService(mockEnv, createVerifiedTenantScope('tenant-A','agent',['agent'],1), () => { throw new Error('sink unavailable'); }).broadcast('ticket.updated', {}, 2);
    expect(mockDO.fetch).toHaveBeenCalledTimes(1);
  });

  it('should notify when ticket is created', async () => {
    const ticket = { id: '123', subject: 'Test Ticket', status: 'open', priority: 'normal' };
    await service.notifyTicketCreated(ticket);

    expect(mockDO.fetch).toHaveBeenCalledWith('http://do/broadcast', expect.objectContaining({
      body: JSON.stringify({
        type: 'ticket.created',
        payload: { id: '123', subject: 'Test Ticket', status: 'open', priority: 'normal' }
      }),
    }));
  });

  it('should notify when ticket is updated', async () => {
    const ticket = { id: '123', subject: 'Test Ticket', status: 'pending', priority: 'high' };
    await service.notifyTicketUpdated(ticket);

    expect(mockDO.fetch).toHaveBeenCalledWith('http://do/broadcast', expect.objectContaining({
      body: JSON.stringify({
        type: 'ticket.updated',
        payload: { id: '123', subject: 'Test Ticket', status: 'pending', priority: 'high' }
      }),
    }));
  });
});
