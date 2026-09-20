import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PriorityTriageRing, type PriorityRingTicket } from '../components/PriorityTriageRing';

const ticket: PriorityRingTicket = { status: 'open', contract_sla_tier: 'bravo', criticality_tier: 2 };
const asOf = '2026-09-20T12:00:00.000Z';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(asOf)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('priority triage ring', () => {
  it('shows the tier and level code and advances the fixed-hour ring from the supplied snapshot', () => {
    render(<PriorityTriageRing ticket={ticket} projection={{ remainingHours: 2, paused: false, asOf }} />);
    const meter = screen.getByRole('meter', { name: /Bravo contract, level 2 priority triage clock: 2h remaining/ });
    expect(meter).toHaveAttribute('aria-valuenow', '50');
    expect(meter).toHaveAttribute('aria-valuetext', '2h remaining');
    expect(meter).toHaveTextContent('B2');
    expect(meter.querySelector('[data-part="priority-ring-progress"]')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(90 * 60_000); });
    expect(meter).toHaveAttribute('aria-valuenow', '88');
    expect(meter).toHaveAttribute('aria-valuetext', '30m remaining');
  });

  it('keeps signed overdue time and pulses only while the fixed-hour clock is running', () => {
    const { rerender } = render(<PriorityTriageRing ticket={ticket} projection={{ remainingHours: -0.5, paused: false, asOf }} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuetext', 'Overdue by 30m');
    expect(meter).toHaveTextContent('−30m');
    expect(meter).toHaveAttribute('data-priority-clock-pulsing', 'true');
    expect(meter.firstElementChild).toHaveClass('anim_overduePulse_1.5s_infinite');
    expect(meter.firstElementChild?.className).toContain('anim_none');
    expect(meter.firstElementChild?.className).toContain('data-tocyn-motion');

    rerender(<PriorityTriageRing ticket={ticket} projection={{ remainingHours: -0.5, paused: true, asOf }} />);
    expect(meter).toHaveAttribute('data-priority-clock-state', 'paused');
    expect(meter).toHaveAttribute('data-priority-clock-pulsing', 'false');
    expect(meter.firstElementChild).not.toHaveClass('anim_overduePulse_1.5s_infinite');
    expect(meter).toHaveAttribute('aria-valuetext', 'Overdue by 30m, paused');
    act(() => { vi.advanceTimersByTime(2 * 60 * 60_000); });
    expect(meter).toHaveAttribute('aria-valuetext', 'Overdue by 30m, paused');
  });

  it('treats the exact fixed-hour deadline as overdue, but never pulses a paused clock', () => {
    const a4 = { ...ticket, contract_sla_tier: 'alpha' as const, criticality_tier: 4 as const };
    const { rerender } = render(<PriorityTriageRing ticket={a4} projection={{ remainingHours: 0, paused: false, asOf }} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('data-priority-clock-state', 'overdue');
    expect(meter).toHaveAttribute('data-priority-clock-pulsing', 'true');
    expect(meter).toHaveAttribute('aria-valuetext', 'Overdue by 0m');
    rerender(<PriorityTriageRing ticket={a4} projection={{ remainingHours: 0, paused: true, asOf }} />);
    expect(meter).toHaveAttribute('data-priority-clock-state', 'paused');
    expect(meter).toHaveAttribute('data-priority-clock-pulsing', 'false');
  });

  it('shows a stopped clock for resolved tickets with the authoritative paused projection', () => {
    render(<PriorityTriageRing ticket={{ ...ticket, status: 'resolved' }} projection={{ remainingHours: 1, paused: true, asOf }} />);
    const meter = screen.getByRole('meter');
    act(() => { vi.advanceTimersByTime(2 * 60 * 60_000); });
    expect(meter).toHaveAttribute('aria-valuetext', '1h remaining, stopped');
    expect(meter).toHaveAttribute('data-priority-clock-state', 'stopped');
    expect(meter).toHaveAttribute('data-priority-clock-pulsing', 'false');
  });

  it('shows unavailable without inventing progress when no valid fixed-hour projection exists', () => {
    const a4 = { ...ticket, contract_sla_tier: 'alpha' as const, criticality_tier: 4 as const };
    const { rerender } = render(<PriorityTriageRing ticket={a4} projection={null} />);
    const status = screen.getByRole('status', { name: /Alpha contract, level 4 priority triage clock: Clock unavailable/ });
    expect(status).toHaveTextContent('A4—');
    expect(status.querySelector('[data-part="priority-ring-progress"]')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();

    rerender(<PriorityTriageRing ticket={a4} projection={{ remainingHours: Number.NaN, paused: false, asOf }} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-priority-clock-state', 'unavailable');
  });

  it('does not treat a skewed browser wall clock as elapsed server time', () => {
    vi.setSystemTime(new Date('2026-09-20T14:00:00.000Z'));
    render(<PriorityTriageRing ticket={{ ...ticket, contract_sla_tier: 'alpha', criticality_tier: 4 }}
      projection={{ remainingHours: 1, paused: false, asOf }} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuetext', '1h remaining');
    expect(meter).toHaveAttribute('data-priority-clock-pulsing', 'false');
    act(() => { vi.advanceTimersByTime(30 * 60_000); });
    expect(meter).toHaveAttribute('aria-valuetext', '30m remaining');
  });
});
