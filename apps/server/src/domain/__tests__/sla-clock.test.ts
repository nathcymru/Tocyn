import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLA_CALENDAR,
  SlaClockError,
  deadlineAfterWorkingTime,
  elapsedWorkingTime,
  evaluateResolutionSla,
  evaluateResponseSla,
  parseSlaCalendar,
  slaClockStart,
} from '../sla-clock';

const hour = 60 * 60 * 1_000;
const at = (value: string) => new Date(value);

function calendar(timeZone: string, weekly: Record<string, unknown>, exceptions: unknown[] = [], dst = { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' }) {
  return parseSlaCalendar({ timeZone, weekly, exceptions, dst });
}

describe('SLA calendar clock', () => {
  it('uses the required 24/7 UTC default for response and resolution clocks', () => {
    const input = { calendar: DEFAULT_SLA_CALENDAR, startedAt: at('2026-01-01T00:00:00Z'), evaluatedAt: at('2026-01-01T01:30:00Z'), targetWorkingMilliseconds: 2 * hour };
    expect(evaluateResponseSla(input)).toMatchObject({ elapsedWorkingMilliseconds: 90 * 60_000, remainingWorkingMilliseconds: 30 * 60_000, state: 'on-track', dueAt: at('2026-01-01T02:00:00Z') });
    expect(evaluateResolutionSla({ ...input, evaluatedAt: at('2026-01-01T02:01:00Z') }).state).toBe('breached');
  });

  it('skips non-working calendar days and a configured closure', () => {
    const business = calendar('Europe/London', {
      monday: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
      tuesday: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
      wednesday: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
      thursday: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
      friday: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
    }, [{ date: '2026-11-09', intervals: [] }]);
    const result = deadlineAfterWorkingTime({ calendar: business, startedAt: at('2026-11-06T16:00:00Z'), targetWorkingMilliseconds: 2 * hour });
    expect(result.dueAt).toEqual(at('2026-11-10T10:00:00Z'));
    expect(elapsedWorkingTime({ calendar: business, startedAt: at('2026-11-06T16:00:00Z'), evaluatedAt: at('2026-11-10T11:00:00Z') }).elapsedWorkingMilliseconds)
      .toBe(3 * hour);
  });

  it('subtracts merged explicit pause intervals from elapsed and deadline arithmetic', () => {
    const business = calendar('UTC', { monday: [{ startMinute: 9 * 60, endMinute: 17 * 60 }] });
    const pauses = [
      { startsAt: at('2026-11-02T10:00:00Z'), endsAt: at('2026-11-02T11:00:00Z') },
      { startsAt: at('2026-11-02T10:30:00Z'), endsAt: at('2026-11-02T12:00:00Z') },
    ];
    expect(elapsedWorkingTime({ calendar: business, startedAt: at('2026-11-02T09:00:00Z'), evaluatedAt: at('2026-11-02T16:00:00Z'), pauses }))
      .toMatchObject({ elapsedWorkingMilliseconds: 5 * hour, activePauseMilliseconds: 2 * hour });
    expect(deadlineAfterWorkingTime({ calendar: business, startedAt: at('2026-11-02T09:00:00Z'), targetWorkingMilliseconds: 4 * hour, pauses }).dueAt)
      .toEqual(at('2026-11-02T15:00:00Z'));
  });

  it('handles a DST spring gap using the configured gap policy', () => {
    const sunday = calendar('Europe/London', { sunday: [{ startMinute: 0, endMinute: 3 * 60 }] });
    const result = deadlineAfterWorkingTime({ calendar: sunday, startedAt: at('2026-03-29T00:00:00Z'), targetWorkingMilliseconds: 2 * hour });
    expect(result.dueAt).toEqual(at('2026-03-29T02:00:00Z'));
    const rejectGap = calendar('Europe/London', { sunday: [{ startMinute: 60, endMinute: 120 }] }, [], { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'reject' });
    expect(() => deadlineAfterWorkingTime({ calendar: rejectGap, startedAt: at('2026-03-29T00:00:00Z'), targetWorkingMilliseconds: hour })).toThrow(/DST gap/);
  });

  it('makes a DST fold policy explicit and deterministic', () => {
    const both = calendar('Europe/London', { sunday: [{ startMinute: 60, endMinute: 120 }] }, [], { ambiguousLocalTime: 'both', nonexistentLocalTime: 'next-valid' });
    const later = calendar('Europe/London', { sunday: [{ startMinute: 60, endMinute: 120 }] }, [], { ambiguousLocalTime: 'later', nonexistentLocalTime: 'next-valid' });
    const range = { startedAt: at('2026-10-25T00:00:00Z'), evaluatedAt: at('2026-10-25T03:00:00Z') };
    expect(elapsedWorkingTime({ calendar: both, ...range }).elapsedWorkingMilliseconds).toBe(2 * hour);
    expect(elapsedWorkingTime({ calendar: later, ...range }).elapsedWorkingMilliseconds).toBe(hour);
  });

  it('normalizes locally adjacent windows that overlap when a fold covers both occurrences', () => {
    const folded = calendar('Europe/London', {
      sunday: [{ startMinute: 60, endMinute: 90 }, { startMinute: 90, endMinute: 120 }],
    }, [], { ambiguousLocalTime: 'both', nonexistentLocalTime: 'next-valid' });
    expect(elapsedWorkingTime({ calendar: folded, startedAt: at('2026-10-25T00:00:00Z'), evaluatedAt: at('2026-10-25T03:00:00Z') }).elapsedWorkingMilliseconds)
      .toBe(2 * hour);
  });

  it('returns an unavailable result for an intentionally empty calendar', () => {
    const empty = calendar('UTC', {});
    expect(deadlineAfterWorkingTime({ calendar: empty, startedAt: at('2026-01-01T00:00:00Z'), targetWorkingMilliseconds: hour }))
      .toMatchObject({ dueAt: null, reason: 'no-working-time' });
  });

  it('rejects malformed calendars, invalid instants, and malformed pauses', () => {
    expect(() => calendar('Not/A_Zone', {})).toThrow(SlaClockError);
    expect(() => calendar('UTC', { monday: [{ startMinute: 600, endMinute: 540 }] })).toThrow(/end after it starts/);
    expect(() => calendar('UTC', { someday: [] })).toThrow(/unknown weekday/);
    expect(() => calendar('UTC', {}, [{ date: '2026-02-29', intervals: [] }])).toThrow(/real Gregorian date/);
    expect(() => calendar('UTC', {}, [{ date: '0099-01-01', intervals: [] }])).toThrow(/before 0100/);
    expect(() => elapsedWorkingTime({ calendar: DEFAULT_SLA_CALENDAR, startedAt: new Date('invalid'), evaluatedAt: at('2026-01-01T01:00:00Z') })).toThrow(/valid, safe/);
    const year99 = new Date(0);
    year99.setUTCFullYear(99, 0, 1);
    expect(() => elapsedWorkingTime({ calendar: DEFAULT_SLA_CALENDAR, startedAt: year99, evaluatedAt: at('2026-01-01T01:00:00Z') })).toThrow(/year must be from/);
    expect(() => elapsedWorkingTime({ calendar: DEFAULT_SLA_CALENDAR, startedAt: new Date(8_640_000_000_000_000), evaluatedAt: at('2026-01-01T01:00:00Z') })).toThrow(/year must be from/);
    expect(() => elapsedWorkingTime({ calendar: DEFAULT_SLA_CALENDAR, startedAt: at('2026-01-01T00:00:00Z'), evaluatedAt: at('2026-01-01T01:00:00Z'), pauses: [{ startsAt: at('2026-01-01T01:00:00Z'), endsAt: at('2026-01-01T00:00:00Z') }] })).toThrow(/end after it starts/);
    expect(() => deadlineAfterWorkingTime({ calendar: DEFAULT_SLA_CALENDAR, startedAt: at('2026-01-01T00:00:00Z'), targetWorkingMilliseconds: -1 })).toThrow(/non-negative/);
  });

  it('keeps reopening behavior an explicit caller policy', () => {
    const base = { openedAt: at('2026-01-01T00:00:00Z'), reopenedAt: at('2026-01-02T00:00:00Z'), reopenPolicy: { response: 'restart' as const, resolution: 'continue' as const } };
    expect(slaClockStart({ ...base, clock: 'response' })).toEqual(base.reopenedAt);
    expect(slaClockStart({ ...base, clock: 'resolution' })).toEqual(base.openedAt);
  });

  it('stops a deadline calculation at the caller-provided resource bound', () => {
    expect(deadlineAfterWorkingTime({ calendar: DEFAULT_SLA_CALENDAR, startedAt: at('2026-01-01T00:00:00Z'), targetWorkingMilliseconds: 2 * 24 * hour, limits: { maxCalendarDays: 1 } }))
      .toMatchObject({ dueAt: null, reason: 'resource-limit' });
  });
});
