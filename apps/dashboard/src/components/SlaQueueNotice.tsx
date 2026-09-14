import { ParkButton } from '@luminatick/ui/park';
import { ApiError } from '../api/client';

export function SlaQueueNotice({ asOf, error, busy, restart }: {
  asOf?: string; error: Error | null; busy: boolean; restart: () => void;
}) {
  const changed = error instanceof ApiError && error.code === 'sla_sort_restart';
  return <section aria-label="SLA ordering" className="tocyn-sla-queue-notice">
    <p role="status">{changed ? 'This SLA queue changed or expired. Restart ordering to continue.'
      : error ? 'SLA ordering is unavailable. No partial order is shown.'
      : asOf ? <>SLA order calculated at <time dateTime={asOf}>{new Date(asOf).toLocaleTimeString()}</time>. Refresh to update deadlines and queue order.</>
      : 'Calculating SLA order for the whole view…'}</p>
    <ParkButton type="button" disabled={busy} onClick={restart} className="tocyn-sla-queue-action">
      {changed ? 'Restart SLA ordering' : 'Refresh SLA ordering'}
    </ParkButton>
  </section>;
}
