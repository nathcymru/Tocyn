import { useTicketSla, type SlaTarget } from '../hooks/useTicketSla';
import { ParkButton } from '@luminatick/ui/park';

import { slaTargetLabel } from './SlaTargetStatus';

function Target({ label, target }: { label: string; target: SlaTarget }) {
  const tone = target.state === 'breached' ? 'tocyn-ticket-sla-breach' : target.state === 'on-track' ? 'tocyn-ticket-sla-on-track' : 'tocyn-ticket-sla-muted';
  return <div><dt className="tocyn-ticket-sla-label">{label}</dt><dd className={tone}>{slaTargetLabel(target)}</dd></div>;
}

/** Independent ticket-detail section; the composing page mounts it after its own data boundary. */
export function TicketSlaPanel({ ticketId }: { ticketId: string }) {
  const { data, isLoading, isError, refetch, isFetching } = useTicketSla(ticketId);
  if (isLoading) return <section aria-label="Service level" className="tocyn-ticket-sla-state">Loading service level…</section>;
  if (isError || !data) return <section aria-label="Service level" className="tocyn-ticket-sla-state">Service level is unavailable. <ParkButton type="button" className="tocyn-inline-link" disabled={isFetching} onClick={() => void refetch()}>Retry</ParkButton></section>;
  return <section aria-label="Service level" className="tocyn-ticket-sla-panel">
    <h2 className="tocyn-ticket-sla-title">Service level</h2>
    <dl className="tocyn-ticket-sla-grid"><Target label="First response" target={data.response}/><Target label="Resolution" target={data.resolution}/></dl>
    {data.handlerName ? <p className="tocyn-ticket-sla-handler">Handler: {data.handlerName}</p> : null}
  </section>;
}
