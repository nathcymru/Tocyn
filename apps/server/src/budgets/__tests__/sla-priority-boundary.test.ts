import { describe, expect, it } from 'vitest';
import { nextPriorityChangeAt, SlaQueueUnavailable, type SlaQueueItem } from '../sla-priority-queue-admission.service';

const asOf = Date.parse('2026-09-20T12:00:00.000Z');
const hour = 3_600_000;

function row(window: 1 | 4 | 24 | 48, remainingMs: number, options: { paused?: boolean; status?: string } = {}): SlaQueueItem {
  const tiers = {
    1: ['alpha', 4], 4: ['bravo', 3], 24: ['charlie', 2], 48: ['delta', 1],
  } as const;
  const [contract_sla_tier, criticality_tier] = tiers[window];
  return {
    ticket: { id: `ticket-${window}`, status: options.status ?? 'open', contract_sla_tier, criticality_tier, priority_score: 1 },
    priorityClock: { elapsedActiveMs: window * hour - remainingMs, paused: options.paused ?? false },
  } as unknown as SlaQueueItem;
}

describe('whole-queue priority change schedule', () => {
  it.each([
    [48, 24], [48, 4], [48, 1], [24, 4], [24, 1], [4, 1], [1, 0],
  ] as const)('schedules the next %sh to %sh transition at the inclusive millisecond', (window, threshold) => {
    const before = row(window, threshold * hour + 1);
    expect(nextPriorityChangeAt([before], asOf)).toBe(new Date(asOf + 1).toISOString());
    const atThreshold = row(window, threshold * hour);
    expect(nextPriorityChangeAt([atThreshold], asOf)).not.toBe(new Date(asOf).toISOString());
  });

  it('ignores stopped work and returns null when nothing can change with elapsed time', () => {
    expect(nextPriorityChangeAt([
      row(1, 1, { paused: true }),
      row(1, 1, { status: 'resolved' }),
      row(1, 1, { status: 'closed' }),
      row(1, -1),
    ], asOf)).toBeNull();
    expect(nextPriorityChangeAt([], asOf)).toBeNull();
  });

  it('rejects unsafe future timestamps before Date serialisation', () => {
    expect(() => nextPriorityChangeAt([row(1, 1)], 8_640_000_000_000_000)).toThrow(SlaQueueUnavailable);
  });
});
