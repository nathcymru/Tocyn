import { describe, expect, it } from 'vitest';
import { observabilityEnabled, operationalEvent } from '../operational-events';

describe('operational event contract', () => {
  it('keeps the event envelope allowlisted and redacts prohibited diagnostic keys', () => {
    const event = operationalEvent({ correlationId: '11111111-1111-4111-8111-111111111111', route: '/api/v1', method: 'POST', outcome: 'success', status: 201, latencyMs: 4 });
    expect(event).toEqual({ version: 1, type: 'http.request', correlationId: '11111111-1111-4111-8111-111111111111', route: '/api/v1', method: 'POST', outcome: 'success', status: 201, latencyMs: 4 });
  });
  it('enables emitted evidence only for explicit isolated local beta mode', () => {
    expect(observabilityEnabled({ ENVIRONMENT: 'production', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence' })).toBe(false);
    expect(observabilityEnabled({ ENVIRONMENT: 'beta', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence' })).toBe(true);
    expect(observabilityEnabled({ ENVIRONMENT: 'beta', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'off' })).toBe(false);
  });
  it('drops prohibited fields and normalizes unexpected method/route values without echoing them', () => {
    const sensitive = 'synthetic-private-value';
    const event = operationalEvent({
      correlationId:'11111111-1111-4111-8111-111111111111', route:`/api/tickets/${sensitive}`, method:sensitive,
      outcome:'success', status:403, latencyMs:5,
      ...Object.fromEntries(['authorization','cookie','otp','magicLink','apiKey','channelCredentials','providerPayload','ticketBody','articleBody','attachmentContent','aiPrompt','aiOutput','innocentLookingKey'].map(key=>[key,sensitive])),
    });
    expect(event).toMatchObject({route:'/other',method:'OTHER',outcome:'client_error'});
    expect(JSON.stringify(event)).not.toContain(sensitive);
    expect(Object.keys(event)).toEqual(['version','type','correlationId','route','method','outcome','status','latencyMs']);
  });
  it.each([
    {correlationId:'attacker-supplied-secret'}, {status:NaN}, {status:99}, {status:600}, {status:200.5},
    {latencyMs:NaN}, {latencyMs:Infinity}, {latencyMs:-1},
  ])('rejects invalid envelope values without including them in an error: %j', invalid => {
    expect(()=>operationalEvent({correlationId:'11111111-1111-4111-8111-111111111111',route:'/health',method:'GET',outcome:'success',status:200,latencyMs:1,...invalid})).toThrow('Invalid operational event envelope');
  });

});
