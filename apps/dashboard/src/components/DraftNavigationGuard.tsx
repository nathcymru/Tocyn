import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';

/** Keep SPA navigation on the current ticket until its draft has durable acknowledgement. */
export function DraftNavigationGuard({ pending, flush, failureMessage = 'Your draft is not saved. Stay on this ticket, retry saving, then navigate again.' }: {
  pending: boolean; flush: () => Promise<boolean>; failureMessage?: string;
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
  return failed ? <p role="alert">{failureMessage}</p> : null;
}
