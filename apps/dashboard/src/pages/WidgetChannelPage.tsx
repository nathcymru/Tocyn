import { ParkButton, ParkEmptyState, ParkInput } from '@luminatick/ui/park';
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
    <div className="tocyn-widget-channel-page">
      <div className="tocyn-widget-channel-header">
        <h1 className="tocyn-widget-channel-title">Widget Channel</h1>
        <p className="tocyn-widget-channel-description">Configure your embeddable customer support widget.</p>
      </div>

      <div className="tocyn-widget-settings-layout">
        <div className="tocyn-widget-settings-card">
          <h2 className="tocyn-widget-features-title">Features</h2>

          {isError && <p role="alert" className="tocyn-widget-status tocyn-widget-status--error">Widget settings could not be loaded. Reload this page before saving.</p>}
          {saveError && <p role="alert" className="tocyn-widget-status tocyn-widget-status--error">{saveError}</p>}
          {saveStatus && <p role="status" className="tocyn-widget-status tocyn-widget-status--success">{saveStatus}</p>}
          {isLoading ? (
            <ParkEmptyState title="Loading widget settings…" headingLevel={false} aria-busy="true" className="tocyn-widget-settings-loading" />
          ) : (
            <div className="tocyn-widget-feature-list">
              <div className="tocyn-widget-feature-row">
                <div className="tocyn-widget-checkbox-wrap">
                  <ParkInput
                    type="checkbox"
                    id={chatId} aria-describedby={`${chatId}-help`} disabled={isSaving || isError || !config}
                    checked={chatEnabled}
                    onChange={(e) => { dirty.current = true; setSaveStatus(''); setChatEnabled(e.target.checked); }}
                    className="tocyn-widget-checkbox"
                  />
                </div>
                <div className="tocyn-widget-feature-content">
                  <label htmlFor={chatId} className="tocyn-widget-feature-label">
                    Chat Enabled
                  </label>
                  <p id={`${chatId}-help`} className="tocyn-widget-feature-help">
                    Allow customers to chat with the AI support agent.
                  </p>
                </div>
              </div>

              <div className="tocyn-widget-feature-row">
                <div className="tocyn-widget-checkbox-wrap">
                  <ParkInput
                    type="checkbox"
                    id={formId} aria-describedby={`${formId}-help`} disabled={isSaving || isError || !config}
                    checked={formEnabled}
                    onChange={(e) => { dirty.current = true; setSaveStatus(''); setFormEnabled(e.target.checked); }}
                    className="tocyn-widget-checkbox"
                  />
                </div>
                <div className="tocyn-widget-feature-content">
                  <label htmlFor={formId} className="tocyn-widget-feature-label">
                    Web Form Enabled
                  </label>
                  <p id={`${formId}-help`} className="tocyn-widget-feature-help">
                    Allow customers to submit a ticket via a form.
                  </p>
                </div>
              </div>
            </div>
          )}

          <ParkButton
            onClick={handleSave}
            disabled={isSaving || isLoading || isError || !config}
            variant="solid" className="tocyn-widget-save"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </ParkButton>
        </div>

        <div className="tocyn-widget-aside">
          <div className="tocyn-widget-snippet">
            <h2 className="tocyn-widget-snippet-title">Embed Snippet</h2>
            <p className="tocyn-widget-snippet-copy">
              Integration example: replace the public widget key and host the widget build configured for your API. Customer sign-in must be configured separately. Place the script before the closing <code>&lt;/body&gt;</code> tag.
            </p>
            <pre className="tocyn-widget-snippet-code">
              {snippet}
            </pre>
            <ParkButton
              disabled={copying} onClick={copySnippet}
              className="tocyn-widget-copy-button"
            >
              {copying ? 'Copying...' : 'Copy Snippet'}
            </ParkButton>
            {copyError && <p role="alert">{copyError}</p>}
            {copyStatus && <p role="status">{copyStatus}</p>}
          </div>

          <div className="tocyn-widget-shadow-note">
            <h2 className="tocyn-widget-shadow-title">Shadow DOM</h2>
            <p className="tocyn-widget-shadow-copy">
              The widget uses Shadow DOM to limit accidental styling conflicts. Test it with your website’s styles; the host page still controls its placement, visibility and scripts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
