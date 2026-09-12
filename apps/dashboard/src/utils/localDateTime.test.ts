import { describe, expect, it } from 'vitest';
import { dateTimeLocalToInstant, instantToDateTimeLocal } from './localDateTime';

describe('datetime-local conversion', () => {
  it('formats and submits a non-UTC local time without changing the instant', () => {
    const instant = '2026-09-13T13:30:00.000Z';
    const utcOffsetMinutes = 330; // Asia/Kolkata (UTC+05:30)

    expect(instantToDateTimeLocal(instant, utcOffsetMinutes)).toBe('2026-09-13T19:00');
    expect(dateTimeLocalToInstant('2026-09-13T19:00', utcOffsetMinutes)).toBe(instant);
  });

  it('uses the offset at each side of a DST transition', () => {
    // Europe/London moves from UTC to UTC+01:00 on 2026-03-29.
    expect(instantToDateTimeLocal('2026-03-29T00:30:00.000Z', 0)).toBe('2026-03-29T00:30');
    expect(instantToDateTimeLocal('2026-03-29T01:30:00.000Z', 60)).toBe('2026-03-29T02:30');
    expect(dateTimeLocalToInstant('2026-03-29T02:30', 60)).toBe('2026-03-29T01:30:00.000Z');
  });
});
