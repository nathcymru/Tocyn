import { p } from '../portalStyles';
import { ParkAlert, ParkButton, ParkEmptyState, ParkProgress } from '@luminatick/ui/park';
import { useCallback, useEffect, useState } from 'react';

type CaptureMessage = {
  id: string;
  createdAt: string;
  expiresAt: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  loginLink?: string;
};

const capturePath = '/__local/auth-capture';

export function LocalAuthCapturePage() {
  const [messages, setMessages] = useState<CaptureMessage[]>([]);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<'fetch' | 'reset' | null>(null);

  const refresh = useCallback(async () => {
    setLoaded(false);
    setFailure(null);
    setStatus('');
    try {
      const response = await fetch(`${capturePath}/messages`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Capture request failed (${response.status})`);
      const values = await response.json() as CaptureMessage[];
      setMessages(values);
      setStatus(values.length ? `${values.length} captured message${values.length === 1 ? '' : 's'}` : 'No captured messages.');
      setLoaded(true);
    } catch {
      setFailure('fetch');
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const reset = async () => {
    setFailure(null);
    setStatus('Clearing captured messages…');
    try {
      const response = await fetch(`${capturePath}/reset`, { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Capture reset failed (${response.status})`);
      await refresh();
    } catch {
      setFailure('reset');
      setStatus('');
    }
  };

  return <main className={p.localCapture}>
    <h1 className={p.localCaptureTitle}>Local authentication capture</h1>
    <p className={p.localCaptureIntro}>Synthetic messages stay in this local Worker for at most 15 minutes.</p>
    <div className={p.localCaptureActions}>
      <ParkButton type="button" onClick={() => void refresh()}>Refresh messages</ParkButton>
      <ParkButton type="button" onClick={() => void reset()}>Clear captured messages</ParkButton>
    </div>
    {status && <p className={p.localCaptureStatus} role="status" aria-live="polite">{status}</p>}
    {failure && <ParkAlert.Root role="alert" status="error" variant="surface">
      <ParkAlert.Content>
        <ParkAlert.Description>{failure === 'fetch' ? 'Capture messages are unavailable. Start the local Worker on port 8787.' : 'Captured messages could not be cleared.'}</ParkAlert.Description>
        <ParkButton type="button" onClick={() => void (failure === 'fetch' ? refresh() : reset())}>
          {failure === 'fetch' ? 'Retry loading messages' : 'Retry clearing messages'}
        </ParkButton>
      </ParkAlert.Content>
    </ParkAlert.Root>}
    <section className={p.localCaptureSection} aria-labelledby="captured-messages">
      <h2 id="captured-messages" className={p.localCaptureHeading}>Captured messages</h2>
      {!loaded ? <ParkProgress value={null} label="Loading captured messages…" /> : messages.length === 0 ? failure ? null : <ParkEmptyState title="No captured messages." description="Captured local authentication messages will appear here." headingLevel={false} className={p.localCaptureEmpty} /> : messages.map(message => <article key={message.id} className={p.localCaptureMessage}>
        <h3 className={p.localCaptureMessageTitle}>{message.subject}</h3>
        <p className={p.localCaptureMessageMeta}>To: {message.to}</p>
        {message.loginLink && <a className={p.localCaptureLink} href={message.loginLink}>Open captured login link</a>}
        <pre className={p.localCapturePayload}>{JSON.stringify(message, null, 2)}</pre>
      </article>)}
    </section>
  </main>;
}
