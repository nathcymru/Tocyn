import { TocynConfirmDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkInput, ParkSelect } from '@luminatick/ui/park';
import { ParkEmptyState } from '@luminatick/ui/park';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import { useGroups } from '../hooks/useGroups';
import {
  FaEnvelope,
  FaPlus,
  FaTrash,
  FaCheck,
  FaCircleExclamation
} from 'react-icons/fa6';
import { clsx } from 'clsx';

import {
  FaGear,
  FaFloppyDisk
} from 'react-icons/fa6';


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

  const { data: settings, isLoading: settingsLoading, isError: settingsFailed, refetch: reloadSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => dashboardApi.get<Record<string, string>>('/settings'),
  });

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

  const { data: emails, isLoading, isError: emailsFailed, refetch: reloadEmails } = useQuery({
    queryKey: ['support_emails'],
    queryFn: () => dashboardApi.get<SupportEmail[]>('/channels/emails'),
  });

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
    <div className="tocyn-email-channel-page">
      <div className="tocyn-email-channel-header">
        <div>
          <h1 ref={heading} tabIndex={-1} className="tocyn-email-channel-title">Email Channels</h1>
          <p className="tocyn-email-channel-description">Manage inbound support email addresses</p>
        </div>
        {!isAdding && (
          <ParkButton
            ref={addOpener}
            onClick={() => { setIsAdding(true); setError(null); setAddStatus(''); }}
            className="tocyn-email-channel-add"
          >
            <FaPlus className="tocyn-email-channel-add-icon" />
            Add Email
          </ParkButton>
        )}
      </div>


      {addStatus && <p role="status">{addStatus}</p>}
      <form aria-label="Outbound email configuration" aria-busy={savingResend} onSubmit={saveResendSettings} className="tocyn-email-channel-config">
        <div className="tocyn-email-channel-config-header">
          <div className="tocyn-email-channel-config-icon">
            <FaGear className="tocyn-email-channel-config-icon-glyph" />
          </div>
          <div>
            <h2 className="tocyn-email-channel-config-title">Resend Integration</h2>
            <p className="tocyn-email-channel-config-description">Configure your Resend API credentials for outbound emails.</p>
          </div>
        </div>

        {settingsLoading && <p role="status">Loading configuration…</p>}
        {settingsFailed && <div role="alert">Configuration could not be loaded. <ParkButton type="button" onClick={() => { void reloadSettings(); }}>Retry configuration</ParkButton></div>}
        {providerError && <p role="alert">{providerError}</p>}
        <div className="tocyn-email-channel-config-fields">
          <div className="tocyn-form-field">
            <label htmlFor="resend-api-key">
              Resend API Key
            </label>
            <ParkInput
              id="resend-api-key" type="password" autoComplete="off" disabled={savingResend || settingsLoading || settingsFailed}
              placeholder="re_xxxxxxxxxxxxxxxxx"
              value={resendApiKey}
              onChange={e => { providerDirty.current = true; setResendSuccess(false); setResendApiKey(e.target.value); }}
              className="tocyn-form-control tocyn-email-channel-config-input"
            />
            <p className="tocyn-email-channel-config-help">Required to send outbound email replies.</p>
          </div>
          <div className="tocyn-form-field">
            <label htmlFor="resend-from-email">
              Default From Email
            </label>
            <ParkInput
              id="resend-from-email" type="email" required disabled={savingResend || settingsLoading || settingsFailed}
              placeholder="support@yourdomain.com"
              value={resendFromEmail}
              onChange={e => { providerDirty.current = true; setResendSuccess(false); setResendFromEmail(e.target.value); }}
              className="tocyn-form-control tocyn-email-channel-config-input"
            />
            <p className="tocyn-email-channel-config-help">Fallback email if a group email is not configured.</p>
          </div>
        </div>
        <div className="tocyn-email-channel-config-actions">
          {resendSuccess && <span role="status" className="tocyn-email-channel-config-success"><FaCheck className="tocyn-email-channel-config-success-icon"/> Configuration saved; delivery has not been verified.</span>}
          <ParkButton
            type="submit"
            disabled={savingResend || settingsLoading || settingsFailed || !resendApiKey || !resendFromEmail}
            className="tocyn-email-channel-config-save"
          >
            <FaFloppyDisk className="tocyn-email-channel-config-save-icon" />
            {savingResend ? 'Saving...' : 'Save Configuration'}
          </ParkButton>
        </div>
      </form>

      {isAdding && (
        <div className="tocyn-email-channel-add-card">
          <div className="tocyn-email-channel-add-header">
            <h2 className="tocyn-email-channel-add-title">Add Support Email</h2>
            <ParkButton
              disabled={createEmail.isPending}
              onClick={() => { setIsAdding(false); setError(null); requestAnimationFrame(() => addOpener.current?.focus()); }}
              className="tocyn-email-channel-add-close"
            >
              Cancel
            </ParkButton>
          </div>

          {error && (
            <div role="alert" ref={addError} tabIndex={-1} className="tocyn-email-channel-add-error">
              <FaCircleExclamation className="tocyn-email-channel-add-error-icon" />
              {error}
            </div>
          )}

          <form aria-label="Add support email" aria-busy={createEmail.isPending} onSubmit={handleSubmit} className="tocyn-email-channel-add-form">
            <div className="tocyn-email-channel-add-fields">
              <div className="tocyn-form-field">
                <label htmlFor="support-email-address">
                  Email Address *
                </label>
                <ParkInput
                  id="support-email-address" ref={emailInput} disabled={createEmail.isPending} type="email"
                  required
                  placeholder="support@yourdomain.com"
                  value={formData.email_address}
                  onChange={e => setFormData({ ...formData, email_address: e.target.value })}
                  className="tocyn-form-control"
                />
              </div>
              <div className="tocyn-form-field">
                <label htmlFor="support-email-name">
                  Display Name
                </label>
                <ParkInput
                  id="support-email-name" disabled={createEmail.isPending} type="text"
                  placeholder="Support Team"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="tocyn-form-control"
                />
              </div>
            </div>

            <div className="tocyn-email-channel-add-fields">
              <div className="tocyn-form-field">
                <label htmlFor="support-email-group">
                  Assign to Group
                </label>
                <ParkSelect id="support-email-group" disabled={createEmail.isPending}
                  value={formData.group_id}
                  onChange={e => setFormData({ ...formData, group_id: e.target.value })}
                  className="tocyn-form-control"
                >
                  <option value="">(No specific group)</option>
                  {groups?.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </ParkSelect>
                <p className="tocyn-email-channel-add-help">
                  Tickets from this email will be automatically assigned to this group.
                </p>
              </div>
            </div>

            <div className="tocyn-email-channel-add-default">
              <ParkInput
                type="checkbox"
                id="is_default" disabled={createEmail.isPending}
                checked={formData.is_default}
                onChange={e => setFormData({ ...formData, is_default: e.target.checked })}
                className="tocyn-email-channel-add-checkbox"
              />
              <label htmlFor="is_default" className="tocyn-email-channel-add-label">
                Set as default outbound email
              </label>
            </div>

            <div className="tocyn-email-channel-add-actions">
              <ParkButton
                type="submit"
                disabled={createEmail.isPending}
                className="tocyn-email-channel-add-submit"
              >
                {createEmail.isPending ? 'Saving...' : 'Save Email'}
              </ParkButton>
            </div>
          </form>
        </div>
      )}

      <div className="tocyn-email-channel-list-shell">
        {isLoading ? (
          <ParkEmptyState role="status" title="Loading emails..." description="Configured support addresses are loading." className="tocyn-email-channel-state" />
        ) : emailsFailed ? (
          <ParkEmptyState role="alert" title="Email channels could not be loaded." description="Retry to check the configured support addresses again." action={<ParkButton onClick={() => { void reloadEmails(); }}>Retry channels</ParkButton>} className="tocyn-email-channel-state" />
        ) : emails?.length === 0 ? (
          <ParkEmptyState title="No email channels" description="No addresses are configured here. Receiving email also requires the separately configured inbound provider." className="tocyn-email-channel-state" />
        ) : (
          <div className="tocyn-email-channel-list">
            {emails?.map((email) => (
              <div key={email.id} className="tocyn-email-channel-row">
                <div className="tocyn-email-channel-identity">
                  <div className="tocyn-email-channel-row-icon">
                    <FaEnvelope className="tocyn-email-channel-row-icon-glyph" />
                  </div>
                  <div>
                    <div className="tocyn-email-channel-row-heading">
                      <p className="tocyn-email-channel-row-address">{email.email_address}</p>
                      {email.is_default && (
                        <span className="tocyn-email-channel-default-badge">
                          <FaCheck className="tocyn-email-channel-default-icon" /> Default
                        </span>
                      )}
                    </div>
                    <div className="tocyn-email-channel-row-meta">
                      {email.name && <span>{email.name}</span>}
                      {email.name && <span className="tocyn-email-channel-row-separator">•</span>}
                      {email.group_id && groups ? (
                        <span>Group: {groups.find(g => g.id === email.group_id)?.name || 'Unknown'}</span>
                      ) : (
                        <span>Unassigned</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="tocyn-email-channel-row-actions">
                  <ParkButton
                    aria-label={`Remove ${email.email_address}`} onClick={event => { removalOpener.current = event.currentTarget; removalSucceeded.current = false; setRemoval(email); setRemoveError(''); setRemoveOpen(true); }}
                    disabled={deleteEmail.isPending}
                    className="tocyn-email-channel-row-delete"
                    title="Remove email"
                  >
                    <FaTrash className="tocyn-email-channel-row-delete-icon" />
                  </ParkButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {removeStatus && <p role="status">{removeStatus}</p>}
      <TocynConfirmDialog open={removeOpen} busy={removing} title={`Remove email channel: ${removal?.email_address ?? ''}`}
        description="Remove this configured email channel?" confirmLabel={removing ? 'Removing...' : 'Remove channel'} error={removeError}
        onConfirm={handleRemove} onOpenChange={next => { if (!next && !removalGuard.current) setRemoveOpen(false); }}
        finalFocusEl={() => removalSucceeded.current ? heading.current : removalOpener.current} />
    </div>
  );
}
