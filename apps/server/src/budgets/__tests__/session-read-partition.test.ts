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
