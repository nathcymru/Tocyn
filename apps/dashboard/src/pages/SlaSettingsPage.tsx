import { useEffect, useState } from 'react';
import { ParkButton, ParkEmptyState, ParkInput, ParkSelect, ParkTextarea } from '@luminatick/ui/park';
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
  if (isLoading) return <ParkEmptyState title="Loading SLA policy…" headingLevel={false} aria-busy="true" className="tocyn-sla-settings-empty tocyn-sla-settings-empty--loading" />;
  if (error || !data) return <ParkEmptyState title="SLA policy could not be loaded." description="Retry loading the policy before editing it." headingLevel={false} className="tocyn-sla-settings-empty" action={<ParkButton type="button" onClick={() => void refetch()}>Retry</ParkButton>} role="alert" />;
  return <form onSubmit={submit} className="tocyn-sla-settings-form" aria-label="SLA policy settings">
    <header className="tocyn-sla-settings-header"><h1 className="tocyn-sla-settings-title">Service-level policy</h1><p className="tocyn-sla-settings-description">Revision {data.revision}. Blank targets remain unavailable; the 24/7 UTC calendar is the starting policy.</p></header>
    {message ? <p role="status" className="tocyn-sla-settings-message">{message}</p> : null}
    <label className="tocyn-sla-settings-field">Calendar JSON<ParkTextarea value={calendarText} onChange={e => setCalendarText(e.target.value)} rows={16} className="tocyn-sla-settings-calendar"/></label>
    <div className="tocyn-sla-settings-fields"><label>Response target (minutes, optional)<ParkInput className="tocyn-form-control" inputMode="numeric" value={response} onChange={e => setResponse(e.target.value)}/></label><label>Resolution target (minutes, optional)<ParkInput className="tocyn-form-control" inputMode="numeric" value={resolution} onChange={e => setResolution(e.target.value)}/></label></div>
    <div className="tocyn-sla-settings-fields"><label>Response after reopen<ParkSelect className="tocyn-form-control" value={responseReopen} onChange={e => setResponseReopen(e.target.value as 'continue'|'restart')}><option value="continue">Continue original clock</option><option value="restart">Restart clock</option></ParkSelect></label><label>Resolution after reopen<ParkSelect className="tocyn-form-control" value={resolutionReopen} onChange={e => setResolutionReopen(e.target.value as 'continue'|'restart')}><option value="continue">Continue original clock</option><option value="restart">Restart clock</option></ParkSelect></label></div>
    <ParkButton type="submit" disabled={update.isPending} className="tocyn-sla-settings-submit">{update.isPending ? 'Saving…' : 'Save SLA policy'}</ParkButton>
  </form>;
}
