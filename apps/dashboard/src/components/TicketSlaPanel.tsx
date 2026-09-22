import { useTicketSla, type SlaTarget } from '../hooks/useTicketSla';
import { ParkAlert, ParkButton, ParkSkeleton, ParkTicketDetail } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';

import { slaTargetLabel } from './SlaTargetStatus';

function Target({ label, target, detailStyles }: { label: string; target: SlaTarget; detailStyles: ReturnType<typeof ParkTicketDetail> }) {
  return <div><dt className={detailStyles.slaLabel}>{label}</dt><dd data-state={target.state} className={detailStyles.slaValue}>{slaTargetLabel(target)}</dd></div>;
}

/** Independent ticket-detail section; the composing page mounts it after its own data boundary. */
export function TicketSlaPanel({ ticketId }: { ticketId: string }) {
  const detailStyles = ParkTicketDetail();
  const { data, isLoading, isError, refetch, isFetching } = useTicketSla(ticketId);
  if (isLoading) return <section role="status" aria-busy="true" aria-label="Service level" className={css({ display: 'grid', gap: '2', p: '3', bg: 'bg.subtle' })}>
    <span className={css({ srOnly: true })}>Loading service level…</span>
    <ParkSkeleton aria-hidden="true" height="4" width="70%" />
    <ParkSkeleton aria-hidden="true" height="4" width="90%" />
  </section>;
  if (isError || !data) return <ParkAlert.Root role="alert" aria-label="Service level" status="error" variant="surface">
    <ParkAlert.Content>
      <ParkAlert.Description>Service level is unavailable.</ParkAlert.Description>
      <ParkButton type="button" variant="plain" size="sm" disabled={isFetching} onClick={() => void refetch()}>Retry</ParkButton>
    </ParkAlert.Content>
  </ParkAlert.Root>;
  return <section aria-label="Service level" className={detailStyles.slaPanel}>
    <h2 className={detailStyles.slaTitle}>Service level</h2>
    <dl className={detailStyles.slaGrid}><Target label="First response" target={data.response} detailStyles={detailStyles}/><Target label="Resolution" target={data.resolution} detailStyles={detailStyles}/></dl>
    {data.handlerName ? <p className={detailStyles.slaHandler}>Handler: {data.handlerName}</p> : null}
  </section>;
}
