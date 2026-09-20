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
    if (blocker.state !== 'blocked') return;
    let current = true;
    setFailed(false);
    void flushRef.current().then(saved => {
      if (!current) return;
      if (saved) blocker.proceed();
      else { setFailed(true); blocker.reset(); }
    }, () => {
      if (current) { setFailed(true); blocker.reset(); }
    });
    return () => { current = false; };
  }, [blocker]);
  return failed ? <p role="alert" className={alertStyle}><span>{failureMessage}</span>{' '}<ParkButton type="button" variant="outline" onClick={() => { setFailed(false); void flushRef.current().then(saved => { if (!saved) setFailed(true); }, () => setFailed(true)); }}>{retryLabel}</ParkButton></p> : null;
}
