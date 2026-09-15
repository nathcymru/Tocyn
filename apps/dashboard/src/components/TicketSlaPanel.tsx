import { useTicketSla, type SlaTarget } from '../hooks/useTicketSla';
import { ParkButton, ParkEmptyState, ParkTicketDetail } from '@luminatick/ui/park';

import { slaTargetLabel } from './SlaTargetStatus';

function Target({ label, target, detailStyles }: { label: string; target: SlaTarget; detailStyles: ReturnType<typeof ParkTicketDetail> }) {
  return <div><dt className={detailStyles.slaLabel}>{label}</dt><dd data-state={target.state} className={detailStyles.slaValue}>{slaTargetLabel(target)}</dd></div>;
}

/** Independent ticket-detail section; the composing page mounts it after its own data boundary. */
export function TicketSlaPanel({ ticketId }: { ticketId: string }) {
  const detailStyles = ParkTicketDetail();
  const { data, isLoading, isError, refetch, isFetching } = useTicketSla(ticketId);
  if (isLoading) return <ParkEmptyState role="status" aria-busy="true" headingLevel={false} title="Loading service level…" className="tocyn-ticket-sla-state" />;
  if (isError || !data) return <ParkEmptyState role="alert" headingLevel={false} title="Service level is unavailable." className="tocyn-ticket-sla-state" action={<ParkButton type="button" className="tocyn-inline-link" disabled={isFetching} onClick={() => void refetch()}>Retry</ParkButton>} />;
  return <section aria-label="Service level" className={detailStyles.slaPanel}>
    <h2 className={detailStyles.slaTitle}>Service level</h2>
    <dl className={detailStyles.slaGrid}><Target label="First response" target={data.response} detailStyles={detailStyles}/><Target label="Resolution" target={data.resolution} detailStyles={detailStyles}/></dl>
    {data.handlerName ? <p className={detailStyles.slaHandler}>Handler: {data.handlerName}</p> : null}
  </section>;
}
