import { ParkButton, ParkEmptyState } from '@luminatick/ui/park';
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
  const [status, setStatus] = useState('Loading captured messages…');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${capturePath}/messages`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Capture request failed (${response.status})`);
      const values = await response.json() as CaptureMessage[];
      setMessages(values);
      setStatus(values.length ? `${values.length} captured message${values.length === 1 ? '' : 's'}` : 'No captured messages.');
    } catch {
      setStatus('Capture messages are unavailable. Start the local Worker on port 8787.');
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const reset = async () => {
    try {
      const response = await fetch(`${capturePath}/reset`, { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Capture reset failed (${response.status})`);
      await refresh();
    } catch {
      setStatus('Captured messages could not be cleared.');
    }
  };

  return <main className="tocyn-local-capture">
    <h1 className="tocyn-local-capture-title">Local authentication capture</h1>
    <p className="tocyn-local-capture-intro">Synthetic messages stay in this local Worker for at most 15 minutes.</p>
    <div className="tocyn-local-capture-actions">
      <ParkButton type="button" onClick={() => void refresh()} className="tocyn-local-capture-refresh">Refresh messages</ParkButton>
      <ParkButton type="button" onClick={() => void reset()} className="tocyn-local-capture-clear">Clear captured messages</ParkButton>
    </div>
    <p className="tocyn-local-capture-status" role="status" aria-live="polite">{status}</p>
    <section className="tocyn-local-capture-section" aria-labelledby="captured-messages">
      <h2 id="captured-messages" className="tocyn-local-capture-heading">Captured messages</h2>
      {messages.length === 0 ? <ParkEmptyState title="No captured messages." description="Captured local authentication messages will appear here." headingLevel={false} className="tocyn-local-capture-empty" /> : messages.map(message => <article key={message.id} className="tocyn-local-capture-message">
        <h3 className="tocyn-local-capture-message-title">{message.subject}</h3>
        <p className="tocyn-local-capture-message-meta">To: {message.to}</p>
        {message.loginLink && <a className="tocyn-local-capture-link" href={message.loginLink}>Open captured login link</a>}
        <pre className="tocyn-local-capture-payload">{JSON.stringify(message, null, 2)}</pre>
      </article>)}
    </section>
  </main>;
}
