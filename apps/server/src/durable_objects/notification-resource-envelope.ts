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

/**
 * One accepted advisory typing frame reaches at most the sender plus 127 other
 * registered sockets. Every participant has one live-session read and one
 * current-ticket read; grouped agents can require one membership read. The
 * transient 16-ticket throttle can only reject work, so it does not increase
 * this ceiling. Ticket authorization creates a second independent #159
 * emitter alongside the live-session revalidation.
 *
 * This is a conservative local planning envelope, not a billable CPU,
 * duration, byte-transfer or complete event-metering assertion.
 */
export function estimateNotificationTypingEnvelope(): ResourceAmounts {
  const participants = MAX_NOTIFICATION_CONNECTIONS;
  const authorizationCompositions = participants * 2;
  return sumResourceEnvelopes({
    doRequests: 1,
    d1RowsRead: participants * 3,
    // A typing delivery failure is reported by the callback; resource events
    // belong to the independent emitters below.
    logEvents: 1,
  }, estimateDiagnosticEnvelope({ httpRequests: 0, durableObjectRevalidations: authorizationCompositions }));
}

/**
 * A typing frame can close at most the full 128-socket registry: revoked
 * recipients fail closed during fanout and a failed delivery can close the
 * sender. Error and close callbacks each revalidate a complete current
 * registry, but cleanup never performs ticket/group checks or recursive closes.
 * These are reservation units only; platform billing and CPU/duration remain
 * unknown.
 */
export function estimateNotificationTypingWithCleanupEnvelope(): ResourceAmounts {
  const callbacks = MAX_NOTIFICATION_CONNECTIONS * 2;
  return sumResourceEnvelopes(estimateNotificationTypingEnvelope(), {
    doRequests: callbacks,
    doRowsWritten: callbacks,
    logEvents: callbacks,
    d1RowsRead: callbacks * MAX_NOTIFICATION_CONNECTIONS,
  }, estimateDiagnosticEnvelope({
    httpRequests: 0,
    durableObjectRevalidations: callbacks * MAX_NOTIFICATION_CONNECTIONS,
  }));
}
