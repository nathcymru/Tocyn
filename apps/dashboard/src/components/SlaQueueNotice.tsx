import { ParkButton } from '@luminatick/ui/park';
import { ApiError } from '../api/client';
import { css } from '@luminatick/ui/styled-system/css';

const notice = css({ display: 'grid', gap: '0.5rem', margin: '1rem', padding: '0.75rem', border: '1px solid', borderColor: 'border.input', borderRadius: 'l2', background: 'bg.surface' });
const action = css({ justifySelf: 'start' });

export function SlaQueueNotice({ asOf, error, busy, restart }: {
  asOf?: string; error: Error | null; busy: boolean; restart: () => void;
}) {
  const changed = error instanceof ApiError && error.code === 'sla_sort_restart';
  return <section aria-label="SLA ordering" className={notice}>
    <p role="status">{changed ? 'This SLA queue changed or expired. Restart ordering to continue.'
      : error ? 'SLA ordering is unavailable. No partial order is shown.'
      : asOf ? <>SLA order calculated at <time dateTime={asOf}>{new Date(asOf).toLocaleTimeString()}</time>. Refresh to update deadlines and queue order.</>
      : 'Calculating SLA order for the whole view…'}</p>
    <ParkButton type="button" variant="outline" disabled={busy} onClick={restart} className={action}>
      {changed ? 'Restart SLA ordering' : 'Refresh SLA ordering'}
    </ParkButton>
  </section>;
}
