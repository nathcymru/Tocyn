import { css } from '@luminatick/ui/styled-system/css';
import { ParkButton, ParkCard, ParkCheckbox, ParkEmptyState } from '@luminatick/ui/park';
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
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({ display: 'grid', gap: '1' })}>
        <h1 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Widget Channel</h1>
        <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Configure your embeddable customer support widget.</p>
      </div>

      <div className={css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start', gap: '6' })}>
        <ParkCard.Root variant="outline" className={css({ minW: 0 })}><ParkCard.Body className={css({ display: 'grid', alignContent: 'start', gap: '4' })}>
          <ParkCard.Title>Features</ParkCard.Title>

          {isError && <p role="alert" className={css({"color":"text.default","fontSize":"sm","lineHeight":"relaxed","p":"3","rounded":"md","bg":"bg.subtle"})}>Widget settings could not be loaded. Reload this page before saving.</p>}
          {saveError && <p role="alert" className={css({"color":"text.default","fontSize":"sm","lineHeight":"relaxed","p":"3","rounded":"md","bg":"bg.subtle"})}>{saveError}</p>}
          {saveStatus && <p role="status" className={css({"color":"text.default","fontSize":"sm","lineHeight":"relaxed"})}>{saveStatus}</p>}
          {isLoading ? (
            <ParkEmptyState title="Loading widget settings…" headingLevel={false} aria-busy="true" className={css({"py":"6"})} />
          ) : (
            <div className={css({"display":"grid","gap":"4"})}>
              <div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
                <div className={css({"display":"flex","alignItems":"center"})}>
                  <ParkCheckbox.Root checked={chatEnabled} disabled={isSaving || isError || !config}
                    onCheckedChange={({ checked }) => { dirty.current = true; setSaveStatus(''); setChatEnabled(checked === true); }}>
                    <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
                    <ParkCheckbox.HiddenInput id={chatId} aria-describedby={`${chatId}-help`} />
                  </ParkCheckbox.Root>
                </div>
                <div className={css({"minW":0})}>
                  <label htmlFor={chatId} className={css({"fontWeight":"medium","color":"text.default","display":"grid","gap":"1","fontSize":"sm"})}>
                    Chat Enabled
                  </label>
                  <p id={`${chatId}-help`} className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                    Allow customers to chat with the AI support agent.
                  </p>
                </div>
              </div>

              <div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
                <div className={css({"display":"flex","alignItems":"center"})}>
                  <ParkCheckbox.Root checked={formEnabled} disabled={isSaving || isError || !config}
                    onCheckedChange={({ checked }) => { dirty.current = true; setSaveStatus(''); setFormEnabled(checked === true); }}>
                    <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
                    <ParkCheckbox.HiddenInput id={formId} aria-describedby={`${formId}-help`} />
                  </ParkCheckbox.Root>
                </div>
                <div className={css({"minW":0})}>
                  <label htmlFor={formId} className={css({"fontWeight":"medium","color":"text.default","display":"grid","gap":"1","fontSize":"sm"})}>
                    Web Form Enabled
                  </label>
                  <p id={`${formId}-help`} className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                    Allow customers to submit a ticket via a form.
                  </p>
                </div>
              </div>
            </div>
          )}

          <ParkButton
            onClick={handleSave}
            disabled={isSaving || isLoading || isError || !config}
            variant="solid" className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </ParkButton>
        </ParkCard.Body></ParkCard.Root>

        <div className={css({ display: 'grid', gap: '4', alignContent: 'start', minW: 0 })}>
          <ParkCard.Root variant="outline" className={css({ minW: 0 })}><ParkCard.Body className={css({ display: 'grid', alignContent: 'start', minW: 0, gap: '3' })}>
            <ParkCard.Title>Embed Snippet</ParkCard.Title>
            <p className={css({ m: 0, color: 'text.muted', fontSize: 'sm', lineHeight: 'relaxed' })}>
              Integration example: replace the public widget key and host the widget build configured for your API. Customer sign-in must be configured separately. Place the script before the closing <code>&lt;/body&gt;</code> tag.
            </p>
            <pre className={css({ minW: 0, maxW: 'full', m: 0, overflowX: 'auto', rounded: 'md', bg: 'bg.muted', p: '3', fontFamily: 'mono', fontSize: 'sm', whiteSpace: 'pre' })}>
              {snippet}
            </pre>
            <ParkButton
              disabled={copying} onClick={copySnippet}
              className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
            >
              {copying ? 'Copying...' : 'Copy Snippet'}
            </ParkButton>
            {copyError && <p role="alert">{copyError}</p>}
            {copyStatus && <p role="status">{copyStatus}</p>}
          </ParkCard.Body></ParkCard.Root>

          <ParkCard.Root variant="outline" className={css({ minW: 0 })}><ParkCard.Body className={css({ display: 'grid', alignContent: 'start', minW: 0, gap: '2' })}>
            <ParkCard.Title>Shadow DOM</ParkCard.Title>
            <p className={css({ m: 0, color: 'text.muted', fontSize: 'sm', lineHeight: 'relaxed' })}>
              The widget uses Shadow DOM to limit accidental styling conflicts. Test it with your website’s styles; the host page still controls its placement, visibility and scripts.
            </p>
          </ParkCard.Body></ParkCard.Root>
        </div>
      </div>
    </div>
  );
}
