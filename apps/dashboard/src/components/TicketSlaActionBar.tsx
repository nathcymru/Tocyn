import { useTicketSla } from '../hooks/useTicketSla';
import { SlaTargetStatus } from './SlaTargetStatus';

/** Uses the detail's shared query and reports both independently configured clocks. */
export function TicketSlaActionBar({ ticketId }: { ticketId: string }) {
  const { data, isError } = useTicketSla(ticketId);
  if (isError) return <span aria-label="SLA status" className="text-sm text-slate-600">Service level unavailable</span>;
  if (!data) return null;
  return <span aria-label="SLA status" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
    <span>First response: <SlaTargetStatus target={data.response}/></span>
    <span>Resolution: <SlaTargetStatus target={data.resolution}/></span>
  </span>;
}
