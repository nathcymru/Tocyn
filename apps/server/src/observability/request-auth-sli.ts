/**
 * A single protected app-session gate may report one decision for its request.
 * This is deliberately neither a global counter nor a sampled diagnostic
 * collector: callers own its lifetime and must export it before the request
 * ends if they need isolated-evidence output.
 */
export const REQUEST_AUTH_SLI_VERSION = 1 as const;

export type AppSessionAuthDecision = 'accepted' | 'denied' | 'unavailable' | 'challenge';

export type RequestAuthSliSnapshot = Readonly<{
  version: typeof REQUEST_AUTH_SLI_VERSION;
  type: 'auth.sli.request';
  scope: 'app-session';
  complete: boolean;
  counts: Readonly<{
    attempted: number;
    accepted: number;
    denied: number;
    unavailable: number;
    challenge: number;
  }>;
}>;

export type RequestAuthSli = Readonly<{
  /** Records exactly one trusted decision. A duplicate makes this evidence incomplete. */
  record: (decision: AppSessionAuthDecision) => void;
  /** Marks a failed optional observer without changing the request decision. */
  markObserverFault: () => void;
  hasDecision: () => boolean;
  snapshot: () => RequestAuthSliSnapshot;
}>;

/**
 * Keeps a bounded unsampled denominator for exactly one request-scoped app
 * authentication decision. It intentionally exposes no tenant, actor,
 * credential, route, status, or error data.
 */
export function createRequestAuthSli(): RequestAuthSli {
  let decision: AppSessionAuthDecision | undefined;
  let complete = true;

  return Object.freeze({
    record(value: AppSessionAuthDecision): void {
      if (decision !== undefined) {
        complete = false;
        return;
      }
      if (!['accepted', 'denied', 'unavailable', 'challenge'].includes(value)) {
        complete = false;
        return;
      }
      decision = value;
    },
    markObserverFault(): void {
      complete = false;
    },
    hasDecision(): boolean {
      return decision !== undefined;
    },
    snapshot(): RequestAuthSliSnapshot {
      const counts = Object.freeze({
        attempted: decision === undefined ? 0 : 1,
        accepted: decision === 'accepted' ? 1 : 0,
        denied: decision === 'denied' ? 1 : 0,
        unavailable: decision === 'unavailable' ? 1 : 0,
        challenge: decision === 'challenge' ? 1 : 0,
      });
      return Object.freeze({
        version: REQUEST_AUTH_SLI_VERSION,
        type: 'auth.sli.request' as const,
        scope: 'app-session' as const,
        complete,
        counts,
      });
    },
  });
}
