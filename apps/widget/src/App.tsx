import { w, widgetBrandColor } from './widgetStyles';
import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';
import { ParkAlert, ParkButton, ParkScrollArea, ParkTabs } from '@luminatick/ui/park';
import { Link } from '@luminatick/ui/components';
import React, { useState, useEffect, useRef, useId } from 'react';
import TicketForm from './components/TicketForm';
import AiChat from './components/AiChat';
import { BASE_URL, widgetHeaders, getWidgetSession } from './api';
import { IconXmark, IconChevronDown, IconMessage } from '@luminatick/ui/icons';

const App: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'ticket'>('chat');
  const [config, setConfig] = useState<any>(null);
  const [session, setSession] = useState<{email: string} | null>(null);

  const widgetId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (isOpen) closeButton.current?.focus(); }, [isOpen]);

  useEffect(() => {
    const refresh = () => { getWidgetSession().then(setSession).catch(() => setSession(null)); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    // Fetch widget configuration from the backend
    fetch(`${BASE_URL}/config`, { headers: widgetHeaders() })
      .then(res => { if (!res.ok) throw new Error('Widget configuration unavailable'); return res.json(); })
      .then(data => setConfig(data))
      .catch(() => setConfig(null));
  }, []);

  const closeWidget = () => { setIsOpen(false); launcher.current?.focus(); };
  const toggleWidget = () => { if (isOpen) closeWidget(); else setIsOpen(true); };

  if (!config) return null;

  const tabs = (['chat', 'ticket'] as const).filter(tab => tab === 'chat' ? config.features.aiChat : config.features.ticketForm);
  const selectedTab = tabs.includes(activeTab) ? activeTab : tabs[0];

  return (
    <div className={w.launcherWrap} style={{ '--widget-brand-color': widgetBrandColor(config.primaryColor) } as React.CSSProperties}>
      <div hidden={!isOpen}>
        <div id={`${widgetId}-panel`} role="region" aria-labelledby={`${widgetId}-title`} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeWidget(); } }} className={w.panel}>
          <div className={w.panelHeader}>
            <h2 id={`${widgetId}-title`} className={w.panelTitle}>{config.title}</h2>
            <ParkButton ref={closeButton} aria-label="Close support" onClick={closeWidget} variant="plain" className={w.close}>
              <IconXmark className={w.closeIcon} aria-hidden="true" />
            </ParkButton>
          </div>

          <ParkTabs.Root className={w.tabRoot} activationMode="manual" value={selectedTab ?? null} onValueChange={({value}) => { if (value === 'chat' || value === 'ticket') setActiveTab(value); }} lazyMount={false} unmountOnExit={false}>
          <ParkTabs.List aria-label="Support options" className={w.tabs}>
            {config.features.aiChat && (
              <ParkTabs.Trigger value="chat" className={w.tab}>AI Chat</ParkTabs.Trigger>
            )}
            {config.features.ticketForm && (
              <ParkTabs.Trigger value="ticket" className={w.tab}>New Ticket</ParkTabs.Trigger>
            )}
          </ParkTabs.List>

          <ParkScrollArea.Root className={w.panelBody}>
            <ParkScrollArea.Viewport role="region" aria-label="Support content" tabIndex={0} className={w.panelViewport}>
              <ParkScrollArea.Content className={w.panelContent}>
                {!session && <ParkAlert.Root status="info" variant="surface">
                  <ParkAlert.Content><ParkAlert.Description>
                    Sign in through the support portal to use chat or submit a ticket. {config.portalUrl && <Link href={config.portalUrl} target="_blank" rel="noopener noreferrer">Open support portal</Link>}
                  </ParkAlert.Description></ParkAlert.Content>
                </ParkAlert.Root>}
                {config.features.aiChat && <ParkTabs.Content value="chat">{session && <AiChat key={session.email} config={config} />}</ParkTabs.Content>}
                {config.features.ticketForm && <ParkTabs.Content value="ticket">{session && <TicketForm key={session.email} userEmail={session.email} />}</ParkTabs.Content>}
              </ParkScrollArea.Content>
            </ParkScrollArea.Viewport>
            <ParkScrollArea.Scrollbar orientation="vertical" />
          </ParkScrollArea.Root>

          </ParkTabs.Root>
          <div data-product-attribution className={w.attribution}>
            Powered by {PRODUCT_BRAND.name}
          </div>
        </div>
      </div>

      <ParkButton
        ref={launcher} aria-label={isOpen ? 'Close support' : 'Open support'} aria-expanded={isOpen} aria-controls={`${widgetId}-panel`}
        onClick={toggleWidget}
        variant="solid"
        className={w.launcher}
      >
        {isOpen ? (
          <IconChevronDown className={w.launcherIcon} aria-hidden="true" />
        ) : (
          <IconMessage className={w.launcherIcon} aria-hidden="true" />
        )}
      </ParkButton>
    </div>
  );
};

export default App;
