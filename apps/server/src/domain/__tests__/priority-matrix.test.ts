import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  absoluteWindowHours,
  calculatePriorityScore,
  comparePriorityTickets,
  CONTRACT_TIER_WINDOW_HOURS,
  CRITICALITY_TIER_WINDOW_HOURS,
  effectiveUrgencyWindowHours,
  PRIORITY_CATEGORY_BASE,
  PRIORITY_SCOPE_MULTIPLIER,
  priorityTimeRemainingFromPauses,
  timeRemainingHours,
  urgencyModifierTotal,
  type PrioritySortTicket,
  type PriorityView,
} from '../../../../../packages/shared/priority-matrix';

test('category and scope tables cover the approved values', () => {
  assert.deepEqual(Object.values(PRIORITY_CATEGORY_BASE), [10, 10, 7, 7, 4, 4, 4, 1, 1, 1, 1]);
  assert.deepEqual(PRIORITY_SCOPE_MULTIPLIER, { systemic: 3, localised: 2, isolated: 1 });
});

test('each explicit urgency condition contributes five points and concurrent crises stack', () => {
  const none = { regulatoryOfficerOnSite: false, vipBlocked: false, hardDeadline: false };
  assert.equal(urgencyModifierTotal(none), 0);
  assert.equal(urgencyModifierTotal({ ...none, vipBlocked: true }), 5);
  assert.equal(urgencyModifierTotal({ ...none, regulatoryOfficerOnSite: true, vipBlocked: true }), 10);
  assert.equal(urgencyModifierTotal({ regulatoryOfficerOnSite: true, vipBlocked: true, hardDeadline: true }), 15);
  assert.throws(() => urgencyModifierTotal({ ...none, hardDeadline: 1 } as never), RangeError);
  assert.equal(calculatePriorityScore('technical-problems', 'localised', 0), 14);
  assert.equal(calculatePriorityScore('technical-problems', 'localised', 10), 24);
  assert.equal(calculatePriorityScore('incidents-interruptions', 'systemic', 15), 45);
  for (const invalid of [-5, 2.5, 20, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calculatePriorityScore('technical-problems', 'localised', invalid), RangeError);
  }
});

test('invalid category and scope values cannot silently create a nonnumeric score', () => {
  assert.throws(() => calculatePriorityScore('toString' as never, 'isolated', 0), RangeError);
  assert.throws(() => calculatePriorityScore('other', 'constructor' as never, 0), RangeError);
});

test('strictest tier sets the absolute window and overdue remains signed', () => {
  assert.deepEqual(Object.values(CONTRACT_TIER_WINDOW_HOURS), [1, 4, 24, 48]);
  assert.deepEqual([4, 3, 2, 1].map(level => CRITICALITY_TIER_WINDOW_HOURS[level as 4 | 3 | 2 | 1]), [1, 4, 24, 48]);
  assert.equal(absoluteWindowHours('delta', 2), 24);
  assert.equal(absoluteWindowHours('bravo', 1), 4);
  assert.equal(timeRemainingHours('delta', 1, 50), 24);
  assert.equal(timeRemainingHours('delta', 1, 100), 0);
  assert.equal(timeRemainingHours('delta', 1, 125), -12);
  assert.throws(() => timeRemainingHours('alpha', 4, Number.NaN), RangeError);
  assert.throws(() => timeRemainingHours('alpha', 4, -1), RangeError);
});

test('invalid tier values fail before any window or remaining-time calculation', () => {
  assert.throws(() => absoluteWindowHours('toString' as never, 4), RangeError);
  assert.throws(() => absoluteWindowHours('alpha', 0 as never), RangeError);
  assert.throws(() => timeRemainingHours('unknown' as never, 4, 50), RangeError);
  assert.throws(() => timeRemainingHours('alpha', 2.5 as never, 50), RangeError);
});

