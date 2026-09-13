import { describe, expect, it, vi } from 'vitest';
import { SessionBudgetAdmissionService } from '../session-admission.service';

function fixture() {
  const captured: any[] = [];
  const authorize = vi.fn().mockResolvedValue({ kind: 'session', sessionVersion: 1 });
  const service = new SessionBudgetAdmissionService({ admit: async (input: any) => { captured.push(input); await input.authorization.authorize(input.scope); return { status: 'spent' }; } } as any);
  const input: any = { repository: {}, sessions: { authorize }, namespace: {}, scope: { tenantId: 'tenant-a', actorId: 'actor-a' },
    credential: { tenantId: 'tenant-a', actorId: 'actor-a', role: 'agent', sessionVersion: 1, expiresAt: 9999999999, mfaVerified: true },
    requirements: { readTicketId: 'ticket-a' }, intent: { operationId: 'a', operationFingerprint: 'target-a', workScopeKey: 'dashboard.ticket.detail' }, business: { workerRequests: 1 }, now: () => 1 };
  return { service, input, captured, authorize };
}

describe('explicit session read accounting partition', () => {
  it.each(['dashboard.ticket.detail', 'dashboard.ticket.history', 'workspace.draft.read'])('shares only target partition for %s while authorizing the original target', async operation => {
    const f = fixture(); f.input.readScopePartition = 'ticket-read-v1'; f.input.intent.workScopeKey = operation;
    await f.service.admit(f.input);
    f.input.requirements = { readTicketId: 'ticket-b' }; f.input.intent.operationFingerprint = 'target-b';
    await f.service.admit(f.input);
    expect(f.captured[0].credentialKey).toBe(f.captured[1].credentialKey);
    expect(f.authorize.mock.calls.map(call => call[1])).toEqual([{ readTicketId: 'ticket-a' }, { readTicketId: 'ticket-b' }]);
    expect(f.captured.map(call => call.intent.operationFingerprint)).toEqual(['target-a', 'target-b']);
  });
  it.each(['tenantId', 'actorId', 'role', 'sessionVersion', 'expiresAt', 'mfaVerified'])('retains %s in the partition', async field => {
    const f = fixture(); f.input.readScopePartition = 'ticket-read-v1'; await f.service.admit(f.input);
    f.input.credential = { ...f.input.credential, [field]: typeof f.input.credential[field] === 'number' ? f.input.credential[field] + 1 : typeof f.input.credential[field] === 'boolean' ? false : `${f.input.credential[field]}-changed` };
    await f.service.admit(f.input); expect(f.captured[0].credentialKey).not.toBe(f.captured[1].credentialKey);
  });
  it('keeps default target partitions, including writes, unchanged', async () => {
    const f = fixture(); f.input.intent.workScopeKey = 'dashboard.ticket.update'; await f.service.admit(f.input);
    f.input.requirements = { readTicketId: 'ticket-b' }; await f.service.admit(f.input);
    expect(f.captured[0].credentialKey).not.toBe(f.captured[1].credentialKey);
  });
  it.each([
    { readScopePartition: 'unsupported' },
    { intent: { operationId: 'a', operationFingerprint: 'a', workScopeKey: 'dashboard.ticket.update' } },
    { requirements: {} }, { requirements: { readTicketId: '' } },
    { requirements: { readTicketId: 'a'.repeat(257) } }, { requirements: { readTicketId: 'a\u0000b' } },
    { requirements: { readTicketId: 'a', authentication: 'challenge' } },
    { requirements: { readTicketId: 'a', ticket: { id: 'a', groupId: null } } },
    { requirements: { readTicketId: 'a', capability: {} } },
  ])('rejects unsupported opt-in %j before cache or authorization', async override => {
    const f = fixture(); const result = await f.service.admit({ ...f.input, readScopePartition: 'ticket-read-v1', ...override });
    expect(result).toEqual({ status: 'rejected', reason: 'invalid-request' }); expect(f.captured).toHaveLength(0); expect(f.authorize).not.toHaveBeenCalled();
  });
});

