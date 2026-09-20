import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import { useEffect, useState } from 'react';
import { ParkButton, ParkEmptyState, ParkInput, ParkTextarea } from '@luminatick/ui/park';
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
  if (isLoading) return <ParkEmptyState title="Loading SLA policy…" headingLevel={false} aria-busy="true" className={css({"py":"6"})} />;
  if (error || !data) return <ParkEmptyState title="SLA policy could not be loaded." description="Retry loading the policy before editing it." headingLevel={false} className={css({"py":"6"})} action={<ParkButton type="button" onClick={() => void refetch()}>Retry</ParkButton>} role="alert" />;
  return <form onSubmit={submit} className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})} aria-label="SLA policy settings">
    <header className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}><h1 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Service-level policy</h1><p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Revision {data.revision}. Blank targets remain unavailable; the 24/7 UTC calendar is the starting policy.</p></header>
    {message ? <p role="status" className={css({"minW":0})}>{message}</p> : null}
    <label className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>Calendar JSON<ParkTextarea value={calendarText} onChange={e => setCalendarText(e.target.value)} rows={16} className={css({"w":"full"})}/></label>
    <div className={css({"display":"grid","gap":"4","gridTemplateColumns":{"base":"1fr","md":"repeat(2,minmax(0,1fr))"}})}><label>Response target (minutes, optional)<ParkInput className={css({"w":"full"})} inputMode="numeric" value={response} onChange={e => setResponse(e.target.value)}/></label><label>Resolution target (minutes, optional)<ParkInput className={css({"w":"full"})} inputMode="numeric" value={resolution} onChange={e => setResolution(e.target.value)}/></label></div>
    <div className={css({"display":"grid","gap":"4","gridTemplateColumns":{"base":"1fr","md":"repeat(2,minmax(0,1fr))"}})}><label>Response after reopen<DashboardSelect aria-label="Response after reopen" value={responseReopen} onValueChange={value => setResponseReopen(value as 'continue'|'restart')} options={[{ value: 'continue', label: 'Continue original clock' }, { value: 'restart', label: 'Restart clock' }]} /></label><label>Resolution after reopen<DashboardSelect aria-label="Resolution after reopen" value={resolutionReopen} onValueChange={value => setResolutionReopen(value as 'continue'|'restart')} options={[{ value: 'continue', label: 'Continue original clock' }, { value: 'restart', label: 'Restart clock' }]} /></label></div>
    <ParkButton type="submit" disabled={update.isPending} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>{update.isPending ? 'Saving…' : 'Save SLA policy'}</ParkButton>
  </form>;
}
