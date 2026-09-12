import { describe, expect, it } from 'vitest';
import { localBetaRoute } from '../local-beta';

describe('localBetaRoute', () => {
  it('allows the authenticated reply capability read in the guarded local profile', () => {
    expect(localBetaRoute('GET', '/api/tickets/ticket-1/reply-capability')).toBe('conversation-read');
    expect(localBetaRoute('GET', '/api/tickets/ticket-1/utility-actions')).toBe('conversation-read');
  });

  it('keeps unimplemented API and customer variants disabled', () => {
    expect(localBetaRoute('GET', '/api/v1/tickets/ticket-1/reply-capability')).toBe('disabled');
    expect(localBetaRoute('GET', '/api/v1/customer/tickets/ticket-1/reply-capability')).toBe('disabled');
  });

  it('admits only the three staff SLA routes needed by the local beta', () => {
    expect(localBetaRoute('GET', '/api/sla-policy')).toBe('conversation-read');
    expect(localBetaRoute('PUT', '/api/sla-policy')).toBe('configuration');
    expect(localBetaRoute('POST', '/api/tickets/ticket-1/sla/initialize')).toBe('conversation-write');

    for (const [method, path] of [
      ['POST', '/api/sla-policy'], ['PATCH', '/api/sla-policy'], ['GET', '/api/sla-policy/extra'],
      ['POST', '/api/tickets/ticket-1/sla/initialize/extra'], ['POST', '/api/tickets/sla/initialize'],
      ['POST', '/api/v1/tickets/ticket-1/sla/initialize'], ['POST', '/api/v1/customer/tickets/ticket-1/sla/initialize'],
      ['POST', '/api/tickets/sla/initialize/bulk'],
    ] as const) expect(localBetaRoute(method, path)).toBe('disabled');
  });
});
