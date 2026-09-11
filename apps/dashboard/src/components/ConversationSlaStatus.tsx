import type { TicketSla } from '../hooks/useTicketSla';
import { SlaTargetStatus } from './SlaTargetStatus';

/** Prop-only list display: no per-row requests, timers, or private waiting facts. */
export function ConversationSlaStatus({ sla }: { sla: TicketSla | null | undefined }) {
  if (!sla) return <p className="text-sm text-slate-600">Service level unavailable</p>;
  return <div className="text-sm">
    <p>First response: <SlaTargetStatus target={sla.response}/></p>
    <p>Resolution: <SlaTargetStatus target={sla.resolution}/></p>
  </div>;
}
