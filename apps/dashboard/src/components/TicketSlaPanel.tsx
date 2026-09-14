import { useTicketSla, type SlaTarget } from '../hooks/useTicketSla';
import { TocynButton, TocynEmptyState } from '@luminatick/ui/primitives';

import { slaTargetLabel } from './SlaTargetStatus';

function Target({ label, target }: { label: string; target: SlaTarget }) {
  const tone = target.state === 'breached' ? 'text-[var(--tocyn-sla-breach-text)]' : target.state === 'on-track' ? 'text-[var(--tocyn-sla-on-track-text)]' : 'text-slate-600';
  return <div><dt className="text-sm font-medium text-slate-700">{label}</dt><dd className={tone}>{slaTargetLabel(target)}</dd></div>;
}

function compactTarget(target: SlaTarget) {
  if (target.state === 'unavailable') return target.targetWorkingMilliseconds === null ? 'Not configured' : 'Unavailable';
  if (target.phase === 'completed') return target.state === 'breached' ? 'Completed late' : 'Completed';
  if (target.phase === 'paused') return target.state === 'breached' ? 'Paused · breached' : 'Paused';
  return target.state === 'breached' ? 'Breached' : 'On track';
}

/** Independent ticket-detail section; the composing page mounts it after its own data boundary. */
export function TicketSlaPanel({ ticketId }: { ticketId: string }) {
  const { data, isLoading, isError, refetch, isFetching } = useTicketSla(ticketId);
  if (isLoading) return <section aria-label="Service level" className="rounded border border-slate-200 p-4 text-sm text-slate-600">Loading service level…</section>;
  if (isError || !data) return <section aria-label="Service level" className="rounded border border-slate-200 p-4">
    <TocynEmptyState
      title="Service level unavailable"
      description="The service level could not be loaded. Try again to see response and resolution targets."
      action={<TocynButton type="button" disabled={isFetching} onClick={() => void refetch()}>Retry service level</TocynButton>}
    />
  </section>;
  return <section aria-label="Service level" className="rounded border border-slate-200 p-4">
    <h2 className="font-semibold text-slate-900">Service level</h2>
    <p aria-label="SLA status" className="tocyn-sla-summary">First response: {compactTarget(data.response)} · Resolution: {compactTarget(data.resolution)}</p>
    <details className="tocyn-sla-details"><summary>Service level details</summary>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2"><Target label="First response" target={data.response}/><Target label="Resolution" target={data.resolution}/></dl>
    {data.handlerName ? <p className="mt-3 text-sm text-slate-600">Handler: {data.handlerName}</p> : null}
    </details>
  </section>;
}
