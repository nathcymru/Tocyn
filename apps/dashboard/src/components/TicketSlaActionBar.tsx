import { useTicketSla } from '../hooks/useTicketSla';
import { SlaTargetStatus } from './SlaTargetStatus';
import { ParkTicketDetail } from '@luminatick/ui/park';

/** Uses the detail's shared query and reports both independently configured clocks. */
export function TicketSlaActionBar({ ticketId }: { ticketId: string }) {
  const detailStyles = ParkTicketDetail();
  const { data, isError } = useTicketSla(ticketId);
  if (isError) return <span aria-label="SLA status" className={detailStyles.slaState}>Service level unavailable</span>;
  if (!data) return null;
  return <span aria-label="SLA status" className={detailStyles.slaActionBar}>
    <span>First response: <SlaTargetStatus target={data.response}/></span>
    <span>Resolution: <SlaTargetStatus target={data.resolution}/></span>
  </span>;
}
