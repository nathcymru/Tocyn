import type { SlaTarget } from '../hooks/useTicketSla';

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function remainingLabel(milliseconds: number) {
  if (milliseconds === 0) return '0 working minutes remaining';
  const minutes = Math.ceil(milliseconds / 60_000);
  return `${minutes.toLocaleString()} working ${minutes === 1 ? 'minute' : 'minutes'} remaining`;
}

export function slaTargetLabel(target: SlaTarget) {
  if (target.state === 'unavailable') return target.targetWorkingMilliseconds === null ? 'Not configured' : 'Calculation unavailable';
  if (target.phase === 'completed') {
    return `Completed ${target.state === 'breached' ? 'after deadline' : 'on time'}${target.completedAt ? ` · ${dateLabel(target.completedAt)}` : ''}`;
  }
  if (target.phase === 'paused') {
    return `Paused${target.state === 'breached' ? ' · breached' : ''}${target.remainingWorkingMilliseconds !== null ? ` · ${remainingLabel(target.remainingWorkingMilliseconds)}` : ''}`;
  }
  const due = target.dueAt ? `${target.state === 'breached' ? 'deadline was' : 'Due'} ${dateLabel(target.dueAt)}` : '';
  return target.state === 'breached' ? `Breached${due ? ` · ${due}` : ''}` : due || 'On track';
}

export function SlaTargetStatus({ target }: { target: SlaTarget }) {
  return <span className={target.state === 'breached' ? 'text-[var(--tocyn-sla-breach-text)]' : 'text-slate-600'}>{slaTargetLabel(target)}</span>;
}
