import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';
import { TocynConfirmDialog, TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkEmptyState, ParkInput } from '@luminatick/ui/park';
import React, { useEffect, useState } from 'react';
import {
  IconKey,
  IconPlus,
  IconTrash,
  IconCopy,
  IconCheck,
  IconShieldHalved,
  IconClock
} from '@luminatick/ui/icons';
import { dashboardApi } from '../api/client';
import { ApiKey, ApiKeyCreatedResponse } from '@luminatick/shared';

export function ApiKeyPage() {
  const heading = React.useRef<HTMLHeadingElement>(null);
  const revokeOpener = React.useRef<HTMLButtonElement | null>(null);
  const revokeGuard = React.useRef(false);
  const revokedIds = React.useRef(new Set<string>());
  const revokeSucceeded = React.useRef(false);
  const [revocation, setRevocation] = useState<ApiKey | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  const [revokeStatus, setRevokeStatus] = useState('');
  const [listError, setListError] = useState('');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const createOpener = React.useRef<HTMLButtonElement>(null);
  const keyNameInput = React.useRef<HTMLInputElement>(null);
  const createdHeading = React.useRef<HTMLHeadingElement>(null);
  const uncertainHeading = React.useRef<HTMLHeadingElement>(null);
  const retryCreateButton = React.useRef<HTMLButtonElement>(null);
  const createGuard = React.useRef(false);
  const createSucceeded = React.useRef(false);
  const createIntent = React.useRef<{ name: string; key: string } | null>(null);
  const createTitleId = React.useId();
  const [creating, setCreating] = useState(false);
  const [createUnresolved, setCreateUnresolved] = useState(false);
  const [createError, setCreateError] = useState('');
  const copyGuard = React.useRef(false);
  const copyGeneration = React.useRef(0);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<ApiKeyCreatedResponse | null>(null);
  const [uncertainKey, setUncertainKey] = useState<ApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const closeCreate = () => { if (!createGuard.current) setIsCreating(false); };
  useEffect(() => {
    copyGeneration.current++; copyGuard.current = false; setCopying(false); setCopied(false); setCopyError('');
    return () => { copyGeneration.current++; if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, [createdKey?.id]);
  useEffect(() => {
    if (uncertainKey) uncertainHeading.current?.focus();
  }, [uncertainKey]);

  const fetchKeys = async () => {
    try {
      const data = await dashboardApi.get<ApiKey[]>('/api-keys');
      setKeys(data.filter(key => !revokedIds.current.has(key.id))); setListError('');
    } catch {
      setListError('The API key list could not be refreshed. Reload this page before relying on the list.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName || createGuard.current) return;
    createGuard.current = true; setCreating(true); setCreateError('');
    const intent = createIntent.current?.name === newKeyName
      ? createIntent.current : { name: newKeyName, key: crypto.randomUUID() };
    createIntent.current = intent;
    try {
      const result = await dashboardApi.post<ApiKeyCreatedResponse>('/api-keys', { name: newKeyName },
        { headers: { 'Idempotency-Key': intent.key } });
      createIntent.current = null;
      setCreateUnresolved(false);
      createSucceeded.current = true; setCreatedKey(result);
      setNewKeyName('');
      setIsCreating(false);
      fetchKeys();
    } catch (error) {
      const body = error && typeof error === 'object' && 'body' in error ? (error as { body?: unknown }).body : null;
      const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : null;
      const key = body && typeof body === 'object' && 'key' in body ? (body as { key?: unknown }).key : null;
      if (code === 'api_key_plaintext_unavailable' && key && typeof key === 'object'
        && typeof (key as any).id === 'string' && typeof (key as any).name === 'string'
        && typeof (key as any).prefix === 'string' && typeof (key as any).created_at === 'string') {
        setUncertainKey({ ...(key as ApiKey), is_active: true });
        setCreateUnresolved(false);
        setIsCreating(false);
      } else {
        setCreateUnresolved(true);
        setCreateError('API key creation could not be confirmed. Retry this unchanged attempt to learn whether it was created.');
      }
      fetchKeys();
    } finally { createGuard.current = false; setCreating(false); }
  };

  const handleDelete = async () => {
    if (!revocation || revokeGuard.current) return;
    revokeGuard.current = true; setRevoking(true); setRevokeError(''); setRevokeStatus('');
    try {
      await dashboardApi.delete(`/api-keys/${revocation.id}`);
      // Ignore stale list responses for a revocation already acknowledged in this view.
      revokedIds.current.add(revocation.id);
      setKeys(current => current.filter(key => key.id !== revocation.id));
      setCreatedKey(current => current?.id === revocation.id ? null : current);
      if (uncertainKey?.id === revocation.id) { setUncertainKey(null); createIntent.current = null; setCreateUnresolved(false); }
      revokeSucceeded.current = true; setRevokeOpen(false); setRevokeStatus('API key revoked.');
    } catch { setRevokeError('API key revocation could not be confirmed. Try again.'); }
    finally { revokeGuard.current = false; setRevoking(false); }
  };

  const copyToClipboard = async (text: string) => {
    if (copyGuard.current) return;
    const generation = copyGeneration.current;
    copyGuard.current = true; setCopying(true); setCopied(false); setCopyError('');
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(text);
      if (generation === copyGeneration.current) {
        setCopied(true); copyTimer.current = setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      if (generation === copyGeneration.current) setCopyError('The key could not be copied. Select and copy it manually, or try again.');
    } finally {
      if (generation === copyGeneration.current) { copyGuard.current = false; setCopying(false); }
    }
  };

  return (
    <div className="tocyn-api-key-page">
      <div className="tocyn-api-key-header">
        <div>
          <h1 ref={heading} tabIndex={-1} className="tocyn-api-key-title">API Keys</h1>
          <p className="tocyn-api-key-description">Manage external access to the {PRODUCT_BRAND.name} API.</p>
        </div>
        <ParkButton
          disabled={Boolean(uncertainKey)}
          ref={createOpener} onClick={() => {
            createSucceeded.current = false; setCreateError(''); setCreatedKey(null);
            setIsCreating(true);
          }}
          className="tocyn-api-key-create-button"
        >
          <IconPlus className="tocyn-api-key-create-icon" />
          Create New Key
        </ParkButton>
      </div>

      <TocynDialog open={isCreating} busy={creating} labelledBy={createTitleId} initialFocusEl={() => createUnresolved ? retryCreateButton.current : keyNameInput.current}
        finalFocusEl={() => uncertainHeading.current ?? (createSucceeded.current ? createdHeading.current : createOpener.current)} onOpenChange={next => { if (!next) closeCreate(); }}>
        <div className="tocyn-api-key-create-card">
          <h2 id={createTitleId} className="tocyn-api-key-create-title">Create New API Key</h2>
          <form onSubmit={handleCreate} aria-labelledby={createTitleId}>
            {createError && <p role="alert" className="tocyn-api-key-create-error">{createError}</p>}
            <fieldset disabled={creating} className="tocyn-api-key-create-fields">
            <div className="tocyn-form-field">
              <label htmlFor={`${createTitleId}-name`} className="tocyn-api-key-create-label">
                Key Name
              </label>
              <ParkInput
                type="text" required maxLength={120} disabled={createUnresolved} id={`${createTitleId}-name`} ref={keyNameInput}
                placeholder="e.g. CRM Integration"
                className="tocyn-form-control"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="tocyn-api-key-create-actions">
              <ParkButton
                type="submit" ref={retryCreateButton}
                className="tocyn-api-key-create-submit"
              >
                {creating ? 'Generating...' : createUnresolved ? 'Retry creation' : 'Generate Key'}
              </ParkButton>
              <ParkButton
                type="button"
                onClick={closeCreate}
                className="tocyn-api-key-create-cancel"
              >
                Cancel
              </ParkButton>
            </div>
            </fieldset>
          </form>
        </div>
      </TocynDialog>

      {createdKey && (
        <div className="tocyn-api-key-created">
          <div className="tocyn-api-key-created-header">
            <IconShieldHalved className="tocyn-api-key-created-icon" />
            <div>
              <h3 ref={createdHeading} tabIndex={-1} className="tocyn-api-key-created-title">New API Key Generated</h3>
              <p className="tocyn-api-key-created-help">
                Copy this key now. For security reasons, it will <strong>never</strong> be shown again.
              </p>
            </div>
          </div>

          <div className="tocyn-api-key-created-value">
            <span className="tocyn-api-key-created-token">{createdKey.apiKey}</span>
            <ParkButton
              disabled={copying} aria-label="Copy API key" onClick={() => copyToClipboard(createdKey.apiKey)}
              className="tocyn-api-key-copy"
              title="Copy to clipboard"
            >
              {copied ? <IconCheck className="tocyn-api-key-copy-icon" /> : <IconCopy className="tocyn-api-key-copy-icon" />}
            </ParkButton>
          </div>

          {copyError && <p role="alert">{copyError}</p>}
          {copied && <p role="status">API key copied.</p>}
          <ParkButton
            onClick={() => { setCreatedKey(null); createOpener.current?.focus(); }}
            className="tocyn-api-key-created-dismiss"
          >
            I've saved my key
          </ParkButton>
        </div>
      )}

      {uncertainKey && (
        <div className="tocyn-api-key-uncertain" role="alert">
          <h2 ref={uncertainHeading} tabIndex={-1} className="tocyn-api-key-uncertain-title">API key created; plaintext unavailable</h2>
          <p className="tocyn-api-key-uncertain-copy">
            The server recorded <strong>{uncertainKey.name}</strong> with prefix <code>{uncertainKey.prefix}</code>,
            but the one-time secret cannot be shown after an uncertain response. Revoke it before creating a replacement.
          </p>
          <ParkButton className="tocyn-api-key-uncertain-revoke" onClick={event => {
            revokeOpener.current = event.currentTarget; revokeSucceeded.current = false; setRevocation(uncertainKey);
            setRevokeError(''); setRevokeOpen(true);
          }}>Revoke unavailable key</ParkButton>
        </div>
      )}

      {listError && <p role="alert">{listError}</p>}
      <div className="tocyn-api-key-table-shell">
        <div className="tocyn-api-key-table-scroll">
          <table className="tocyn-api-key-table">
            <thead>
              <tr className="tocyn-api-key-table-head">
                <th>Name</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Last Used</th>
                <th className="tocyn-api-key-table-actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody className="tocyn-api-key-table-body">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="tocyn-api-key-empty-cell">
                    <ParkEmptyState
                      title="Loading keys..."
                      headingLevel={false}
                      aria-busy="true"
                      className="tocyn-api-key-empty-state"
                    />
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={5} className="tocyn-api-key-empty-cell">
                    <ParkEmptyState
                      title={listError ? 'API key list unavailable.' : 'No API keys found.'}
                      description={listError ? 'Reload this page before relying on the list.' : 'Create a key when an integration requires external API access.'}
                      headingLevel={false}
                      className="tocyn-api-key-empty-state"
                    />
                  </td>
                </tr>
              ) : (
                keys.map((key) => (
                  <tr key={key.id} className="tocyn-api-key-table-row">
                    <td className="tocyn-api-key-name">{key.name}</td>
                    <td className="tocyn-api-key-prefix">{key.prefix}</td>
                    <td className="tocyn-api-key-date">
                      {new Date(key.created_at).toLocaleDateString()}
                    </td>
                    <td className="tocyn-api-key-date">
                      <div className="tocyn-api-key-last-used">
                        <IconClock className="tocyn-api-key-clock" />
                        {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                      </div>
                    </td>
                    <td className="tocyn-api-key-actions">
                      <ParkButton
                        aria-label={`Revoke ${key.name}`} onClick={event => { revokeOpener.current = event.currentTarget; revokeSucceeded.current = false; setRevocation(key); setRevokeError(''); setRevokeOpen(true); }}
                        className="tocyn-api-key-revoke"
                        title="Revoke Key"
                      >
                        <IconTrash className="tocyn-api-key-revoke-icon" />
                      </ParkButton>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {revokeStatus && <p role="status">{revokeStatus}</p>}
      <TocynConfirmDialog open={revokeOpen} busy={revoking} title={`Revoke API key: ${revocation?.name ?? ''}`}
        description="Revoke this API key? This action cannot be undone." confirmLabel={revoking ? 'Revoking...' : 'Revoke key'} error={revokeError}
        onConfirm={handleDelete} onOpenChange={next => { if (!next && !revokeGuard.current) setRevokeOpen(false); }}
        finalFocusEl={() => revokeSucceeded.current ? heading.current : revokeOpener.current} />
    </div>
  );
}
