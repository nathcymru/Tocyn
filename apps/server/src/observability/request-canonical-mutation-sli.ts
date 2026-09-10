/** A request-owned, unsampled canonical-mutation accounting boundary. */
export const REQUEST_CANONICAL_MUTATION_SLI_VERSION = 1 as const;

export type RequestCanonicalMutationSliSnapshot = Readonly<{
  version: typeof REQUEST_CANONICAL_MUTATION_SLI_VERSION;
  type: 'canonical_mutation.sli.request';
  scope: 'request';
  complete: boolean;
  counts: Readonly<{
    attempted: number;
    durablyCompleted: number;
    replayed: number;
    denied: number;
    uncertain: number;
  }>;
}>;

export type RequestCanonicalMutationSli = Readonly<{
  recordAttempt: () => void;
  recordDurablyCompleted: () => void;
  recordReplayed: () => void;
  recordDenied: () => void;
  recordUncertain: () => void;
  markObserverFault: () => void;
  hasAttempt: () => boolean;
  hasDecision: () => boolean;
  snapshot: () => RequestCanonicalMutationSliSnapshot;
}>;

type Terminal = 'durablyCompleted' | 'replayed' | 'uncertain';

/**
 * Accepts at most one canonical mutation outcome per request. This is not a
 * tenant counter, diagnostic sampler, audit record, or durable receipt store.
 */
export function createRequestCanonicalMutationSli(): RequestCanonicalMutationSli {
  let attempted = false;
  let denied = false;
  let terminal: Terminal | undefined;
  let complete = true;

  const terminalRecord = (value: Terminal) => {
    if (!attempted || terminal !== undefined || denied) { complete = false; return; }
    terminal = value;
  };

  return Object.freeze({
    recordAttempt(): void {
      if (attempted || denied) { complete = false; return; }
      attempted = true;
    },
    recordDurablyCompleted(): void { terminalRecord('durablyCompleted'); },
    recordReplayed(): void { terminalRecord('replayed'); },
    recordDenied(): void {
      if (attempted || denied || terminal !== undefined) { complete = false; return; }
      denied = true;
    },
    recordUncertain(): void { terminalRecord('uncertain'); },
    markObserverFault(): void { complete = false; },
    hasAttempt(): boolean { return attempted; },
    hasDecision(): boolean { return attempted || denied; },
    snapshot(): RequestCanonicalMutationSliSnapshot {
      // A started mutation without a terminal acknowledgement is uncertainty,
      // even if an outer handler later maps it to a response status.
      const unresolved = attempted && terminal === undefined;
      const counts = Object.freeze({
        attempted: attempted ? 1 : 0,
        durablyCompleted: terminal === 'durablyCompleted' ? 1 : 0,
        replayed: terminal === 'replayed' ? 1 : 0,
        denied: denied ? 1 : 0,
        uncertain: terminal === 'uncertain' || unresolved ? 1 : 0,
      });
      return Object.freeze({
        version: REQUEST_CANONICAL_MUTATION_SLI_VERSION,
        type: 'canonical_mutation.sli.request' as const,
        scope: 'request' as const,
        complete: complete && !unresolved,
        counts,
      });
    },
  });
}
