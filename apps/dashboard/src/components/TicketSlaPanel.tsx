import { useTicketSla, type SlaTarget } from '../hooks/useTicketSla';
import { ParkButton, ParkTicketDetail } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';

import { slaTargetLabel } from './SlaTargetStatus';

function Target({ label, target, detailStyles }: { label: string; target: SlaTarget; detailStyles: ReturnType<typeof ParkTicketDetail> }) {
  return <div><dt className={detailStyles.slaLabel}>{label}</dt><dd data-state={target.state} className={detailStyles.slaValue}>{slaTargetLabel(target)}</dd></div>;
}

/** Independent ticket-detail section; the composing page mounts it after its own data boundary. */
export function TicketSlaPanel({ ticketId }: { ticketId: string }) {
  const detailStyles = ParkTicketDetail();
  const { data, isLoading, isError, refetch, isFetching } = useTicketSla(ticketId);
  const compactState = css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2', minH: '9', px: '3', py: '1', borderWidth: '1px', borderColor: 'border.default', rounded: 'l2', bg: 'bg.subtle', color: 'text.muted', fontSize: 'sm' });
  if (isLoading) return <section role="status" aria-busy="true" aria-label="Service level" className={compactState}>Loading service level…</section>;
  if (isError || !data) return <section role="alert" aria-label="Service level" className={compactState}>
    <span>Service level is unavailable.</span>
    <ParkButton type="button" variant="plain" size="sm" disabled={isFetching} onClick={() => void refetch()}>Retry</ParkButton>
  </section>;
  return <section aria-label="Service level" className={detailStyles.slaPanel}>
    <h2 className={detailStyles.slaTitle}>Service level</h2>
    <dl className={detailStyles.slaGrid}><Target label="First response" target={data.response} detailStyles={detailStyles}/><Target label="Resolution" target={data.resolution} detailStyles={detailStyles}/></dl>
    {data.handlerName ? <p className={detailStyles.slaHandler}>Handler: {data.handlerName}</p> : null}
  </section>;
}
