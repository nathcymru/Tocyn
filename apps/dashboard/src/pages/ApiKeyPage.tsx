import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';
import { TocynConfirmDialog, TocynDialog } from '@luminatick/ui/dialog';
import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import React, { useEffect, useState } from 'react';
import { Key, Plus, Trash2, Copy, Check, ShieldAlert, Clock } from 'lucide-react';
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
  const createGuard = React.useRef(false);
  const createSucceeded = React.useRef(false);
  const createTitleId = React.useId();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const copyGuard = React.useRef(false);
  const copyGeneration = React.useRef(0);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<ApiKeyCreatedResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const closeCreate = () => { if (!createGuard.current) setIsCreating(false); };
  useEffect(() => {
    copyGeneration.current++; copyGuard.current = false; setCopying(false); setCopied(false); setCopyError('');
    return () => { copyGeneration.current++; if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, [createdKey?.id]);

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
    try {
      const result = await dashboardApi.post<ApiKeyCreatedResponse>('/api-keys', { name: newKeyName });
      createSucceeded.current = true; setCreatedKey(result);
      setNewKeyName('');
      setIsCreating(false);
      fetchKeys();
    } catch {
      setCreateError('API key creation could not be confirmed. Check the key list before retrying; your name has been kept.');
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold text-slate-900">API Keys</h1>
          <p className="text-slate-500 text-sm">Manage external access to the {PRODUCT_BRAND.name} API.</p>
        </div>
        <TocynButton
          ref={createOpener} onClick={() => {
            createSucceeded.current = false; setCreateError(''); setCreatedKey(null);
            setIsCreating(true);
          }}
          className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create New Key
        </TocynButton>
      </div>

      <TocynDialog open={isCreating} busy={creating} labelledBy={createTitleId} initialFocusEl={() => keyNameInput.current}
        finalFocusEl={() => createSucceeded.current ? createdHeading.current : createOpener.current} onOpenChange={next => { if (!next) closeCreate(); }}>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-top-4">
          <h2 id={createTitleId} className="text-lg font-semibold mb-4">Create New API Key</h2>
          <form onSubmit={handleCreate} aria-labelledby={createTitleId}>
            {createError && <p role="alert" className="mb-4 text-red-700">{createError}</p>}
            <fieldset disabled={creating} className="space-y-4">
            <div>
              <label htmlFor={`${createTitleId}-name`} className="block text-sm font-medium text-slate-700 mb-1">
                Key Name
              </label>
              <TocynInput
                type="text" required id={`${createTitleId}-name`} ref={keyNameInput}
                placeholder="e.g. CRM Integration"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <TocynButton
                type="submit"
                className="bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors"
              >
                {creating ? 'Generating...' : 'Generate Key'}
              </TocynButton>
              <TocynButton
                type="button"
                onClick={closeCreate}
                className="text-slate-600 px-4 py-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </TocynButton>
            </div>
            </fieldset>
          </form>
        </div>
      </TocynDialog>

      {createdKey && (
        <div className="bg-amber-50 border border-amber-200 p-6 rounded-xl animate-in fade-in zoom-in">
          <div className="flex items-start gap-3 mb-4">
            <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0" />
            <div>
              <h3 ref={createdHeading} tabIndex={-1} className="font-semibold text-amber-900 text-lg">New API Key Generated</h3>
              <p className="text-amber-700 text-sm">
                Copy this key now. For security reasons, it will <strong>never</strong> be shown again.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white p-3 rounded-lg border border-amber-300 font-mono text-sm break-all">
            <span className="flex-1">{createdKey.apiKey}</span>
            <TocynButton
              disabled={copying} aria-label="Copy API key" onClick={() => copyToClipboard(createdKey.apiKey)}
              className="p-2 hover:bg-slate-100 rounded-md transition-colors shrink-0"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-slate-500" />}
            </TocynButton>
          </div>

          {copyError && <p role="alert">{copyError}</p>}
          {copied && <p role="status">API key copied.</p>}
          <TocynButton
            onClick={() => { setCreatedKey(null); createOpener.current?.focus(); }}
            className="mt-4 text-amber-800 text-sm font-medium hover:underline"
          >
            I've saved my key
          </TocynButton>
        </div>
      )}

      {listError && <p role="alert">{listError}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Prefix</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4">Last Used</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">Loading keys...</td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">{listError ? 'API key list unavailable.' : 'No API keys found.'}</td>
                </tr>
              ) : (
                keys.map((key) => (
                  <tr key={key.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">{key.name}</td>
                    <td className="px-6 py-4 font-mono text-sm text-slate-500">{key.prefix}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {new Date(key.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-slate-400" />
                        {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <TocynButton
                        aria-label={`Revoke ${key.name}`} onClick={event => { revokeOpener.current = event.currentTarget; revokeSucceeded.current = false; setRevocation(key); setRevokeError(''); setRevokeOpen(true); }}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Revoke Key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </TocynButton>
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
