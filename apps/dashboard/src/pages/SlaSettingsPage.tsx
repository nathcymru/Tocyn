import { DashboardSelect } from '../components/DashboardSelect';
import { Field } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import { useEffect, useState } from 'react';
import { ParkAlert, ParkButton, ParkCard, ParkEmptyState, ParkInput, ParkSkeleton, ParkTextarea } from '@luminatick/ui/park';
import { ApiError } from '../api/client';
import { useSlaPolicy, useUpdateSlaPolicy } from '../hooks/useSlaPolicy';

function minutes(value: number | null) { return value === null ? '' : String(value / 60_000); }
export function SlaSettingsPage() {
  const { data, isLoading, isFetching, error, refetch } = useSlaPolicy();
  const update = useUpdateSlaPolicy();
  const [calendarText, setCalendarText] = useState(''); const [response, setResponse] = useState(''); const [resolution, setResolution] = useState('');
  const [responseReopen, setResponseReopen] = useState<'continue'|'restart'>('continue'); const [resolutionReopen, setResolutionReopen] = useState<'continue'|'restart'>('continue'); const [message, setMessage] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!data || dirty) return;
    setCalendarText(JSON.stringify(data.calendar, null, 2));
    setResponse(minutes(data.responseTargetMs));
    setResolution(minutes(data.resolutionTargetMs));
    setResponseReopen(data.reopenPolicy.response);
    setResolutionReopen(data.reopenPolicy.resolution);
    setEditingRevision(data.revision);
  }, [data, dirty]);
  const revisionChanged = editingRevision !== null && data?.revision !== editingRevision;
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!data || editingRevision === null || revisionChanged || error) return; setMessage(null); try {
    const parseTarget = (value: string) => {
      const text = value.trim();
      if (!text) return null;
      const wholeMinutes = Number(text);
      if (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(wholeMinutes) || wholeMinutes < 1 || !Number.isSafeInteger(wholeMinutes * 60_000)) {
        throw new Error('Configured targets must be whole minutes of at least one minute.');
      }
      return wholeMinutes * 60_000;
    };
    const responseTargetMs = parseTarget(response), resolutionTargetMs = parseTarget(resolution);
    await update.mutateAsync({ expectedRevision: editingRevision, calendar: JSON.parse(calendarText), responseTargetMs, resolutionTargetMs, reopenPolicy: { response: responseReopen, resolution: resolutionReopen } });
    setDirty(false);
    setMessage('Saved. This policy applies only to clocks started after this revision.');
  } catch (cause) { setMessage(cause instanceof ApiError && cause.status === 409 ? 'This policy changed elsewhere. Reload before saving again.' : cause instanceof Error ? cause.message : 'Policy could not be saved.'); } };
  if (isLoading && !data) return <section role="status" aria-label="Loading SLA policy" aria-busy="true" className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', p: '6' })}>
    <span className={css({ srOnly: true })}>Loading SLA policy…</span>
    <ParkSkeleton aria-hidden="true" className={css({ h: '8', w: '48' })} />
    <ParkSkeleton aria-hidden="true" className={css({ h: '32', w: 'full' })} />
  </section>;
  if (!data) return <ParkEmptyState title="SLA policy could not be loaded." description="Retry loading the policy before editing it." headingLevel={false} className={css({"py":"6"})} action={<ParkButton type="button" onClick={() => void refetch()}>Retry</ParkButton>} role="alert" />;
  const pair = css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: '4' });
  return <form onSubmit={submit} className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', px: { base: '4', md: '6' }, py: '6' })} aria-label="SLA policy settings">
    <header className={css({ display: 'grid', gap: '1', mb: '2' })}>
      <h1 className={css({ m: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}>Service-level policy</h1>
      <p className={css({ color: 'fg.muted', textStyle: 'sm' })}>Revision {data.revision}. Blank targets remain unavailable; the 24/7 UTC calendar is the starting policy.</p>
    </header>
    {error && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content>
      <ParkAlert.Title>SLA policy could not be refreshed</ParkAlert.Title>
      <ParkAlert.Description>Your entered changes are still here. Retry before saving the policy.</ParkAlert.Description>
      <ParkButton type="button" variant="outline" loading={isFetching} loadingText="Retrying SLA policy…" onClick={() => void refetch()}>Retry SLA policy</ParkButton>
    </ParkAlert.Content></ParkAlert.Root>}
    {revisionChanged && !error && <ParkAlert.Root role="alert" status="warning"><ParkAlert.Content>
      <ParkAlert.Title>The SLA policy changed elsewhere</ParkAlert.Title>
      <ParkAlert.Description>Your edits are preserved. Review them before applying them to revision {data.revision}.</ParkAlert.Description>
      <ParkButton type="button" variant="outline" onClick={() => setEditingRevision(data.revision)}>Use latest revision with my edits</ParkButton>
    </ParkAlert.Content></ParkAlert.Root>}
    {message && <ParkAlert.Root role={message.startsWith('Saved.') ? 'status' : 'alert'} status={message.startsWith('Saved.') ? 'success' : 'error'}><ParkAlert.Content><ParkAlert.Description>{message}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
    <ParkCard.Root variant="outline">
      <ParkCard.Header><ParkCard.Title asChild><h2>Working calendar</h2></ParkCard.Title><ParkCard.Description>Set the calendar used by future clocks.</ParkCard.Description></ParkCard.Header>
      <ParkCard.Body><Field.Root className={css({ minW: '0' })}>
        <Field.Label htmlFor="sla-calendar-json">Calendar JSON</Field.Label>
        <ParkTextarea id="sla-calendar-json" aria-describedby="sla-calendar-help" value={calendarText} onChange={e => { setCalendarText(e.target.value); setDirty(true); }} rows={16} className={css({ w: 'full' })} />
        <Field.HelperText id="sla-calendar-help">Set the calendar used by future clocks.</Field.HelperText>
      </Field.Root></ParkCard.Body>
    </ParkCard.Root>
    <ParkCard.Root variant="outline">
      <ParkCard.Header><ParkCard.Title asChild><h2>Targets</h2></ParkCard.Title></ParkCard.Header>
      <ParkCard.Body className={pair}>
        <Field.Root className={css({ minW: '0' })}><Field.Label htmlFor="sla-response-target">Response target (minutes, optional)</Field.Label><ParkInput id="sla-response-target" aria-describedby="sla-response-help" className={css({ w: 'full' })} inputMode="numeric" value={response} onChange={e => { setResponse(e.target.value); setDirty(true); }} /><Field.HelperText id="sla-response-help">Enter whole minutes of at least one, or leave blank.</Field.HelperText></Field.Root>
        <Field.Root className={css({ minW: '0' })}><Field.Label htmlFor="sla-resolution-target">Resolution target (minutes, optional)</Field.Label><ParkInput id="sla-resolution-target" aria-describedby="sla-resolution-help" className={css({ w: 'full' })} inputMode="numeric" value={resolution} onChange={e => { setResolution(e.target.value); setDirty(true); }} /><Field.HelperText id="sla-resolution-help">Enter whole minutes of at least one, or leave blank.</Field.HelperText></Field.Root>
      </ParkCard.Body>
    </ParkCard.Root>
    <ParkCard.Root variant="outline">
      <ParkCard.Header><ParkCard.Title asChild><h2>Reopened conversations</h2></ParkCard.Title></ParkCard.Header>
      <ParkCard.Body className={pair}>
        <DashboardSelect label="Response after reopen" value={responseReopen} onValueChange={value => { setResponseReopen(value as 'continue'|'restart'); setDirty(true); }} options={[{ value: 'continue', label: 'Continue original clock' }, { value: 'restart', label: 'Restart clock' }]} />
        <DashboardSelect label="Resolution after reopen" value={resolutionReopen} onValueChange={value => { setResolutionReopen(value as 'continue'|'restart'); setDirty(true); }} options={[{ value: 'continue', label: 'Continue original clock' }, { value: 'restart', label: 'Restart clock' }]} />
      </ParkCard.Body>
    </ParkCard.Root>
    <ParkButton type="submit" disabled={Boolean(error) || revisionChanged || editingRevision === null} loading={update.isPending} loadingText="Saving SLA policy…" className={css({ justifySelf: 'start' })}>Save SLA policy</ParkButton>
  </form>;
}
