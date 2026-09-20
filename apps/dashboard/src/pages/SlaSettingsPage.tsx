import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import { useEffect, useState } from 'react';
import { ParkButton, ParkCard, ParkEmptyState, ParkInput, ParkSkeleton, ParkTextarea } from '@luminatick/ui/park';
import { ApiError } from '../api/client';
import { useSlaPolicy, useUpdateSlaPolicy } from '../hooks/useSlaPolicy';

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
  if (isLoading) return <section role="status" aria-label="Loading SLA policy" aria-busy="true" className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', p: '6' })}>
    <span className={css({ srOnly: true })}>Loading SLA policy…</span>
    <ParkSkeleton aria-hidden="true" className={css({ h: '8', w: '48' })} />
    <ParkSkeleton aria-hidden="true" className={css({ h: '32', w: 'full' })} />
  </section>;
  if (error || !data) return <ParkEmptyState title="SLA policy could not be loaded." description="Retry loading the policy before editing it." headingLevel={false} className={css({"py":"6"})} action={<ParkButton type="button" onClick={() => void refetch()}>Retry</ParkButton>} role="alert" />;
  const field = css({ display: 'grid', minW: '0', gap: '1.5', textStyle: 'label' });
  const pair = css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: '4' });
  return <form onSubmit={submit} className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', px: { base: '4', md: '6' }, py: '6' })} aria-label="SLA policy settings">
    <header className={css({ display: 'grid', gap: '1', mb: '2' })}>
      <h1 className={css({ m: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}>Service-level policy</h1>
      <p className={css({ color: 'fg.muted', textStyle: 'sm' })}>Revision {data.revision}. Blank targets remain unavailable; the 24/7 UTC calendar is the starting policy.</p>
    </header>
    {message ? <p role={message.startsWith('Saved.') ? 'status' : 'alert'}>{message}</p> : null}
    <ParkCard.Root variant="outline">
      <ParkCard.Header><ParkCard.Title asChild><h2>Working calendar</h2></ParkCard.Title><ParkCard.Description>Set the calendar used by future clocks.</ParkCard.Description></ParkCard.Header>
      <ParkCard.Body><label className={field}>Calendar JSON<ParkTextarea value={calendarText} onChange={e => setCalendarText(e.target.value)} rows={16} className={css({ w: 'full' })} /></label></ParkCard.Body>
    </ParkCard.Root>
    <ParkCard.Root variant="outline">
      <ParkCard.Header><ParkCard.Title asChild><h2>Targets</h2></ParkCard.Title></ParkCard.Header>
      <ParkCard.Body className={pair}>
        <label className={field}>Response target (minutes, optional)<ParkInput className={css({ w: 'full' })} inputMode="numeric" value={response} onChange={e => setResponse(e.target.value)} /></label>
        <label className={field}>Resolution target (minutes, optional)<ParkInput className={css({ w: 'full' })} inputMode="numeric" value={resolution} onChange={e => setResolution(e.target.value)} /></label>
      </ParkCard.Body>
    </ParkCard.Root>
    <ParkCard.Root variant="outline">
      <ParkCard.Header><ParkCard.Title asChild><h2>Reopened conversations</h2></ParkCard.Title></ParkCard.Header>
      <ParkCard.Body className={pair}>
        <label className={field}>Response after reopen<DashboardSelect aria-label="Response after reopen" value={responseReopen} onValueChange={value => setResponseReopen(value as 'continue'|'restart')} options={[{ value: 'continue', label: 'Continue original clock' }, { value: 'restart', label: 'Restart clock' }]} /></label>
        <label className={field}>Resolution after reopen<DashboardSelect aria-label="Resolution after reopen" value={resolutionReopen} onValueChange={value => setResolutionReopen(value as 'continue'|'restart')} options={[{ value: 'continue', label: 'Continue original clock' }, { value: 'restart', label: 'Restart clock' }]} /></label>
      </ParkCard.Body>
    </ParkCard.Root>
    <ParkButton type="submit" loading={update.isPending} loadingText="Saving SLA policy…" className={css({ justifySelf: 'start' })}>Save SLA policy</ParkButton>
  </form>;
}
