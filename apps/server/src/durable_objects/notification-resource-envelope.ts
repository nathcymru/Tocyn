import type { ResourceAmounts } from '@luminatick/shared';
import { sumResourceEnvelopes } from '../utils/cost-policy';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { MAX_NOTIFICATION_BROADCAST_ATTEMPTS, MAX_NOTIFICATION_CONNECTIONS } from './notification-limits';

/**
 * Direct bounded fanout only, including all three existing sender attempts and
 * full #159 diagnostic ceilings. The tenant/id primary-key authority lookup
 * returns at most one row per recipient; runtime evidence verifies that bound.
 *
 * This is NOT a complete dashboard operation grant: the caller's request and
 * other compositions, independent alarm/message callbacks, message bytes, CPU/
 * duration and
 * platform invocation logs require separate envelopes. Use
 * estimateNotificationBroadcastWithCleanupEnvelope below when reserving the
 * broadcast and its causal close/error cleanup together.
 */
export function estimateDirectNotificationBroadcastEnvelope(): ResourceAmounts {
  return sumResourceEnvelopes({
    doRequests: MAX_NOTIFICATION_BROADCAST_ATTEMPTS,
    d1RowsRead: MAX_NOTIFICATION_BROADCAST_ATTEMPTS * MAX_NOTIFICATION_CONNECTIONS,
    // One fixed caller failure diagnostic per attempt; caller resource events
    // belong to its already-reserved request composition.
    logEvents: MAX_NOTIFICATION_BROADCAST_ATTEMPTS,
  }, estimateDiagnosticEnvelope({
    httpRequests: 0,
    durableObjectRevalidations: MAX_NOTIFICATION_BROADCAST_ATTEMPTS * MAX_NOTIFICATION_CONNECTIONS,
  }));
}

/**
 * Each direct attempt can terminate at most its 128-socket snapshot. Reserve
 * both an error callback and a close callback for each termination. Each can
 * fan out to at most 128 current registered sockets, including interleaved new
 * arrivals, but cleanup NEVER closes recipients, so the causal chain ends there.
 * Each cleanup also makes at most one alarm storage update and one fixed
 * failure diagnostic. Callback invocation
 * and storage operation units here are conservative reservation estimates, not
 * a claim about provider billing conversion or measured production use.
 */
export function estimateNotificationBroadcastWithCleanupEnvelope(): ResourceAmounts {
  const callbacks = MAX_NOTIFICATION_BROADCAST_ATTEMPTS * MAX_NOTIFICATION_CONNECTIONS * 2;
  return sumResourceEnvelopes(estimateDirectNotificationBroadcastEnvelope(), {
    doRequests: callbacks,
    doRowsWritten: callbacks,
    logEvents: callbacks,
    d1RowsRead: callbacks * MAX_NOTIFICATION_CONNECTIONS,
  }, estimateDiagnosticEnvelope({
    httpRequests: 0,
    durableObjectRevalidations: callbacks * MAX_NOTIFICATION_CONNECTIONS,
  }));
}
