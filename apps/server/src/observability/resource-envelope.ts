import type { ResourceAmounts } from '@luminatick/shared';
import { sumResourceEnvelopes } from '../utils/cost-policy';
import { MAX_RESOURCE_EVENTS_PER_COMPOSITION } from './resource-operation';

/** Trusted workload bounds, including every retry and independently created composition. */
export interface DiagnosticWorkloadBounds {
  httpRequests: number;
  /** One request-scoped emitter is created for each observed HTTP request. */
  httpResourceCompositions?: number;
  /** Each live-session check inside NotificationDO owns a separate capped emitter. */
  durableObjectRevalidations?: number;
  /** Current detached workflow/background compositions; do not use for future Queue/outbox work. */
  detachedResourceCompositions?: number;
  /** Defaults to every HTTP request; lower only for a proven route composition. */
  credentialAuthRequests?: number;
  /** Defaults to every HTTP request; canonical and auth summaries can coexist. */
  canonicalMutationRequests?: number;
}

/**
 * Conservative planning input to #50/#64 for the current JSON-console emitters.
 * One HTTP completion envelope plus at most one credential SLI summary per
 * request, at most one canonical-mutation summary, and the per-composition
 * resource ceiling. HTTP compositions default to all requests; Durable Object
 * revalidations and detached current background compositions are explicit.
 * These are potential log events, not provider usage or a durable grant.
 * Sampling and observer failure cannot reduce this reservation estimate.
 * Platform invocation logs, other application logs, export/retry and storage
 * costs require their own envelopes; no trace transport is active.
 */
export function estimateDiagnosticEnvelope(bounds: DiagnosticWorkloadBounds): ResourceAmounts {
  if (!Number.isSafeInteger(bounds.httpRequests) || bounds.httpRequests < 0) {
    throw new Error('Invalid diagnostic workload bounds');
  }
  const httpResourceCompositions = bounds.httpResourceCompositions ?? bounds.httpRequests;
  const durableObjectRevalidations = bounds.durableObjectRevalidations ?? 0;
  const detachedResourceCompositions = bounds.detachedResourceCompositions ?? 0;
  for (const value of [httpResourceCompositions, durableObjectRevalidations, detachedResourceCompositions]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid diagnostic workload bounds');
  }
  if (httpResourceCompositions > bounds.httpRequests) throw new Error('HTTP resource compositions exceed requests');
  const authRequests = bounds.credentialAuthRequests ?? bounds.httpRequests;
  if (!Number.isSafeInteger(authRequests) || authRequests < 0 || authRequests > bounds.httpRequests) throw new Error('Invalid credential diagnostic bounds');
  const canonicalRequests = bounds.canonicalMutationRequests ?? bounds.httpRequests;
  if (!Number.isSafeInteger(canonicalRequests) || canonicalRequests < 0 || canonicalRequests > bounds.httpRequests) throw new Error('Invalid canonical diagnostic bounds');
  const resourceCompositions = httpResourceCompositions + durableObjectRevalidations + detachedResourceCompositions;
  if (!Number.isSafeInteger(resourceCompositions)) throw new Error('Diagnostic workload exceeds safe accounting range');
  const resourceEvents = resourceCompositions * MAX_RESOURCE_EVENTS_PER_COMPOSITION;
  if (!Number.isSafeInteger(resourceEvents)) throw new Error('Diagnostic workload exceeds safe accounting range');
  return sumResourceEnvelopes({ logEvents: bounds.httpRequests, traceEvents: 0 }, { logEvents: resourceEvents }, { logEvents: authRequests }, { logEvents: canonicalRequests });
}
