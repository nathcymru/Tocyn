import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BalancedAssignmentService } from '../../services/balanced-assignment.service';
import { balancedAssignmentHandler } from '../balanced-assignment.handler';

// Ordering only: native HTTP tests cover actual authentication, SQL and replay.
function route(events: string[], failResponse = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('tenantDeps' as never, { scope: { tenantId: 'synthetic', actorId: 'actor' },
      repositories: { budgetAuthority: {} }, database: {}, operatorActivity: {} } as never);
    c.set('jwtPayload' as never, { sub: 'actor', tenant_id: 'synthetic', role: 'agent', session_version: 1,
      exp: Math.floor(Date.now() / 1000) + 3600, mfa_verified: true } as never);
    const json = c.json.bind(c);
    c.json = ((...args: Parameters<typeof json>) => {
      if (failResponse) { failResponse = false; events.push('response-failed'); throw new Error('Synthetic serialization failure'); }
      const response = json(...args); events.push('response-built'); return response;
    }) as typeof c.json;
    await next();
  });
  app.post('/tickets/:id/balanced-assignment', balancedAssignmentHandler as never);
  return () => app.request('/tickets/target/balanced-assignment', {
    method: 'POST', headers: { 'Idempotency-Key': 'synthetic' },
  }, { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: {} });
}

afterEach(() => vi.restoreAllMocks());
describe('balanced assignment response completion', () => {
  it('finishes with the exact outcome after constructing the Response and headers', async () => {
    const events: string[] = [];
    const outcome = Object.freeze({ outcome: 'assigned' as const, ownerId: 'operator', sequence: 1, replayed: false });
    vi.spyOn(BalancedAssignmentService.prototype, 'execute').mockResolvedValue(outcome);
    const finish = vi.spyOn(BalancedAssignmentService.prototype, 'finish').mockImplementation(() => { events.push('finish'); });
    const response = await route(events)();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Idempotency-Replayed')).toBe('false');
    expect(events).toEqual(['response-built', 'finish']);
    expect(finish).toHaveBeenCalledExactlyOnceWith(outcome);
  });
  it('finishes unknown when constructing the success Response fails', async () => {
    const events: string[] = [];
    vi.spyOn(BalancedAssignmentService.prototype, 'execute').mockResolvedValue({ outcome: 'no_capacity', ownerId: null, sequence: 0, replayed: false });
    const finish = vi.spyOn(BalancedAssignmentService.prototype, 'finish').mockImplementation(() => { events.push('finish'); });
    const response = await route(events, true)();
    expect(response.status).toBe(503);
    expect(events).toEqual(['response-failed', 'finish', 'response-built']);
    expect(finish).toHaveBeenCalledExactlyOnceWith();
  });
});
