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
});
