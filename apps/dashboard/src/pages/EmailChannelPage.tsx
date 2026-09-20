import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import { TocynConfirmDialog } from '@luminatick/ui/dialog';
import { ParkAlert, ParkButton, ParkCard, ParkCheckbox, ParkEmptyState, ParkInput, ParkSkeleton } from '@luminatick/ui/park';
import { Badge } from '@luminatick/ui/components';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import { useGroups } from '../hooks/useGroups';
import {
  IconEnvelope,
  IconPlus,
  IconTrash,
  IconCheck
} from '@luminatick/ui/icons';

import {
  IconGear,
  IconFloppyDisk
} from '@luminatick/ui/icons';


interface SupportEmail {
  id: string;
  email_address: string;
  name: string | null;
  group_id: string | null;
  is_default: boolean;
  created_at: string;
}

export function EmailChannelPage() {
  const queryClient = useQueryClient();
  const heading = React.useRef<HTMLHeadingElement>(null);
  const removalOpener = React.useRef<HTMLButtonElement | null>(null);
  const removalGuard = React.useRef(false);
  const removalSucceeded = React.useRef(false);
  const [removal, setRemoval] = useState<SupportEmail | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [removeStatus, setRemoveStatus] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    email_address: '',
    name: '',
    group_id: '',
    is_default: false,
  });
  const [error, setError] = useState<string | null>(null);
  const addGuard = React.useRef(false);
  const providerGuard = React.useRef(false);
  const providerDirty = React.useRef(false);
  const addOpener = React.useRef<HTMLButtonElement>(null);
  const emailInput = React.useRef<HTMLInputElement>(null);
  const addError = React.useRef<HTMLDivElement>(null);
  const [addStatus, setAddStatus] = useState('');
  const [providerError, setProviderError] = useState('');
  React.useEffect(() => { if (isAdding) emailInput.current?.focus(); }, [isAdding]);
  React.useEffect(() => { if (error) addError.current?.focus(); }, [error]);

  const { data: groups } = useGroups();


  const [resendApiKey, setResendApiKey] = useState('');
  const [resendFromEmail, setResendFromEmail] = useState('');
  const [savingResend, setSavingResend] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const { data: settings, isLoading: settingsLoading, isError: settingsFailed, isFetching: settingsFetching, refetch: reloadSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => dashboardApi.get<Record<string, string>>('/settings'),
  });

  const settingsUnavailable = settingsFailed && settings === undefined;

  React.useEffect(() => {
    if (settings && !providerDirty.current) {
      setResendApiKey(settings.RESEND_API_KEY || '');
      setResendFromEmail(settings.RESEND_FROM_EMAIL || '');
    }
  }, [settings]);

  const saveResendSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    if (providerGuard.current || !settings || settingsFailed) return;
    providerGuard.current = true;
    setSavingResend(true);
    setResendSuccess(false);
    setProviderError('');
    try {
      const payload: Record<string, string> = { RESEND_FROM_EMAIL: resendFromEmail };
      if (resendApiKey && resendApiKey !== '••••••••') {
        payload.RESEND_API_KEY = resendApiKey;
      }
      await dashboardApi.put('/settings', payload);
      setResendSuccess(true);
      providerDirty.current = false;
      if (resendApiKey) setResendApiKey('••••••••');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    } catch {
      setProviderError('Configuration save could not be confirmed. Your changes are retained; check the connection and try again.');
    } finally {
      providerGuard.current = false;
      setSavingResend(false);
    }
  };

  const { data: emails, isLoading, isError: emailsFailed, isFetching: emailsFetching, refetch: reloadEmails } = useQuery({
    queryKey: ['support_emails'],
    queryFn: () => dashboardApi.get<SupportEmail[]>('/channels/emails'),
  });
  const emailsUnavailable = emailsFailed && emails === undefined;

  const createEmail = useMutation({
    mutationFn: (data: typeof formData) =>
      dashboardApi.post<SupportEmail>('/channels/emails', {
        ...data,
        group_id: data.group_id || null,
      }),

  });

  const deleteEmail = useMutation({
    mutationFn: (id: string) => dashboardApi.delete(`/channels/emails/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support_emails'] });
    }
  });

  const handleRemove = async () => {
    if (!removal || removalGuard.current) return;
    removalGuard.current = true; setRemoving(true); setRemoveError(''); setRemoveStatus('');
    try {
      await deleteEmail.mutateAsync(removal.id);
      removalSucceeded.current = true; setRemoveOpen(false); setRemoveStatus('Email channel removed.');
    } catch { setRemoveError('Email channel removal could not be confirmed. Try again.'); }
    finally { removalGuard.current = false; setRemoving(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addGuard.current) return;
    addGuard.current = true; setError(null); setAddStatus('');
    try {
      await createEmail.mutateAsync(formData);
      void queryClient.invalidateQueries({ queryKey: ['support_emails'] });
      setIsAdding(false);
      setFormData({ email_address: '', name: '', group_id: '', is_default: false });
      setAddStatus('Email channel saved. Provider delivery has not been verified.');
      requestAnimationFrame(() => addOpener.current?.focus());
    } catch {
      setError('Email channel creation could not be confirmed. Your entries are retained; check the channel list before retrying.');
    } finally { addGuard.current = false; }
  };

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 ref={heading} tabIndex={-1} className={css({ m: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}>Email Channels</h1>
          <p className={css({ color: 'fg.muted', textStyle: 'sm' })}>Manage inbound support email addresses</p>
        </div>
        {!isAdding && (
          <ParkButton type="button"
            ref={addOpener}
            onClick={() => { setIsAdding(true); setError(null); setAddStatus(''); }}
            className={css({"minW":0})}
          >
            <IconPlus aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
            Add Email
          </ParkButton>
        )}
      </div>


      {addStatus && <p role="status">{addStatus}</p>}
      <ParkCard.Root variant="outline">
        <ParkCard.Header><ParkCard.Title asChild><h2 className={css({ display: 'flex', alignItems: 'center', gap: '2' })}><IconGear aria-hidden="true" className={css({ w: '5', h: '5' })} /> Resend Integration</h2></ParkCard.Title>
          <ParkCard.Description>Configure your Resend API credentials for outbound emails.</ParkCard.Description></ParkCard.Header>
        <ParkCard.Body><form aria-label="Outbound email configuration" aria-busy={savingResend} onSubmit={saveResendSettings} className={css({ display: 'grid', gap: '4' })}>

        {settingsLoading && <div role="status" aria-label="Loading email configuration" aria-busy="true" className={css({ display: 'grid', gap: '2' })}><span className={css({ srOnly: true })}>Loading configuration…</span><ParkSkeleton aria-hidden="true" className={css({ h: '10', w: 'full' })} /><ParkSkeleton aria-hidden="true" className={css({ h: '10', w: 'full' })} /></div>}
        {settingsUnavailable && <ParkEmptyState role="alert" headingLevel={false} title="Configuration could not be loaded." action={<ParkButton type="button" onClick={() => { void reloadSettings(); }}>Retry configuration</ParkButton>} className={css({"minW":0})} />}
        {settingsFailed && settings !== undefined && <ParkAlert.Root role="alert" status="warning" variant="surface"><ParkAlert.Content><ParkAlert.Title>Configuration refresh failed</ParkAlert.Title><ParkAlert.Description>Last loaded settings and your edits remain available.</ParkAlert.Description><ParkButton type="button" variant="outline" disabled={settingsFetching} onClick={() => { void reloadSettings(); }}>Retry configuration</ParkButton></ParkAlert.Content></ParkAlert.Root>}
        {providerError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{providerError}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
        <div className={css({"display":"grid","gap":"4"})}>
          <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
            <label htmlFor="resend-api-key">
              Resend API Key
            </label>
            <ParkInput
              id="resend-api-key" type="password" autoComplete="off" disabled={savingResend || settingsLoading || settingsUnavailable}
              placeholder="re_xxxxxxxxxxxxxxxxx"
              value={resendApiKey}
              onChange={e => { providerDirty.current = true; setResendSuccess(false); setResendApiKey(e.target.value); }}
              className={css({"w":"full"})}
            />
            <p className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>Required to send outbound email replies.</p>
          </div>
          <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
            <label htmlFor="resend-from-email">
              Default From Email
            </label>
            <ParkInput
              id="resend-from-email" type="email" required disabled={savingResend || settingsLoading || settingsUnavailable}
              placeholder="support@yourdomain.com"
              value={resendFromEmail}
              onChange={e => { providerDirty.current = true; setResendSuccess(false); setResendFromEmail(e.target.value); }}
              className={css({"w":"full"})}
            />
            <p className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>Fallback email if a group email is not configured.</p>
          </div>
        </div>
        <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
          {resendSuccess && <span role="status" className={css({ color: 'fg.default' })}><IconCheck aria-hidden="true" className={css({ w: '4', h: '4' })} /> Configuration saved; delivery has not been verified.</span>}
          <ParkButton
            type="submit"
            disabled={settingsLoading || settingsFailed || !resendApiKey || !resendFromEmail} loading={savingResend} loadingText="Saving configuration…"
            className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
          >
            <IconFloppyDisk aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
            Save Configuration
          </ParkButton>
        </div>
      </form></ParkCard.Body></ParkCard.Root>

      {isAdding && (
        <ParkCard.Root variant="outline">
          <ParkCard.Header className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
            <ParkCard.Title asChild><h2>Add Support Email</h2></ParkCard.Title>
            <ParkButton type="button" variant="outline"
              disabled={createEmail.isPending}
              onClick={() => { setIsAdding(false); setError(null); requestAnimationFrame(() => addOpener.current?.focus()); }}
              className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
            >
              Cancel
            </ParkButton>
          </ParkCard.Header>

          {error && (
            <ParkAlert.Root role="alert" status="error" ref={addError} tabIndex={-1}><ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>
          )}

          <ParkCard.Body><form aria-label="Add support email" aria-busy={createEmail.isPending} onSubmit={handleSubmit} className={css({ display: 'grid', gap: '4' })}>
            <div className={css({"display":"grid","gap":"4"})}>
              <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                <label htmlFor="support-email-address">
                  Email Address *
                </label>
                <ParkInput
                  id="support-email-address" ref={emailInput} disabled={createEmail.isPending} type="email"
                  required
                  placeholder="support@yourdomain.com"
                  value={formData.email_address}
                  onChange={e => setFormData({ ...formData, email_address: e.target.value })}
                  className={css({"w":"full"})}
                />
              </div>
              <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                <label htmlFor="support-email-name">
                  Display Name
                </label>
                <ParkInput
                  id="support-email-name" disabled={createEmail.isPending} type="text"
                  placeholder="Support Team"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className={css({"w":"full"})}
                />
              </div>
            </div>

            <div className={css({"display":"grid","gap":"4"})}>
              <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                <label htmlFor="support-email-group">
                  Assign to Group
                </label>
                <DashboardSelect id="support-email-group" aria-label="Assign to Group" disabled={createEmail.isPending} value={formData.group_id} onValueChange={value => setFormData({ ...formData, group_id: value })} options={[{ value: '', label: '(No specific group)' }, ...(groups ?? []).map(group => ({ value: group.id, label: group.name }))]} />
                <p className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                  Tickets from this email will be automatically assigned to this group.
                </p>
              </div>
            </div>

            <div className={css({"minW":0})}>
              <ParkCheckbox.Root checked={formData.is_default} disabled={createEmail.isPending}
                onCheckedChange={({ checked }) => setFormData({ ...formData, is_default: checked === true })}>
                <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
                <ParkCheckbox.HiddenInput id="is_default" />
                <ParkCheckbox.Label>Set as default outbound email</ParkCheckbox.Label>
              </ParkCheckbox.Root>
            </div>

            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              <ParkButton
                type="submit"
                loading={createEmail.isPending} loadingText="Saving email…"
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Save Email
              </ParkButton>
            </div>
          </form></ParkCard.Body>
        </ParkCard.Root>
      )}

      <ParkCard.Root variant="outline"><ParkCard.Body>
        {emailsFailed && emails !== undefined && <ParkAlert.Root role="alert" status="warning" variant="surface"><ParkAlert.Content><ParkAlert.Title>Channel refresh failed</ParkAlert.Title><ParkAlert.Description>Last loaded email channels remain visible.</ParkAlert.Description><ParkButton type="button" variant="outline" disabled={emailsFetching} onClick={() => { void reloadEmails(); }}>Retry channels</ParkButton></ParkAlert.Content></ParkAlert.Root>}
        {isLoading ? (
          <div role="status" aria-label="Loading email channels" aria-busy="true" className={css({ display: 'grid', gap: '2' })}><span className={css({ srOnly: true })}>Loading emails...</span><ParkSkeleton aria-hidden="true" className={css({ h: '16', w: 'full' })} /><ParkSkeleton aria-hidden="true" className={css({ h: '16', w: 'full' })} /></div>
        ) : emailsUnavailable ? (
          <ParkEmptyState role="alert" title="Email channels could not be loaded." description="Retry to check the configured support addresses again." action={<ParkButton onClick={() => { void reloadEmails(); }}>Retry channels</ParkButton>} className={css({"minW":0})} />
        ) : emails?.length === 0 ? (
          <ParkEmptyState title="No email channels" description="No addresses are configured here. Receiving email also requires the separately configured inbound provider." className={css({"minW":0})} />
        ) : (
          <div className={css({"display":"grid","gap":"4"})}>
            {emails?.map((email) => (
              <div key={email.id} className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4', flexWrap: 'wrap', py: '3' })}>
                <div className={css({ display: 'flex', alignItems: 'center', gap: '3', minW: '0' })}>
                  <IconEnvelope aria-hidden="true" className={css({ w: '5', h: '5', flexShrink: 0, color: 'fg.muted' })} />
                  <div>
                    <div className={css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })}>
                      <p className={css({ m: '0', fontWeight: 'semibold', color: 'fg.default', overflowWrap: 'anywhere' })}>{email.email_address}</p>
                      {email.is_default && (
                        <Badge colorPalette="green"><IconCheck aria-hidden="true" className={css({ w: '4', h: '4' })} /> Default</Badge>
                      )}
                    </div>
                    <div className={css({ color: 'fg.muted', textStyle: 'sm', lineHeight: 'relaxed' })}>
                      {email.name && <span>{email.name}</span>}
                      {email.name && <span className={css({"minW":0})}>•</span>}
                      {email.group_id && groups ? (
                        <span>Group: {groups.find(g => g.id === email.group_id)?.name || 'Unknown'}</span>
                      ) : (
                        <span>Unassigned</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                  <ParkButton type="button" variant="outline"
                    aria-label={`Remove ${email.email_address}`} onClick={event => { removalOpener.current = event.currentTarget; removalSucceeded.current = false; setRemoval(email); setRemoveError(''); setRemoveOpen(true); }}
                    disabled={deleteEmail.isPending}
                    className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                    title="Remove email"
                  >
                    <IconTrash aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
                  </ParkButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </ParkCard.Body></ParkCard.Root>
      {removeStatus && <p role="status">{removeStatus}</p>}
      <TocynConfirmDialog open={removeOpen} busy={removing} title={`Remove email channel: ${removal?.email_address ?? ''}`}
        description="Remove this configured email channel?" confirmLabel={removing ? 'Removing...' : 'Remove channel'} error={removeError}
        onConfirm={handleRemove} onOpenChange={next => { if (!next && !removalGuard.current) setRemoveOpen(false); }}
        finalFocusEl={() => removalSucceeded.current ? heading.current : removalOpener.current} />
    </div>
  );
}
