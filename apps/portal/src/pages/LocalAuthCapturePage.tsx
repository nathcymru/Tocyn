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

  return <main className="mx-auto max-w-3xl p-6">
    <h1 className="text-2xl font-bold">Local authentication capture</h1>
    <p className="mt-2 text-gray-700">Synthetic messages stay in this local Worker for at most 15 minutes.</p>
    <div className="mt-4 flex gap-3">
      <button type="button" onClick={() => void refresh()} className="rounded bg-brand-600 px-4 py-2 text-white">Refresh messages</button>
      <button type="button" onClick={() => void reset()} className="rounded border border-gray-400 px-4 py-2">Clear captured messages</button>
    </div>
    <p className="mt-3" role="status" aria-live="polite">{status}</p>
    <section className="mt-6" aria-labelledby="captured-messages">
      <h2 id="captured-messages" className="text-lg font-semibold">Captured messages</h2>
      {messages.map(message => <article key={message.id} className="mt-4 rounded border border-gray-300 p-4">
        <h3 className="font-medium">{message.subject}</h3>
        <p className="text-sm text-gray-700">To: {message.to}</p>
        {message.loginLink && <a className="mt-2 inline-block text-blue-700 underline" href={message.loginLink}>Open captured login link</a>}
        <pre className="mt-3 overflow-auto whitespace-pre-wrap text-sm">{JSON.stringify(message, null, 2)}</pre>
      </article>)}
    </section>
  </main>;
}
