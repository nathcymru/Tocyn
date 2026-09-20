import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { ParkButton } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';

const alertStyle = css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', border: '1px solid', borderColor: 'critical.border', borderRadius: 'l2', background: 'critical.surface', color: 'critical', padding: '0.75rem' });

/** Keep SPA navigation on the current ticket until its draft has durable acknowledgement. */
export function DraftNavigationGuard({ pending, flush, failureMessage = 'Your draft is not saved. Stay on this ticket, retry saving, then navigate again.', retryLabel = 'Retry saving' }: {
  pending: boolean; flush: () => Promise<boolean>; failureMessage?: string; retryLabel?: string;
}) {
  const blocker = useBlocker(pending);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
  useEffect(() => {
    if (blocker.state !== 'blocked' || failed) return;
    let current = true;
    void flushRef.current().then(saved => {
      if (!current) return;
      if (saved) blocker.proceed();
      else setFailed(true);
    }, () => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [blocker, failed]);
  return failed ? <p role="alert" className={alertStyle}><span>{failureMessage}</span>{' '}<ParkButton type="button" variant="outline" onClick={() => { void flushRef.current().then(saved => { if (saved && blocker.state === 'blocked') blocker.proceed(); else setFailed(true); }, () => setFailed(true)); }}>{retryLabel}</ParkButton></p> : null;
}
