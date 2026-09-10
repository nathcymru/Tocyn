import { describe, expect, it } from 'vitest';
import { observabilityEnabled, operationalEvent, redactOperationalValue } from '../operational-events';

describe('operational event contract', () => {
  it('keeps the event envelope allowlisted and redacts prohibited diagnostic keys', () => {
    const event = operationalEvent({ correlationId: 'c-1', route: '/api/tickets/:id', method: 'POST', outcome: 'success', status: 201, latencyMs: 4 });
    expect(event).toEqual({ version: 1, type: 'http.request', correlationId: 'c-1', route: '/api/tickets/:id', method: 'POST', outcome: 'success', status: 201, latencyMs: 4 });
    expect(redactOperationalValue({ authorization: 'Bearer x', body: 'ticket text', nested: { apiKey: 'x', ok: 1 } })).toEqual({ authorization: '[REDACTED]', body: '[REDACTED]', nested: { apiKey: '[REDACTED]', ok: 1 } });
  });
  it('enables emitted evidence only for explicit isolated local beta mode', () => {
    expect(observabilityEnabled({ ENVIRONMENT: 'production', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence' })).toBe(false);
    expect(observabilityEnabled({ ENVIRONMENT: 'beta', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence' })).toBe(true);
    expect(observabilityEnabled({ ENVIRONMENT: 'beta', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'off' })).toBe(false);
  });
});
