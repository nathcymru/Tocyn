import { useTicketSla, type SlaTarget } from '../hooks/useTicketSla';

import { slaTargetLabel } from './SlaTargetStatus';

function Target({ label, target }: { label: string; target: SlaTarget }) {
  const tone = target.state === 'breached' ? 'text-red-700' : target.state === 'on-track' ? 'text-emerald-700' : 'text-slate-600';
  return <div><dt className="text-sm font-medium text-slate-700">{label}</dt><dd className={tone}>{slaTargetLabel(target)}</dd></div>;
}

/** Independent ticket-detail section; the composing page mounts it after its own data boundary. */
export function TicketSlaPanel({ ticketId }: { ticketId: string }) {
  const { data, isLoading, isError, refetch, isFetching } = useTicketSla(ticketId);
  if (isLoading) return <section aria-label="Service level" className="rounded border border-slate-200 p-4 text-sm text-slate-600">Loading service level…</section>;
  if (isError || !data) return <section aria-label="Service level" className="rounded border border-slate-200 p-4 text-sm text-slate-600">Service level is unavailable. <button type="button" className="underline" disabled={isFetching} onClick={() => void refetch()}>Retry</button></section>;
  return <section aria-label="Service level" className="rounded border border-slate-200 p-4">
    <h2 className="font-semibold text-slate-900">Service level</h2>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2"><Target label="First response" target={data.response}/><Target label="Resolution" target={data.resolution}/></dl>
    {data.handlerName ? <p className="mt-3 text-sm text-slate-600">Handler: {data.handlerName}</p> : null}
  </section>;
}