test('fixed-hour clock pauses for waiting and resolution, then resumes with the original time debt', () => {
  const hour = 3_600_000;
  // A 48-hour D1 ticket works 20h, waits 10h, works 4h, then is resolved.
  const waiting = { startsAtMs: 20 * hour, endsAtMs: 30 * hour };
  const resolved = { startsAtMs: 34 * hour, endsAtMs: null };
  assert.equal(priorityTimeRemainingFromPauses('delta', 1, 0, 40 * hour, [waiting, resolved]), 24);
  // Reopening at 40h closes the pause; the ticket still owes its first 24h.
  assert.equal(priorityTimeRemainingFromPauses('delta', 1, 0, 44 * hour,
    [waiting, { startsAtMs: 34 * hour, endsAtMs: 40 * hour }]), 20);
  assert.equal(priorityTimeRemainingFromPauses('delta', 1, 0, 65 * hour,
    [waiting, { startsAtMs: 34 * hour, endsAtMs: 40 * hour }]), -1);
});

test('fixed-hour clock rejects malformed, overlapping and unbounded pause history', () => {
  const hour = 3_600_000;
  const remaining = (pauses: Parameters<typeof priorityTimeRemainingFromPauses>[4]) =>
    priorityTimeRemainingFromPauses('delta', 1, 0, 10 * hour, pauses);
  assert.throws(() => remaining([{ startsAtMs: hour, endsAtMs: 3 * hour },
    { startsAtMs: 2 * hour, endsAtMs: 4 * hour }]), RangeError);
  assert.throws(() => remaining([{ startsAtMs: hour, endsAtMs: null },
    { startsAtMs: 5 * hour, endsAtMs: null }]), RangeError);
  assert.throws(() => remaining([{ startsAtMs: 11 * hour, endsAtMs: null }]), RangeError);
  assert.throws(() => remaining(Array.from({ length: 4_097 }, (_, index) =>
    ({ startsAtMs: index * 100, endsAtMs: index * 100 + 50 }))), RangeError);
});

test('urgency drift includes the 24h and 4h equality examples without mutating contract tiers', () => {
  assert.equal(effectiveUrgencyWindowHours(48, 25), 48);
  assert.equal(effectiveUrgencyWindowHours(48, 24), 24);
  assert.equal(effectiveUrgencyWindowHours(48, 4), 4);
  assert.equal(effectiveUrgencyWindowHours(48, 1), 1);
  assert.equal(effectiveUrgencyWindowHours(48, -2), 1);
  assert.equal(effectiveUrgencyWindowHours(24, 4), 4);
  assert.equal(effectiveUrgencyWindowHours(4, 4), 4);
  assert.equal(effectiveUrgencyWindowHours(1, 0.25), 1);
  assert.throws(() => effectiveUrgencyWindowHours(12 as never, 4), RangeError);
  assert.throws(() => effectiveUrgencyWindowHours(48, Number.NaN), RangeError);
});

const snapshot = (
  ticketId: string, contractTier: PrioritySortTicket['contractTier'],
  criticalityTier: PrioritySortTicket['criticalityTier'], remaining: number, priorityScore = 10,
): PrioritySortTicket => ({ ticketId, contractTier, criticalityTier, timeRemainingHours: remaining, priorityScore });

function sortedIds(view: PriorityView, tickets: PrioritySortTicket[]): string[] {
  return [...tickets].sort((a, b) => comparePriorityTickets(view, a, b)).map(ticket => ticket.ticketId);
}

test('Default Focus orders time, then stacked score, criticality, contract, and ID', () => {
  const tickets = [
    snapshot('z', 'delta', 4, 2), snapshot('a', 'delta', 4, 2),
    snapshot('bravo', 'bravo', 4, 2), snapshot('lower', 'alpha', 3, 2, 25),
    snapshot('overdue', 'delta', 1, -1), snapshot('later', 'alpha', 4, 3),
  ];
  assert.deepEqual(sortedIds('default-focus', tickets), ['overdue', 'lower', 'bravo', 'a', 'z', 'later']);
});

test('Criticality Matrix promotes drift into effective tier, then orders time within it', () => {
  const tickets = [
    snapshot('not-yet', 'delta', 1, 25), snapshot('at-24', 'delta', 1, 24),
    snapshot('bravo', 'bravo', 3, 3), snapshot('fresh-l4', 'delta', 4, 0.75),
    snapshot('drifted-l1', 'delta', 1, 0.5),
  ];
  assert.deepEqual(sortedIds('criticality-matrix', tickets),
    ['drifted-l1', 'fresh-l4', 'bravo', 'at-24', 'not-yet']);
});

