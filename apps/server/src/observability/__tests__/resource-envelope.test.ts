import { describe, expect, it } from 'vitest';
import { estimateDiagnosticEnvelope } from '../resource-envelope';
import { createLocalObservabilityCollector } from '../local-collector';
import { resourceOperationEvent } from '../resource-operation';
import { sumResourceEnvelopes } from '../../utils/cost-policy';

describe('diagnostic workload accounting contract', () => {
  it('includes HTTP, Durable Object revalidation, and detached compositions in existing resource dimensions', () => {
    const first = estimateDiagnosticEnvelope({ httpRequests: 1, durableObjectRevalidations: 1 });
    const retry = estimateDiagnosticEnvelope({ httpRequests: 1, detachedResourceCompositions: 1 });
    expect(first).toEqual({ logEvents: 131, traceEvents: 0 });
    expect(sumResourceEnvelopes(first, retry, { d1RowsWritten: 4 })).toEqual({ logEvents: 262, traceEvents: 0, d1RowsWritten: 4 });
    expect(estimateDiagnosticEnvelope({ httpRequests: 0 })).toEqual({ logEvents: 0, traceEvents: 0 });
  });
  it('uses the real websocket handshake denominator: one ingress composition plus three DO revalidations', () => {
    expect(estimateDiagnosticEnvelope({ httpRequests: 1, durableObjectRevalidations: 3 }))
      .toEqual({ logEvents: 259, traceEvents: 0 });
  });
  it('does not treat sampled local observations as permission to reclaim the workload envelope', () => {
    const bounds = { httpRequests: 0, detachedResourceCompositions: 1 };
    const before = estimateDiagnosticEnvelope(bounds);
    const collector = createLocalObservabilityCollector({ maxEvents: 1, sampleEvery: 2 });
    for (let i = 0; i < 4; i++) collector.record(resourceOperationEvent({ resource: 'd1', operation: 'invoke', outcome: 'success', latencyMs: 1 }));
    expect(collector.export().complete).toBe(false);
    expect(collector.export().counts.retained).toBe(1);
    expect(estimateDiagnosticEnvelope(bounds)).toEqual(before);
    expect(before.logEvents).toBe(64);
  });
  it('rejects malformed, multiplication-overflow and aggregate-overflow bounds', () => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => estimateDiagnosticEnvelope({ httpRequests: value })).toThrow();
      expect(() => estimateDiagnosticEnvelope({ httpRequests: 0, detachedResourceCompositions: value })).toThrow();
    }
    expect(() => estimateDiagnosticEnvelope({ httpRequests: 0, detachedResourceCompositions: Number.MAX_SAFE_INTEGER })).toThrow();
    expect(() => estimateDiagnosticEnvelope({ httpRequests: Number.MAX_SAFE_INTEGER, detachedResourceCompositions: 1 })).toThrow();
    expect(() => estimateDiagnosticEnvelope({ httpRequests: 1, httpResourceCompositions: 2 })).toThrow();
  });
});

it('allows lower auth bounds only inside the trusted HTTP workload ceiling', () => {
  expect(estimateDiagnosticEnvelope({ httpRequests: 2, httpResourceCompositions: 0, credentialAuthRequests: 0, canonicalMutationRequests: 0 })).toEqual({ logEvents: 2, traceEvents: 0 });
  for (const value of [-1, 3, 0.5, NaN, Infinity]) expect(() => estimateDiagnosticEnvelope({ httpRequests: 2, httpResourceCompositions: 0, credentialAuthRequests: value })).toThrow();
});

it('reserves simultaneous auth and canonical summaries and rejects understated invalid bounds', () => {
  expect(estimateDiagnosticEnvelope({ httpRequests: 2, httpResourceCompositions: 0 })).toEqual({ logEvents: 6, traceEvents: 0 });
  expect(estimateDiagnosticEnvelope({ httpRequests: 2, httpResourceCompositions: 0, canonicalMutationRequests: 1 })).toEqual({ logEvents: 5, traceEvents: 0 });
  for (const value of [-1, 3, .5, NaN, Infinity]) expect(() => estimateDiagnosticEnvelope({ httpRequests: 2, httpResourceCompositions: 0, canonicalMutationRequests: value })).toThrow();
});
