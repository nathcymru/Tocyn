import { describe, expect, it } from 'vitest';
import { estimateDiagnosticEnvelope } from '../resource-envelope';
import { createLocalObservabilityCollector } from '../local-collector';
import { resourceOperationEvent } from '../resource-operation';
import { sumResourceEnvelopes } from '../../utils/cost-policy';

describe('diagnostic workload accounting contract', () => {
  it('includes each request, composition and retry in the existing resource dimensions', () => {
    const first = estimateDiagnosticEnvelope({ httpRequests: 1, resourceCompositions: 2 });
    const retry = estimateDiagnosticEnvelope({ httpRequests: 1, resourceCompositions: 1 });
    expect(first).toEqual({ logEvents: 129, traceEvents: 0 });
    expect(sumResourceEnvelopes(first, retry, { d1RowsWritten: 4 })).toEqual({ logEvents: 194, traceEvents: 0, d1RowsWritten: 4 });
    expect(estimateDiagnosticEnvelope({ httpRequests: 0, resourceCompositions: 0 })).toEqual({ logEvents: 0, traceEvents: 0 });
  });
  it('does not treat sampled local observations as permission to reclaim the workload envelope', () => {
    const bounds = { httpRequests: 0, resourceCompositions: 1 };
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
      expect(() => estimateDiagnosticEnvelope({ httpRequests: value, resourceCompositions: 0 })).toThrow();
      expect(() => estimateDiagnosticEnvelope({ httpRequests: 0, resourceCompositions: value })).toThrow();
    }
    expect(() => estimateDiagnosticEnvelope({ httpRequests: 0, resourceCompositions: Number.MAX_SAFE_INTEGER })).toThrow();
    expect(() => estimateDiagnosticEnvelope({ httpRequests: Number.MAX_SAFE_INTEGER, resourceCompositions: 1 })).toThrow();
  });
});
