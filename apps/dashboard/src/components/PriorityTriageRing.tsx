import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { absoluteWindowHours, type ContractTier, type CriticalityTier, type Ticket } from '@luminatick/shared';
import { css } from '@luminatick/ui/styled-system/css';

/** A classified ticket; the optional legacy fields on Ticket are required here. */
export type PriorityRingTicket = Pick<Ticket, 'status'> & {
  contract_sla_tier: ContractTier;
  criticality_tier: CriticalityTier;
};

/** Authoritative fixed-hour clock snapshot, independent of the contractual SLA. */
export interface PriorityClockProjection {
  remainingHours: number;
  paused: boolean;
  asOf: string;
}

export interface PriorityTriageRingProps {
  ticket: PriorityRingTicket;
  projection: PriorityClockProjection | null | undefined;
}

const HOUR_MS = 3_600_000;
const CIRCUMFERENCE = 2 * Math.PI * 25;
const TIER_NAMES: Readonly<Record<ContractTier, string>> = {
  alpha: 'Alpha', bravo: 'Bravo', charlie: 'Charlie', delta: 'Delta',
};

function formatHours(hours: number): string {
  const minutes = hours === 0 ? 0 : Math.max(1, Math.round(Math.abs(hours) * 60));
  if (minutes < 60) return `${minutes}m`;
  const wholeHours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${wholeHours}h ${rest}m` : `${wholeHours}h`;
}

/** The snapshot is not inferred from ticket creation or contractual SLA dates. */
export function PriorityTriageRing({ ticket, projection }: PriorityTriageRingProps) {
  const [, setTick] = useState(0);
  // The server owns the clock. A monotonic local interval only animates the
  // received snapshot; browser wall-clock skew must never create a breach.
  const received = useRef<{ projection: PriorityClockProjection | null | undefined; at: number }>({ projection, at: performance.now() });
  if (received.current.projection !== projection) received.current = { projection, at: performance.now() };
  const terminal = ticket.status === 'resolved' || ticket.status === 'closed';
  const available = Boolean(projection && Number.isFinite(projection.remainingHours) && Number.isFinite(Date.parse(projection.asOf)));
  const running = Boolean(available && !projection?.paused && !terminal);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick(value => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [running, projection]);

  const remaining = available && projection
    ? projection.remainingHours - (running ? Math.max(0, performance.now() - received.current.at) / HOUR_MS : 0)
    : null;
  const windowHours = absoluteWindowHours(ticket.contract_sla_tier, ticket.criticality_tier);
  const elapsed = remaining === null ? null : Math.max(0, Math.min(1, 1 - remaining / windowHours));
  const overdue = remaining !== null && remaining <= 0;
  const status = remaining === null
    ? 'Clock unavailable'
    : `${overdue ? `Overdue by ${formatHours(remaining)}` : `${formatHours(remaining)} remaining`}${terminal ? ', stopped' : projection?.paused ? ', paused' : ''}`;
  const tierName = TIER_NAMES[ticket.contract_sla_tier];
  const tierCode = `${tierName[0]}${ticket.criticality_tier}`;
  const label = `${tierName} contract, level ${ticket.criticality_tier} priority triage clock: ${status}`;
  const pulsing = overdue && running;

  return <div
    role={elapsed === null ? 'status' : 'meter'}
    aria-label={label}
    aria-valuemin={elapsed === null ? undefined : 0}
    aria-valuemax={elapsed === null ? undefined : 100}
    aria-valuenow={elapsed === null ? undefined : Math.round(elapsed * 100)}
    aria-valuetext={elapsed === null ? undefined : status}
    data-priority-clock-state={remaining === null ? 'unavailable' : terminal ? 'stopped' : projection?.paused ? 'paused' : overdue ? 'overdue' : 'running'}
    data-priority-clock-pulsing={pulsing ? 'true' : 'false'}
    className={css({ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '1', minW: '16', color: overdue ? 'red.11' : 'fg.default', fontFamily: 'primary' })}
  >
    <span className={clsx(css({ position: 'relative', display: 'inline-grid', h: '16', w: '16', placeItems: 'center', borderRadius: 'full' }), pulsing && css({
      animation: 'overduePulse 1.5s infinite',
      '@media (prefers-reduced-motion: reduce)': {
        animation: 'none',
        'html[data-tocyn-motion="full"] &': { animation: 'overduePulse 1.5s infinite' },
      },
    }))}>
      <svg aria-hidden="true" viewBox="0 0 64 64" className={css({ position: 'absolute', inset: 0, h: 'full', w: 'full', transform: 'rotate(-90deg)' })}>
        <circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.18" />
        {elapsed !== null && <circle data-part="priority-ring-progress" cx="32" cy="32" r="25" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - elapsed)} />}
      </svg>
      <span aria-hidden="true" className={css({ fontFamily: 'tabular', fontSize: 'sm', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' })}>{tierCode}</span>
    </span>
    <span aria-hidden="true" className={css({ fontFamily: 'tabular', fontSize: 'xs', fontWeight: 'semibold', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' })}>{remaining === null ? '—' : `${overdue ? '−' : ''}${formatHours(remaining)}`}</span>
    {projection?.paused && !terminal && remaining !== null && <span aria-hidden="true" className={css({ fontSize: '2xs', color: 'fg.muted' })}>Paused</span>}
  </div>;
}
