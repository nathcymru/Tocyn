import { expect, it } from 'vitest';
import { utcTimestamp } from '../utils/utcTimestamp';

it('interprets SQLite conversation times as UTC before formatting for the operator timezone', () => {
  const timestamp = utcTimestamp('2026-09-09 02:09:00');
  expect(timestamp.toISOString()).toBe('2026-09-09T02:09:00.000Z');
  expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(timestamp)).toBe('03:09');
});

it('preserves explicit offsets and UTC timestamps', () => {
  expect(utcTimestamp('2026-09-09T03:09:00+01:00').toISOString()).toBe('2026-09-09T02:09:00.000Z');
  expect(utcTimestamp('2026-09-09T02:09:00Z').toISOString()).toBe('2026-09-09T02:09:00.000Z');
});