describe('explicit email delivery accounting partition', () => {
  it('shares delivery blocks across targets while retaining original target/group authorization', async () => {
    const f = fixture(); f.input.emailDeliveryPartition = 'ticket-email-v1'; f.input.intent.workScopeKey = 'ticket-email.delivery';
    f.input.requirements = { ticket: { id: 'ticket-a', groupId: null } }; await f.service.admit(f.input);
    f.input.requirements = { ticket: { id: 'ticket-b', groupId: 'group-b' } }; await f.service.admit(f.input);
    expect(f.captured[0].credentialKey).toBe(f.captured[1].credentialKey);
    expect(f.authorize.mock.calls.map(call => call[1])).toEqual([{ ticket: { id: 'ticket-a', groupId: null } }, { ticket: { id: 'ticket-b', groupId: 'group-b' } }]);
  });
  it.each(['tenantId', 'actorId', 'role', 'sessionVersion', 'expiresAt', 'mfaVerified'])('retains email credential %s', async field => {
    const f = fixture(); f.input.emailDeliveryPartition = 'ticket-email-v1'; f.input.intent.workScopeKey = 'ticket-email.delivery'; f.input.requirements = { ticket: { id: 'a', groupId: null } }; await f.service.admit(f.input);
    f.input.credential = { ...f.input.credential, [field]: typeof f.input.credential[field] === 'number' ? f.input.credential[field] + 1 : typeof f.input.credential[field] === 'boolean' ? false : `${f.input.credential[field]}-changed` };
    await f.service.admit(f.input); expect(f.captured[0].credentialKey).not.toBe(f.captured[1].credentialKey);
  });
  it.each([
    { emailDeliveryPartition: 'unknown' }, { readScopePartition: 'ticket-read-v1' },
    { intent: { operationId: 'a', operationFingerprint: 'a', workScopeKey: 'dashboard.ticket.create' } },
    { requirements: { readTicketId: 'a' } }, { requirements: { ticket: { id: 'a' } } },
    { requirements: { ticket: { id: 'a', groupId: '' } } }, { requirements: { ticket: { id: 'a'.repeat(257), groupId: null } } },
    { requirements: { ticket: { id: 'a', groupId: 'g\u0000' } } },
    { requirements: { ticket: { id: 'a', groupId: null }, capability: {} } },
  ])('rejects unsupported email accounting opt-in %j', async override => {
    const f = fixture(); const result = await f.service.admit({ ...f.input, emailDeliveryPartition: 'ticket-email-v1', requirements: { ticket: { id: 'a', groupId: null } }, intent: { ...f.input.intent, workScopeKey: 'ticket-email.delivery' }, ...override });
    expect(result).toEqual({ status: 'rejected', reason: 'invalid-request' }); expect(f.captured).toHaveLength(0);
  });
});

describe('explicit single-operation target write grants', () => {
  const operations = ['dashboard.ticket.reply', 'dashboard.ticket.update', 'dashboard.ticket.sla.initialize', 'dashboard.ticket.support-state.transition'];
  function target() {
    const f = fixture(); f.input.singleOperationGrant = 'target-write-v1';
    f.input.intent.workScopeKey = `${operations[0]}:${'a'.repeat(64)}`;
    f.input.requirements = { ticket: { id: 'a', groupId: null } }; return f;
  }
  it.each(operations)('caps %s without reducing original target authorization or credential partition', async operation => {
    const f = target(); f.input.intent.workScopeKey = `${operation}:${'a'.repeat(64)}`;
    await f.service.admit(f.input); f.input.requirements.ticket = { id: 'b', groupId: 'g' }; await f.service.admit(f.input);
    expect(f.captured.map(row => row.maxBlockOperations)).toEqual([1, 1]);
    expect(f.captured[0].credentialKey).not.toBe(f.captured[1].credentialKey);
    expect(f.authorize.mock.calls.map(row => row[1])).toEqual([{ ticket: { id: 'a', groupId: null } }, { ticket: { id: 'b', groupId: 'g' } }]);
  });
  it('retains capability and default credential digest; absent opt-in keeps default allocation', async () => {
    const f = target(); f.input.requirements.capability = { action: 'ticket.update', scope: 'all' };
    await f.service.admit(f.input); delete f.input.singleOperationGrant; await f.service.admit(f.input);
    expect(f.captured[0].credentialKey).toBe(f.captured[1].credentialKey);
    expect(f.captured[1].maxBlockOperations).toBeUndefined();
    expect(f.authorize.mock.calls[0][1]).toEqual(f.input.requirements);
  });
  it.each([
    { singleOperationGrant: 'unknown' }, { readScopePartition: 'ticket-read-v1' }, { emailDeliveryPartition: 'ticket-email-v1' },
    ...['dashboard.ticket.create', 'dashboard.sla.policy.set', 'dashboard.support-state.update', 'dashboard.ticket.detail'].map(operation => ({ intent: { workScopeKey: `${operation}:${'a'.repeat(64)}` } })),
    { intent: { workScopeKey: 'dashboard.ticket.reply:short' } },
    { requirements: {} }, { requirements: { ticket: { id: 'a' } } },
    { requirements: { ticket: { id: 'a', groupId: null, extra: true } } },
    { requirements: { ticket: { id: 'a'.repeat(257), groupId: null } } },
    { requirements: { ticket: { id: 'a', groupId: '\u0000' } } },
    { requirements: { ticket: { id: 'a', groupId: null }, readTicketId: 'a' } },
  ])('rejects unsupported single-operation mode %j', async override => {
    const f = target(); expect(await f.service.admit({ ...f.input, ...override })).toEqual({ status: 'rejected', reason: 'invalid-request' });
    expect(f.captured).toHaveLength(0); expect(f.authorize).not.toHaveBeenCalled();
  });
});
