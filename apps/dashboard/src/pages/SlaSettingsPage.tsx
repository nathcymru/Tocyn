import { useEffect, useState } from 'react';
import { TocynButton, TocynInput, TocynSelect, TocynTextarea } from '@luminatick/ui/primitives';
import { ApiError } from '../api/client';
import { useSlaPolicy, useUpdateSlaPolicy, type SlaPolicy } from '../hooks/useSlaPolicy';

function minutes(value: number | null) { return value === null ? '' : String(value / 60_000); }
export function SlaSettingsPage() {
  const { data, isLoading, error, refetch } = useSlaPolicy();
  const update = useUpdateSlaPolicy();
  const [calendarText, setCalendarText] = useState(''); const [response, setResponse] = useState(''); const [resolution, setResolution] = useState('');
  const [responseReopen, setResponseReopen] = useState<'continue'|'restart'>('continue'); const [resolutionReopen, setResolutionReopen] = useState<'continue'|'restart'>('continue'); const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (!data) return; setCalendarText(JSON.stringify(data.calendar, null, 2)); setResponse(minutes(data.responseTargetMs)); setResolution(minutes(data.resolutionTargetMs)); setResponseReopen(data.reopenPolicy.response); setResolutionReopen(data.reopenPolicy.resolution); }, [data]);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!data) return; setMessage(null); try {
    const parseTarget = (value: string) => value.trim() ? Number(value) * 60_000 : null;
    const responseTargetMs = parseTarget(response), resolutionTargetMs = parseTarget(resolution);
    if ((responseTargetMs !== null && (!Number.isSafeInteger(responseTargetMs) || responseTargetMs < 60_000)) || (resolutionTargetMs !== null && (!Number.isSafeInteger(resolutionTargetMs) || resolutionTargetMs < 60_000))) throw new Error('Configured targets must be whole minutes of at least one minute.');
    await update.mutateAsync({ expectedRevision: data.revision, calendar: JSON.parse(calendarText), responseTargetMs, resolutionTargetMs, reopenPolicy: { response: responseReopen, resolution: resolutionReopen } });
    setMessage('Saved. This policy applies only to clocks started after this revision.');
  } catch (cause) { setMessage(cause instanceof ApiError && cause.status === 409 ? 'This policy changed elsewhere. Reload before saving again.' : cause instanceof Error ? cause.message : 'Policy could not be saved.'); } };
  if (isLoading) return <p className="p-6" role="status">Loading SLA policy…</p>;
  if (error || !data) return <div className="p-6" role="alert">SLA policy could not be loaded. <TocynButton type="button" onClick={() => void refetch()}>Retry</TocynButton></div>;
  return <form onSubmit={submit} className="max-w-3xl space-y-6 p-6" aria-label="SLA policy settings">
    <header><h1 className="text-2xl font-bold">Service-level policy</h1><p className="mt-1 text-slate-600">Revision {data.revision}. Blank targets remain unavailable; the 24/7 UTC calendar is the starting policy.</p></header>
    {message ? <p role="status" className="rounded border p-3">{message}</p> : null}
    <label className="block text-sm font-medium">Calendar JSON<TocynTextarea value={calendarText} onChange={e => setCalendarText(e.target.value)} rows={16} className="mt-1 w-full font-mono text-xs"/></label>
    <div className="grid gap-4 sm:grid-cols-2"><label>Response target (minutes, optional)<TocynInput inputMode="numeric" value={response} onChange={e => setResponse(e.target.value)}/></label><label>Resolution target (minutes, optional)<TocynInput inputMode="numeric" value={resolution} onChange={e => setResolution(e.target.value)}/></label></div>
    <div className="grid gap-4 sm:grid-cols-2"><label>Response after reopen<TocynSelect value={responseReopen} onChange={e => setResponseReopen(e.target.value as 'continue'|'restart')}><option value="continue">Continue original clock</option><option value="restart">Restart clock</option></TocynSelect></label><label>Resolution after reopen<TocynSelect value={resolutionReopen} onChange={e => setResolutionReopen(e.target.value as 'continue'|'restart')}><option value="continue">Continue original clock</option><option value="restart">Restart clock</option></TocynSelect></label></div>
    <TocynButton type="submit" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save SLA policy'}</TocynButton>
  </form>;
}
