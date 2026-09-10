import { describe, expect, it } from 'vitest';
import { createLocalObservabilityCollector } from '../local-collector';
import { operationalEvent } from '../operational-events';
import { resourceOperationEvent } from '../resource-operation';

const http = () => operationalEvent({ correlationId: '11111111-1111-4111-8111-111111111111', route: '/health', method: 'GET', outcome: 'success', status: 200, latencyMs: 1 });

describe('local observability collector', () => {
  it('exports only current-version reconstructed allowlisted events and counts invalid input', () => {
    const collector = createLocalObservabilityCollector();
    collector.record({ ...http(), authorization: 'synthetic-secret', tenantId: 'tenant-a' });
    collector.record({ type: 'unknown', providerPayload: 'synthetic-secret' });
    collector.record({ ...http(), version: 2 });
    collector.record({ type: 'resource.operation', resource: 'd1', operation: 'invoke', outcome: 'success', latencyMs: 1 });
    const exported = collector.export();
    expect(exported.events).toEqual([http()]);
    expect(JSON.stringify(exported)).not.toContain('synthetic-secret');
    expect(exported.counts).toMatchObject({ attempted: 4, retained: 1, invalid: 3 });
    expect(exported.complete).toBe(false);
  });

  it('uses deterministic sampling and first-fit event/byte retention with explicit omissions', () => {
    const collector = createLocalObservabilityCollector({ maxEvents: 1, maxBytes: 1_000, sampleEvery: 2 });
    collector.record(http());
    collector.record(resourceOperationEvent({ resource: 'd1', operation: 'invoke', outcome: 'success', latencyMs: 2 }));
    collector.record(http());
    const exported = collector.export();
    expect(exported.events).toHaveLength(1);
    expect(exported.events[0].type).toBe('http.request');
    expect(exported.counts).toMatchObject({ attempted: 3, retained: 1, sampledOut: 1, eventLimitDrops: 1, byteLimitDrops: 0 });
    expect(exported.retention).toEqual({ scope: 'caller-owned-memory', maxEvents: 1, maxBytes: 1_000, sampleEvery: 2 });
  });

  it('does not retain an event that would exceed the byte budget and never evicts a prior event', () => {
    const collector = createLocalObservabilityCollector({ maxEvents: 2, maxBytes: 256 });
    collector.record(resourceOperationEvent({ resource: 'durable_object', operation: 'invoke', outcome: 'success', latencyMs: 1 }));
    collector.record(http());
    const exported = collector.export();
    expect(exported.events).toHaveLength(1);
    expect(exported.events[0].type).toBe('resource.operation');
    expect(exported.counts.byteLimitDrops).toBe(1);
    expect(exported.counts.retainedBytes).toBeLessThanOrEqual(256);
  });

  it('returns immutable point-in-time snapshots that later collection cannot change', () => {
    const collector = createLocalObservabilityCollector();
    collector.record(http());
    const first = collector.export();
    collector.record(resourceOperationEvent({ resource: 'd1', operation: 'invoke', outcome: 'success', latencyMs: 1 }));
    const second = collector.export();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.events)).toBe(true);
    expect(Object.isFrozen(first.counts)).toBe(true);
    expect(() => (first.events as unknown as unknown[]).push(http())).toThrow(TypeError);
    expect(first.events).toEqual([http()]);
    expect(second.events).toHaveLength(2);
  });

  it('rejects unbounded collector options before collecting data', () => {
    expect(() => createLocalObservabilityCollector({ maxEvents: 0 })).toThrow('Invalid local observability collector options');
    expect(() => createLocalObservabilityCollector({ maxBytes: 65_537 })).toThrow('Invalid local observability collector options');
    expect(() => createLocalObservabilityCollector({ sampleEvery: 0 })).toThrow('Invalid local observability collector options');
  });
});
