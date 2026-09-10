import type { ResourceAmounts } from '@luminatick/shared';
import { sumResourceEnvelopes } from '../utils/cost-policy';
import { MAX_RESOURCE_EVENTS_PER_COMPOSITION } from './resource-operation';

/** Trusted workload bounds, including every retry and independently created composition. */
export interface DiagnosticWorkloadBounds {
  httpRequests: number;
  resourceCompositions: number;
  /** Defaults to every HTTP request; lower only for a proven route composition. */
  appSessionAuthRequests?: number;
  /** Defaults to every HTTP request; canonical and auth summaries can coexist. */
  canonicalMutationRequests?: number;
}

/**
 * Conservative planning input to #50/#64 for the current JSON-console emitters.
 * One HTTP completion envelope plus at most one app-session SLI summary per
 * request, plus at most one canonical-mutation summary and the per-composition
 * resource ceiling. These are potential log events, not provider usage or a
 * durable grant. Sampling and observer failure cannot reduce this reservation
 * estimate. Platform invocation logs, other application logs, export/retry and
 * storage costs require their own envelopes; no trace transport is active.
 */
export function estimateDiagnosticEnvelope(bounds: DiagnosticWorkloadBounds): ResourceAmounts {
  for (const value of [bounds.httpRequests, bounds.resourceCompositions]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid diagnostic workload bounds');
  }
  const authRequests = bounds.appSessionAuthRequests ?? bounds.httpRequests;
  if (!Number.isSafeInteger(authRequests) || authRequests < 0 || authRequests > bounds.httpRequests) throw new Error('Invalid app-session diagnostic bounds');
  const canonicalRequests = bounds.canonicalMutationRequests ?? bounds.httpRequests;
  if (!Number.isSafeInteger(canonicalRequests) || canonicalRequests < 0 || canonicalRequests > bounds.httpRequests) throw new Error('Invalid canonical diagnostic bounds');
  const resourceEvents = bounds.resourceCompositions * MAX_RESOURCE_EVENTS_PER_COMPOSITION;
  if (!Number.isSafeInteger(resourceEvents)) throw new Error('Diagnostic workload exceeds safe accounting range');
  return sumResourceEnvelopes({ logEvents: bounds.httpRequests, traceEvents: 0 }, { logEvents: resourceEvents }, { logEvents: authRequests }, { logEvents: canonicalRequests });
}
