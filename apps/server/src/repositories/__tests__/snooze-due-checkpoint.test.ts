import { describe, expect, it } from 'vitest';
import { validateSnoozeStepInput } from '../snooze-due-checkpoint.repository';

const base = { expectedGeneration: 0, stepId: 'a3200000-0000-4000-8000-000000000001',
  dueThrough: '2026-09-13T18:00:00.000Z', activeSnoozeSnapshot: 0 };

describe('snooze checkpoint input', () => {
  it.each([
    ['base', {}, true],
    ['last advanceable generation', { expectedGeneration: Number.MAX_SAFE_INTEGER - 1 }, true],
    ['exhausted generation', { expectedGeneration: Number.MAX_SAFE_INTEGER }, false],
    ['fractional generation', { expectedGeneration: 1.5 }, false],
    ['negative generation', { expectedGeneration: -1 }, false],
    ['uppercase UUID', { stepId: 'A3200000-0000-4000-8000-000000000001' }, false],
    ['wrong UUID version', { stepId: 'a3200000-0000-5000-8000-000000000001' }, false],
    ['valid leap date', { dueThrough: '2024-02-29T12:00:00.000Z' }, true],
    ['invalid leap date', { dueThrough: '2024-02-30T12:00:00.000Z' }, false],
    ['offset date', { dueThrough: '2024-03-01T12:00:00+01:00' }, false],
    ['negative population', { activeSnoozeSnapshot: -1 }, false],
    ['fractional population', { activeSnoozeSnapshot: 0.5 }, false],
    ['string generation', { expectedGeneration: '0' }, false],
    ['NaN generation', { expectedGeneration: NaN }, false],
    ['infinite population', { activeSnoozeSnapshot: Infinity }, false],
    ['safe primitive population requires later arithmetic check', { activeSnoozeSnapshot: Number.MAX_SAFE_INTEGER }, true],
  ])('%s', (_name, override, valid) => {
    expect(validateSnoozeStepInput({ ...base, ...override }) !== null).toBe(valid);
  });
  it('rejects null', () => expect(validateSnoozeStepInput(null)).toBeNull());
  it('rejects missing step identity', () => expect(validateSnoozeStepInput({ expectedGeneration: 0,
    dueThrough: base.dueThrough, activeSnoozeSnapshot: 0 })).toBeNull());
});
