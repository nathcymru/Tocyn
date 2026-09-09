import { describe, expect, it } from 'vitest';
import { utcTimestamp } from '../utils/utcTimestamp';

describe('UTC database timestamp parsing', () => {
  it('treats an offset-less SQLite timestamp as UTC', () => {
    expect(utcTimestamp('2030-01-02 03:04:05').toISOString()).toBe('2030-01-02T03:04:05.000Z');
  });

  it('preserves an explicit offset timestamp', () => {
    expect(utcTimestamp('2030-01-02T03:04:05+01:00').toISOString()).toBe('2030-01-02T02:04:05.000Z');
  });
});
