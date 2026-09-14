import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';
import { Tabs } from '@luminatick/ui/ark';
import { TocynButton } from '@luminatick/ui/primitives';
import React, { useState, useEffect, useRef, useId } from 'react';
import TicketForm from './components/TicketForm';
import AiChat from './components/AiChat';
import { BASE_URL, widgetHeaders, getWidgetSession } from './api';

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
    <div className="tocyn-widget-launcher-wrap">
      <div hidden={!isOpen}>
        <div id={`${widgetId}-panel`} role="region" aria-labelledby={`${widgetId}-title`} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeWidget(); } }} className="tocyn-widget-panel">
          <div className="tocyn-widget-panel-header" style={{ backgroundColor: config.primaryColor }}>
            <h2 id={`${widgetId}-title`} className="tocyn-widget-panel-title">{config.title}</h2>
            <TocynButton ref={closeButton} aria-label="Close support" onClick={closeWidget} className="tocyn-widget-close">
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="tocyn-widget-close-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </TocynButton>
          </div>

          <Tabs.Root activationMode="manual" value={selectedTab ?? null} onValueChange={({value}) => { if (value === 'chat' || value === 'ticket') setActiveTab(value); }} lazyMount={false} unmountOnExit={false}>
          <Tabs.List aria-label="Support options" className="tocyn-widget-tabs">
            {config.features.aiChat && (
              <Tabs.Trigger value="chat" asChild><TocynButton
                className={`tocyn-widget-tab ${selectedTab === 'chat' ? 'tocyn-widget-tab--active' : ''}`}
              >
                AI Chat
              </TocynButton></Tabs.Trigger>
            )}
            {config.features.ticketForm && (
              <Tabs.Trigger value="ticket" asChild><TocynButton
                className={`tocyn-widget-tab ${selectedTab === 'ticket' ? 'tocyn-widget-tab--active' : ''}`}
              >
                New Ticket
              </TocynButton></Tabs.Trigger>
            )}
          </Tabs.List>

          <div className="tocyn-widget-panel-body">
            {!session && <p className="tocyn-widget-sign-in">Sign in through the support portal to use chat or submit a ticket. {config.portalUrl && <a className="tocyn-widget-portal-link" href={config.portalUrl} target="_blank" rel="noopener noreferrer">Open support portal</a>}</p>}
            {config.features.aiChat && <Tabs.Content value="chat">{session && <AiChat key={session.email} config={config} />}</Tabs.Content>}
            {config.features.ticketForm && <Tabs.Content value="ticket">{session && <TicketForm key={session.email} config={config} userEmail={session.email} />}</Tabs.Content>}
          </div>

          </Tabs.Root>
          <div data-product-attribution className="tocyn-widget-attribution">
            Powered by {PRODUCT_BRAND.name}
          </div>
        </div>
      </div>

      <TocynButton
        ref={launcher} aria-label={isOpen ? 'Close support' : 'Open support'} aria-expanded={isOpen} aria-controls={`${widgetId}-panel`}
        onClick={toggleWidget}
        className="tocyn-widget-launcher"
        style={{ backgroundColor: config.primaryColor }}
      >
        {isOpen ? (
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="tocyn-widget-launcher-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="tocyn-widget-launcher-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </TocynButton>
    </div>
  );
};

export default App;
