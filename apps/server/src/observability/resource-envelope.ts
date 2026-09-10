import type { ResourceAmounts } from '@luminatick/shared';
import { sumResourceEnvelopes } from '../utils/cost-policy';
import { MAX_RESOURCE_EVENTS_PER_COMPOSITION } from './resource-operation';

/** Trusted workload bounds, including every retry and independently created composition. */
export interface DiagnosticWorkloadBounds {
  httpRequests: number;
  resourceCompositions: number;
}

/**
 * Conservative planning input to #50/#64 for the current JSON-console emitters.
 * One HTTP completion envelope per request and the existing per-composition
 * resource ceiling. These are potential log events, not provider usage or a
 * durable grant. Sampling and observer failure cannot reduce this reservation
 * estimate. Platform invocation logs, other application logs, export/retry and
 * storage costs require their own envelopes; no trace transport is active.
 */
export function estimateDiagnosticEnvelope(bounds: DiagnosticWorkloadBounds): ResourceAmounts {
  for (const value of [bounds.httpRequests, bounds.resourceCompositions]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid diagnostic workload bounds');
  }
  const resourceEvents = bounds.resourceCompositions * MAX_RESOURCE_EVENTS_PER_COMPOSITION;
  if (!Number.isSafeInteger(resourceEvents)) throw new Error('Diagnostic workload exceeds safe accounting range');
  return sumResourceEnvelopes({ logEvents: bounds.httpRequests, traceEvents: 0 }, { logEvents: resourceEvents });
}
