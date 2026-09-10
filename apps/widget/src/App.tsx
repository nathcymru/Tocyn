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
    <div className="flex flex-col items-end">
      <div hidden={!isOpen}>
        <div id={`${widgetId}-panel`} role="region" aria-labelledby={`${widgetId}-title`} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeWidget(); } }} className="mb-4 w-[calc(100vw-2.5rem)] sm:w-96 bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[min(600px,calc(100dvh-7.5rem))]">
          <div className="p-4 text-white flex justify-between items-center" style={{ backgroundColor: config.primaryColor }}>
            <h2 id={`${widgetId}-title`} className="font-bold text-lg">{config.title}</h2>
            <TocynButton ref={closeButton} aria-label="Close support" onClick={closeWidget} className="hover:bg-white/10 rounded min-w-11 min-h-11 flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </TocynButton>
          </div>

          <Tabs.Root activationMode="manual" value={selectedTab ?? null} onValueChange={({value}) => { if (value === 'chat' || value === 'ticket') setActiveTab(value); }} lazyMount={false} unmountOnExit={false}>
          <Tabs.List aria-label="Support options" className="flex border-b border-gray-200 bg-gray-50">
            {config.features.aiChat && (
              <Tabs.Trigger value="chat" asChild><TocynButton
                className={`flex-1 py-2 text-sm font-medium transition-colors ${selectedTab === 'chat' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                AI Chat
              </TocynButton></Tabs.Trigger>
            )}
            {config.features.ticketForm && (
              <Tabs.Trigger value="ticket" asChild><TocynButton
                className={`flex-1 py-2 text-sm font-medium transition-colors ${selectedTab === 'ticket' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                New Ticket
              </TocynButton></Tabs.Trigger>
            )}
          </Tabs.List>

          <div className="flex-1 overflow-y-auto bg-white p-4">
            {!session && <p>Sign in through the support portal to use chat or submit a ticket. {config.portalUrl && <a className="text-blue-600 underline" href={config.portalUrl} target="_blank" rel="noopener noreferrer">Open support portal</a>}</p>}
            {config.features.aiChat && <Tabs.Content value="chat">{session && <AiChat key={session.email} config={config} />}</Tabs.Content>}
            {config.features.ticketForm && <Tabs.Content value="ticket">{session && <TicketForm key={session.email} config={config} userEmail={session.email} />}</Tabs.Content>}
          </div>

          </Tabs.Root>
          <div className="p-2 text-center text-[10px] text-gray-600 border-t border-gray-100">
            Powered by Luminatick
          </div>
        </div>
      </div>

      <TocynButton
        ref={launcher} aria-label={isOpen ? 'Close support' : 'Open support'} aria-expanded={isOpen} aria-controls={`${widgetId}-panel`}
        onClick={toggleWidget}
        className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        style={{ backgroundColor: config.primaryColor }}
      >
        {isOpen ? (
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </TocynButton>
    </div>
  );
};

export default App;
