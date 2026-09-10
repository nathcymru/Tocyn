import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import React, { useState, useEffect } from 'react';
import { dashboardApi } from '../api/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function WidgetChannelPage() {
  const queryClient = useQueryClient();

  const { data: config, isLoading, isError } = useQuery({
    queryKey: ['settings'],
    queryFn: () => dashboardApi.get<Record<string, string>>('/settings'),
  });

  const dirty = React.useRef(false);
  const savingGuard = React.useRef(false);
  const copyingGuard = React.useRef(false);
  const [saveError, setSaveError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [copyError, setCopyError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [copying, setCopying] = useState(false);
  const chatId = React.useId();
  const formId = React.useId();
  const [chatEnabled, setChatEnabled] = useState(true);
  const [formEnabled, setFormEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (config && !dirty.current) {
      setChatEnabled(config['widget.features.aiChat'] !== 'false');
      setFormEnabled(config['widget.features.ticketForm'] !== 'false');
    }
  }, [config]);

  const updateSettings = useMutation({
    mutationFn: (updates: Record<string, string>) =>
      dashboardApi.put('/settings', updates),
  });

  const handleSave = async () => {
    if (savingGuard.current || isLoading || isError || !config) return;
    savingGuard.current = true; setIsSaving(true); setSaveError(''); setSaveStatus('');
    const updates = {
      'widget.features.aiChat': chatEnabled ? 'true' : 'false',
      'widget.features.ticketForm': formEnabled ? 'true' : 'false',
    };
    try {
      await updateSettings.mutateAsync(updates);
      dirty.current = false;
      queryClient.setQueryData(['settings'], (current: Record<string,string> | undefined) => ({...current,...updates}));
      queryClient.invalidateQueries({queryKey:['settings']});
      setSaveStatus('Widget settings saved.');
    } catch { setSaveError('Widget settings could not be saved. Your choices have been kept; try again.'); }
    finally { savingGuard.current = false; setIsSaving(false); }
  };

  const copySnippet = async () => {
    if (copyingGuard.current) return;
    copyingGuard.current = true; setCopying(true); setCopyError(''); setCopyStatus('');
    try { await navigator.clipboard.writeText(snippet); setCopyStatus('Snippet copied.'); }
    catch { setCopyError('The snippet could not be copied. Select and copy it manually, or try again.'); }
    finally { copyingGuard.current = false; setCopying(false); }
  };

  const snippet = `<!-- Tocyn widget integration example -->
<script src="${window.location.origin}/lumina-widget.js" data-widget-key="YOUR_PUBLIC_WIDGET_KEY" async></script>
<!-- Requires a widget build configured for your API and customer sign-in. -->`;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Widget Channel</h1>
        <p className="text-slate-500 mt-1">Configure your embeddable customer support widget.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold border-b pb-2 text-slate-900">Features</h2>

          {isError && <p role="alert">Widget settings could not be loaded. Reload this page before saving.</p>}
          {saveError && <p role="alert">{saveError}</p>}
          {saveStatus && <p role="status">{saveStatus}</p>}
          {isLoading ? (
            <div className="text-slate-500">Loading settings...</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative flex items-center">
                  <TocynInput
                    type="checkbox"
                    id={chatId} aria-describedby={`${chatId}-help`} disabled={isSaving || isError || !config}
                    checked={chatEnabled}
                    onChange={(e) => { dirty.current = true; setSaveStatus(''); setChatEnabled(e.target.checked); }}
                    className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-500"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor={chatId} className="inline-flex min-h-11 items-center text-sm font-medium text-slate-900">
                    Chat Enabled
                  </label>
                  <p id={`${chatId}-help`} className="text-xs text-slate-500">
                    Allow customers to chat with the AI support agent.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative flex items-center">
                  <TocynInput
                    type="checkbox"
                    id={formId} aria-describedby={`${formId}-help`} disabled={isSaving || isError || !config}
                    checked={formEnabled}
                    onChange={(e) => { dirty.current = true; setSaveStatus(''); setFormEnabled(e.target.checked); }}
                    className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-500"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor={formId} className="inline-flex min-h-11 items-center text-sm font-medium text-slate-900">
                    Web Form Enabled
                  </label>
                  <p id={`${formId}-help`} className="text-xs text-slate-500">
                    Allow customers to submit a ticket via a form.
                  </p>
                </div>
              </div>
            </div>
          )}

          <TocynButton
            onClick={handleSave}
            disabled={isSaving || isLoading || isError || !config}
            className="w-full bg-brand-600 text-white py-2 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </TocynButton>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 text-white p-6 rounded-xl shadow-sm border border-slate-800">
            <h2 className="text-lg font-semibold mb-4 text-indigo-400">Embed Snippet</h2>
            <p className="text-sm text-slate-400 mb-4">
              Integration example: replace the public widget key and host the widget build configured for your API. Customer sign-in must be configured separately. Place the script before the closing <code>&lt;/body&gt;</code> tag.
            </p>
            <pre className="bg-black/50 p-4 rounded-lg text-xs overflow-x-auto text-emerald-400 border border-white/10 whitespace-pre">
              {snippet}
            </pre>
            <TocynButton
              disabled={copying} onClick={copySnippet}
              className="mt-4 w-full bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {copying ? 'Copying...' : 'Copy Snippet'}
            </TocynButton>
            {copyError && <p role="alert">{copyError}</p>}
            {copyStatus && <p role="status">{copyStatus}</p>}
          </div>

          <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-xl">
            <h2 className="text-lg font-semibold text-indigo-900 mb-2">Shadow DOM</h2>
            <p className="text-sm text-indigo-800">
              The widget uses Shadow DOM to limit accidental styling conflicts. Test it with your website’s styles; the host page still controls its placement, visibility and scripts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}