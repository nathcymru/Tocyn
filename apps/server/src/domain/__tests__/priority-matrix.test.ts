import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  absoluteWindowHours,
  calculatePriorityScore,
  comparePriorityTickets,
  CONTRACT_TIER_WINDOW_HOURS,
  CRITICALITY_TIER_WINDOW_HOURS,
  PRIORITY_CATEGORY_BASE,
  PRIORITY_SCOPE_MULTIPLIER,
  timeRemainingHours,
  type PrioritySortTicket,
  type PriorityView,
} from '../../../../../packages/shared/priority-matrix';

test('category and scope tables cover the approved values', () => {
  assert.deepEqual(Object.values(PRIORITY_CATEGORY_BASE), [10, 10, 7, 7, 4, 4, 4, 1, 1, 1, 1]);
  assert.deepEqual(PRIORITY_SCOPE_MULTIPLIER, { systemic: 3, localised: 2, isolated: 1 });
});

test('score adds the supplied modifier total without assigning urgency conditions', () => {
  assert.equal(calculatePriorityScore('technical-problems', 'localised', 0), 14);
  assert.equal(calculatePriorityScore('technical-problems', 'localised', 5), 19);
  for (const invalid of [-5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
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

const snapshot = (
  ticketId: string, contractTier: PrioritySortTicket['contractTier'],
  criticalityTier: PrioritySortTicket['criticalityTier'], remaining: number,
): PrioritySortTicket => ({ ticketId, contractTier, criticalityTier, timeRemainingHours: remaining });

function sortedIds(view: PriorityView, tickets: PrioritySortTicket[]): string[] {
  return [...tickets].sort((a, b) => comparePriorityTickets(view, a, b)).map(ticket => ticket.ticketId);
}

test('Default Focus orders time, then criticality, contract, and ID', () => {
  const tickets = [
    snapshot('z', 'delta', 4, 2), snapshot('a', 'delta', 4, 2),
    snapshot('bravo', 'bravo', 4, 2), snapshot('lower', 'alpha', 3, 2),
    snapshot('overdue', 'delta', 1, -1), snapshot('later', 'alpha', 4, 3),
  ];
  assert.deepEqual(sortedIds('default-focus', tickets), ['overdue', 'bravo', 'a', 'z', 'lower', 'later']);
});

test('Criticality Matrix orders criticality, then time, then ID', () => {
  const tickets = [
    snapshot('low', 'alpha', 1, -10), snapshot('z', 'delta', 4, 2),
    snapshot('a', 'alpha', 4, 2), snapshot('soon', 'bravo', 4, -1),
    snapshot('middle', 'alpha', 3, -2),
  ];
  assert.deepEqual(sortedIds('criticality-matrix', tickets), ['soon', 'a', 'z', 'middle', 'low']);
});

test('SLA Commitment orders contract, criticality, time, and ID', () => {
  const tickets = [
    snapshot('delta', 'delta', 4, -4), snapshot('a', 'alpha', 4, 2),
    snapshot('z', 'alpha', 4, 2), snapshot('sooner', 'alpha', 4, 1),
    snapshot('lower', 'alpha', 3, -2), snapshot('bravo', 'bravo', 4, 0),
  ];
  assert.deepEqual(sortedIds('sla-commitment', tickets), ['sooner', 'a', 'z', 'lower', 'bravo', 'delta']);
  assert.throws(() => comparePriorityTickets('sla-commitment', snapshot('a', 'alpha', 4, Number.NaN), snapshot('b', 'alpha', 4, 1)), RangeError);
});

test('invalid view and every malformed sort snapshot fail even when an earlier key differs', () => {
  const valid = snapshot('valid', 'alpha', 4, 1);
  assert.throws(() => comparePriorityTickets('unknown' as never, valid, valid), RangeError);
  assert.throws(() => comparePriorityTickets('criticality-matrix', snapshot('bad', 'delta', 1, Number.NaN), valid), RangeError);
  assert.throws(() => comparePriorityTickets('sla-commitment', snapshot('bad', 'unknown' as never, 1, 1), valid), RangeError);
  assert.throws(() => comparePriorityTickets('default-focus', snapshot('bad', 'alpha', 5 as never, 1), valid), RangeError);
  assert.throws(() => comparePriorityTickets('default-focus', snapshot('', 'alpha', 4, 1), valid), RangeError);
});