test('the named views keep their own primary tiers when a different axis sets the absolute window', () => {
  const alphaLevel1 = snapshot('alpha-level-1', 'alpha', 1, 0.25);
  const deltaLevel4 = snapshot('delta-level-4', 'delta', 4, 0.75);
  assert.deepEqual(sortedIds('criticality-matrix', [alphaLevel1, deltaLevel4]),
    ['delta-level-4', 'alpha-level-1']);
  assert.deepEqual(sortedIds('sla-commitment', [deltaLevel4, alphaLevel1]),
    ['alpha-level-1', 'delta-level-4']);
});

test('drift lets a long-window ticket join the stricter primary tier in each named view', () => {
  const drifted = snapshot('drifted', 'delta', 1, 0.25);
  const highCriticality = snapshot('high-criticality', 'delta', 4, 0.75);
  const strictContract = snapshot('strict-contract', 'alpha', 1, 0.75);
  assert.deepEqual(sortedIds('criticality-matrix', [highCriticality, drifted]),
    ['drifted', 'high-criticality']);
  assert.deepEqual(sortedIds('sla-commitment', [strictContract, drifted]),
    ['drifted', 'strict-contract']);
});

test('SLA Commitment promotes effective contract and criticality tiers, then time', () => {
  const tickets = [
    snapshot('delta-25', 'delta', 1, 25), snapshot('delta-24', 'delta', 1, 24),
    snapshot('bravo', 'bravo', 3, 3), snapshot('delta-4', 'delta', 1, 4),
    snapshot('alpha', 'alpha', 4, 0.5), snapshot('delta-1', 'delta', 1, 0.25),
  ];
  assert.deepEqual(sortedIds('sla-commitment', tickets),
    ['delta-1', 'alpha', 'bravo', 'delta-4', 'delta-24', 'delta-25']);
  assert.throws(() => comparePriorityTickets('sla-commitment', snapshot('a', 'alpha', 4, Number.NaN), snapshot('b', 'alpha', 4, 1)), RangeError);
});

test('SLA Commitment promotes criticality at each inclusive 24h, 4h and 1h drift threshold', () => {
  const cases = [
    { threshold: 24, contractTier: 'charlie', competingRemaining: 23.5 },
    { threshold: 4, contractTier: 'bravo', competingRemaining: 3.5 },
    { threshold: 1, contractTier: 'alpha', competingRemaining: 0.5 },
  ] as const;
  for (const { threshold, contractTier, competingRemaining } of cases) {
    // Both tickets share the effective contract tier. The older Delta/Level 1
    // ticket also inherits the stricter criticality tier for ordering.
    const drifted = snapshot('drifted', 'delta', 1, threshold);
    const routine = snapshot('routine', contractTier, 1, competingRemaining);
    assert.deepEqual(sortedIds('sla-commitment', [routine, drifted]),
      ['drifted', 'routine'], `${threshold}h drift must promote the criticality sort key`);
  }
});

test('invalid view and every malformed sort snapshot fail even when an earlier key differs', () => {
  const valid = snapshot('valid', 'alpha', 4, 1);
  assert.throws(() => comparePriorityTickets('unknown' as never, valid, valid), RangeError);
  assert.throws(() => comparePriorityTickets('criticality-matrix', snapshot('bad', 'delta', 1, Number.NaN), valid), RangeError);
  assert.throws(() => comparePriorityTickets('sla-commitment', snapshot('bad', 'unknown' as never, 1, 1), valid), RangeError);
  assert.throws(() => comparePriorityTickets('default-focus', snapshot('bad', 'alpha', 5 as never, 1), valid), RangeError);
  assert.throws(() => comparePriorityTickets('default-focus', snapshot('', 'alpha', 4, 1), valid), RangeError);
  assert.throws(() => comparePriorityTickets('default-focus', snapshot('bad', 'alpha', 4, 1, 46), valid), RangeError);
});
