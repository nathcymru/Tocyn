import { css } from '@luminatick/ui/styled-system/css';
import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';
import { ParkAlert, ParkButton, ParkCard, ParkDialog, ParkEmptyState, ParkField, ParkInput, ParkSkeleton, ParkTable } from '@luminatick/ui/park';
import React, { useEffect, useState } from 'react';
import {
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
  const revokeCancel = React.useRef<HTMLButtonElement>(null);
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
  const [hasLoadedKeys, setHasLoadedKeys] = useState(false);
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
  const revokeTitleId = React.useId();
  const revokeDescriptionId = React.useId();
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
      setKeys(data.filter(key => !revokedIds.current.has(key.id))); setHasLoadedKeys(true); setListError('');
    } catch {
      setListError('The API key list could not be loaded. Retry loading keys before relying on the list.');
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
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 ref={heading} tabIndex={-1} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.primary"})}>API Keys</h1>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Manage external access to the {PRODUCT_BRAND.name} API.</p>
        </div>
        <ParkButton
          disabled={Boolean(uncertainKey)}
          ref={createOpener} onClick={() => {
            createSucceeded.current = false; setCreateError(''); setCreatedKey(null);
            setIsCreating(true);
          }}
          variant="solid" className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
        >
          <IconPlus className={css({"w":"4","h":"4","flexShrink":0})} aria-hidden="true" />
          Create New Key
        </ParkButton>
      </div>

      <ParkDialog.Root open={isCreating} onOpenChange={({ open }) => { if (!open) closeCreate(); }}
        initialFocusEl={() => createUnresolved ? retryCreateButton.current : keyNameInput.current}
        finalFocusEl={() => uncertainHeading.current ?? (createSucceeded.current ? createdHeading.current : createOpener.current)}
        closeOnEscape={!creating} closeOnInteractOutside={false} lazyMount unmountOnExit>
        <ParkDialog.Backdrop />
        <ParkDialog.Positioner>
          <ParkDialog.Content aria-labelledby={createTitleId}>
            <ParkDialog.Header>
              <ParkDialog.Title id={createTitleId}>Create New API Key</ParkDialog.Title>
            </ParkDialog.Header>
          <form onSubmit={handleCreate} aria-labelledby={createTitleId}>
            <fieldset disabled={creating} className={css({"display":"grid","gap":"4"})}>
              <ParkDialog.Body className={css({ gap: '3' })}>
                {createError && <ParkAlert.Root role="alert" status="error" variant="surface">
                  <ParkAlert.Content><ParkAlert.Description>{createError}</ParkAlert.Description></ParkAlert.Content>
                </ParkAlert.Root>}
                <ParkField label="Key Name" className={css({ w: 'full' })}>
                  <ParkInput
                    type="text" required maxLength={120} disabled={createUnresolved} ref={keyNameInput}
                    placeholder="e.g. CRM Integration"
                    className={css({"w":"full"})}
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                </ParkField>
              </ParkDialog.Body>
              <ParkDialog.Footer>
              <ParkButton
                type="submit" ref={retryCreateButton}
                variant="solid" className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                loading={creating} loadingText="Generating key…"
              >
                {createUnresolved ? 'Retry creation' : 'Generate Key'}
              </ParkButton>
              <ParkButton
                type="button"
                onClick={closeCreate}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Cancel
              </ParkButton>
              </ParkDialog.Footer>
            </fieldset>
          </form>
          </ParkDialog.Content>
        </ParkDialog.Positioner>
      </ParkDialog.Root>

      {createdKey && (
        <div className={css({"minW":0})}>
          <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
            <IconShieldHalved className={css({"w":"4","h":"4","flexShrink":0})} aria-hidden="true" />
            <div>
              <h3 ref={createdHeading} tabIndex={-1} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.primary"})}>New API Key Generated</h3>
              <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                Copy this key now. For security reasons, it will <strong>never</strong> be shown again.
              </p>
            </div>
          </div>

          <div className={css({"minW":0})}>
            <span className={css({"overflowX":"auto","rounded":"md","bg":"bg.subtle","p":"3","fontFamily":"mono","fontSize":"sm"})}>{createdKey.apiKey}</span>
            <ParkButton
              disabled={copying} aria-label="Copy API key" onClick={() => copyToClipboard(createdKey.apiKey)}
              className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed","display":"inline-flex","alignItems":"center","gap":"2"})}
              title="Copy to clipboard"
            >
              {copied ? <IconCheck className={css({"w":"4","h":"4","flexShrink":0})} aria-hidden="true" /> : <IconCopy className={css({"w":"4","h":"4","flexShrink":0})} aria-hidden="true" />}
            </ParkButton>
          </div>

          {copyError && <ParkAlert.Root role="alert" status="error" variant="surface">
            <ParkAlert.Content><ParkAlert.Description>{copyError}</ParkAlert.Description></ParkAlert.Content>
          </ParkAlert.Root>}
          {copied && <ParkAlert.Root role="status" status="success" variant="surface"><ParkAlert.Content><ParkAlert.Description>API key copied.</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
          <ParkButton
            onClick={() => { setCreatedKey(null); createOpener.current?.focus(); }}
            className={css({"minW":0})}
          >
            I've saved my key
          </ParkButton>
        </div>
      )}

      {uncertainKey && (
        <ParkAlert.Root role="alert" status="warning" variant="surface">
          <ParkAlert.Content>
            <ParkAlert.Title asChild><h2 ref={uncertainHeading} tabIndex={-1}>API key created; plaintext unavailable</h2></ParkAlert.Title>
            <ParkAlert.Description>
              The server recorded <strong>{uncertainKey.name}</strong> with prefix <code>{uncertainKey.prefix}</code>,
              but the one-time secret cannot be shown after an uncertain response. Revoke it before creating a replacement.
            </ParkAlert.Description>
            <ParkButton onClick={event => {
              revokeOpener.current = event.currentTarget; revokeSucceeded.current = false; setRevocation(uncertainKey);
              setRevokeError(''); setRevokeOpen(true);
            }}>Revoke unavailable key</ParkButton>
          </ParkAlert.Content>
        </ParkAlert.Root>
      )}

      {listError && hasLoadedKeys && <ParkAlert.Root role="alert" status="error" variant="surface">
        <ParkAlert.Content>
          <ParkAlert.Description>The API key list could not be refreshed. Showing the last confirmed list. Retry loading keys before relying on it.</ParkAlert.Description>
          <ParkButton type="button" onClick={() => void fetchKeys()}>Retry loading keys</ParkButton>
        </ParkAlert.Content>
      </ParkAlert.Root>}
      <ParkCard.Root variant="outline" className={css({ minW: 0 })}>
        <ParkCard.Body className={keys.length > 0
          ? css({ minW: 0, overflowX: 'auto' })
          : css({ minW: 0, overflowX: 'visible' })}>
          {isLoading ? (
            <div aria-label="Loading API keys" aria-busy="true" className={css({ display: 'grid', gap: '2' })}>
              <ParkSkeleton aria-hidden="true" className={css({ h: '8', w: 'full' })} />
              <ParkSkeleton aria-hidden="true" className={css({ h: '8', w: 'full' })} />
            </div>
          ) : keys.length === 0 ? (
            <ParkEmptyState
              role={listError && !hasLoadedKeys ? 'alert' : undefined}
              title={listError && !hasLoadedKeys ? 'API key list unavailable.' : 'No API keys found.'}
              description={listError && !hasLoadedKeys ? listError : listError ? 'The last confirmed list is empty.' : 'Create a key when an integration requires external API access.'}
              headingLevel={false}
              className={css({ minW: 0 })}
              action={listError && !hasLoadedKeys ? <ParkButton type="button" onClick={() => void fetchKeys()}>Retry loading keys</ParkButton> : undefined}
            />
          ) : (
            <ParkTable.Root className={css({"w":"full","borderCollapse":"collapse"})}>
            <ParkTable.Head>
              <ParkTable.Row className={css({"borderBottomWidth":"1px","borderColor":"border.default"})}>
                <ParkTable.Header>Name</ParkTable.Header>
                <ParkTable.Header>Prefix</ParkTable.Header>
                <ParkTable.Header>Created</ParkTable.Header>
                <ParkTable.Header>Last Used</ParkTable.Header>
                <ParkTable.Header className={css({ textAlign: 'right' })}>Actions</ParkTable.Header>
              </ParkTable.Row>
            </ParkTable.Head>
            <ParkTable.Body className={css({"minW":0})}>
              {keys.map((key) => (
                <ParkTable.Row key={key.id}>
                    <ParkTable.Cell className={css({"fontWeight":"medium","color":"text.primary"})}>{key.name}</ParkTable.Cell>
                    <ParkTable.Cell className={css({"minW":0})}>{key.prefix}</ParkTable.Cell>
                    <ParkTable.Cell className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                      {new Date(key.created_at).toLocaleDateString()}
                    </ParkTable.Cell>
                    <ParkTable.Cell className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                      <div className={css({"minW":0})}>
                        <IconClock className={css({"minW":0})} aria-hidden="true" />
                        {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                      </div>
                    </ParkTable.Cell>
                    <ParkTable.Cell>
                      <ParkButton
                        aria-label={`Revoke ${key.name}`} onClick={event => { revokeOpener.current = event.currentTarget; revokeSucceeded.current = false; setRevocation(key); setRevokeError(''); setRevokeOpen(true); }}
                        className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                        title="Revoke Key"
                      >
                        <IconTrash className={css({"w":"4","h":"4","flexShrink":0})} aria-hidden="true" />
                      </ParkButton>
                    </ParkTable.Cell>
                </ParkTable.Row>
              ))}
            </ParkTable.Body>
            </ParkTable.Root>
          )}
        </ParkCard.Body>
      </ParkCard.Root>
      {revokeStatus && <ParkAlert.Root role="status" status="success" variant="surface"><ParkAlert.Content><ParkAlert.Description>{revokeStatus}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
      <ParkDialog.Root open={revokeOpen}
        onOpenChange={({ open }) => { if (!open && !revokeGuard.current) setRevokeOpen(false); }}
        initialFocusEl={() => revokeCancel.current}
        finalFocusEl={() => revokeSucceeded.current ? heading.current : revokeOpener.current}
        closeOnEscape={!revoking} closeOnInteractOutside={false} lazyMount unmountOnExit>
        <ParkDialog.Backdrop />
        <ParkDialog.Positioner>
          <ParkDialog.Content aria-labelledby={revokeTitleId} aria-describedby={revokeDescriptionId}>
            <ParkDialog.Header>
              <ParkDialog.Title id={revokeTitleId}>{`Revoke API key: ${revocation?.name ?? ''}`}</ParkDialog.Title>
              <ParkDialog.Description id={revokeDescriptionId}>Revoke this API key? This action cannot be undone.</ParkDialog.Description>
            </ParkDialog.Header>
            {revokeError && <ParkDialog.Body>
              <ParkAlert.Root role="alert" status="error" variant="surface">
                <ParkAlert.Content><ParkAlert.Description>{revokeError}</ParkAlert.Description></ParkAlert.Content>
              </ParkAlert.Root>
            </ParkDialog.Body>}
            <ParkDialog.Footer>
              <ParkButton type="button" ref={revokeCancel} variant="outline" disabled={revoking} onClick={() => { if (!revokeGuard.current) setRevokeOpen(false); }}>Cancel</ParkButton>
              <ParkButton type="button" variant="outline" colorPalette="red" disabled={revoking} onClick={handleDelete}>{revoking ? 'Revoking...' : 'Revoke key'}</ParkButton>
            </ParkDialog.Footer>
          </ParkDialog.Content>
        </ParkDialog.Positioner>
      </ParkDialog.Root>
    </div>
  );
}
