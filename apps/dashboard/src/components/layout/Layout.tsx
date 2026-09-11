import { ProductLogo } from '@luminatick/ui/brand';
import { Popover } from '@luminatick/ui/ark';
import { TocynDialog } from '@luminatick/ui/dialog';
import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../../api/client';
import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Ticket as TicketIcon,
  Users,
  Key,
  Settings,
  LogOut,
  Search,
  Book,
  Menu,
  X,
  WifiOff,
  Bell,
  ChevronDown,
  RefreshCw,
  Activity,
  MousePointer2,
  FileText
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useCollaboration } from '../CollaborationContext';
import { clsx } from 'clsx';
import { OperatorThemeControl, OperatorThemeProvider } from '../theme/OperatorThemeProvider';

function cn(...inputs: any[]) {
  return clsx(inputs);
}

interface Toast {
  id: string;
  type: string;
  title: string;
  message: string;
  ticketId?: string;
}

interface SidebarProps { onNavigate?: () => void; navigationFocus: () => HTMLElement | null; }

function UserMenu({ onNavigate, navigationFocus }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const restoreAccountFocus = useRef(true);
  const loggingOut = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const securityProfile = useRef<HTMLAnchorElement>(null);
  const disclosureId = React.useId();

  const handleLogout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    restoreAccountFocus.current = false;
    let confirmed = false;
    try { await dashboardApi.post('/auth/logout'); confirmed = true; }
    catch { /* Local sign-out must still complete. */ }
    finally { logout(); navigate('/login'); }
    if (!confirmed) window.alert("Server sign-out could not be confirmed. Local sign-in data was cleared. On a shared device, clear this site's browser data.");
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={({open}) => { if (open) restoreAccountFocus.current = true; setIsOpen(open); }} ids={{content:disclosureId}} positioning={{placement:'top-start',strategy:'fixed'}} initialFocusEl={() => securityProfile.current} finalFocusEl={() => restoreAccountFocus.current ? trigger.current : navigationFocus()} lazyMount unmountOnExit>
    <div className="relative mt-2">
      <Popover.Trigger asChild>
      <TocynButton
        type="button"
        ref={trigger}
        aria-label="Account options"
        aria-expanded={isOpen}
        aria-controls={disclosureId}
        title={user?.full_name || 'User'}
        className="w-10 h-10 rounded-full bg-slate-700 text-white flex items-center justify-center font-bold border border-slate-600 hover:ring-2 hover:ring-brand-500 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {user?.full_name?.[0] || 'A'}
      </TocynButton></Popover.Trigger>

      <Popover.Positioner>
        <Popover.Content aria-label="Account options" data-tocyn-inverse="" className=" w-80 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-bottom-2">
          <div className="px-4 py-2 border-b border-slate-700">
            <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
            <p className="text-xs text-slate-400 truncate">{user?.email}</p>
          </div>
          <Link
            ref={securityProfile}
            to="/profile/security"
            onClick={() => { restoreAccountFocus.current = false; setIsOpen(false); onNavigate?.(); }}
            className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Key className="w-4 h-4" />
            Security Profile
          </Link>
          <TocynButton
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out of all sessions
          </TocynButton>
          <OperatorThemeControl />
        </Popover.Content>
      </Popover.Positioner>
    </div>
    </Popover.Root>
  );
}

function SidebarContent({ onNavigate, navigationFocus }: SidebarProps) {
  const location = useLocation();
  return (
        <div className="flex flex-col h-full items-center py-4">
          <Link aria-label="Dashboard home" onClick={onNavigate} to="/" className="w-11 h-11 rounded-xl flex items-center justify-center mb-8 hover:bg-slate-700 transition-colors">
            <ProductLogo compact decorative className="w-10 h-10 object-contain" />
          </Link>

          <nav aria-label="Workspace navigation" className="flex-1 w-full px-2 space-y-2">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  title={item.name}
                  aria-label={item.name}
                  aria-current={isActive ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center justify-center w-full aspect-square rounded-xl transition-all group relative",
                    isActive
                      ? "bg-slate-800 text-white shadow-inner"
                      : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
                  )}
                >
                  <item.icon className="w-6 h-6" />
                </Link>
              );
            })}
          </nav>

          <div className="w-full px-2 space-y-2 mt-auto pb-4 border-t border-slate-800/50 pt-4 flex flex-col items-center relative">
            <Link
              to="/settings"
              title="Settings"
              aria-label="Settings"
              onClick={onNavigate}
              className={cn(
                "flex items-center justify-center w-full aspect-square rounded-xl transition-all group relative",
                location.pathname.startsWith('/settings')
                  ? "bg-slate-800 text-white shadow-inner"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
              )}
            >
              <Settings className="w-6 h-6" />
            </Link>

            <UserMenu onNavigate={onNavigate} navigationFocus={navigationFocus} />
          </div>
        </div>
  );
}

function LayoutContent() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const { isConnected, lastMessage, connectionDetails, manualReconnect } = useCollaboration();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showConnDetails, setShowConnDetails] = useState(false);
  const connectionTrigger = useRef<HTMLButtonElement>(null);
  const connectionId = React.useId();
  const navigationClose = useRef<HTMLButtonElement>(null);
  const mobileDialogId = React.useId();
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const restoreNavigationFocus = useRef(true);
  const main = useRef<HTMLElement>(null);
  const isInboxRoute = location.pathname.startsWith('/inbox');

  useEffect(() => { main.current?.focus(); }, [location.pathname]);
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const search = params.get('search');
    if (location.pathname === '/tickets' && search) {
      setSearchInput(search);
    } else if (location.pathname !== '/tickets') {
      setSearchInput('');
    }
  }, [location.pathname, location.search]);

  const clearGlobalTicketSearch = () => {
    setSearchInput('');
    navigate('/tickets');
  };

  useEffect(() => {
    if (!lastMessage) return;

    if (['ticket.created', 'ticket.updated', 'article.created'].includes(lastMessage.type)) {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      const ticketId = lastMessage.type === 'article.created'
        ? lastMessage.payload?.ticket_id ?? lastMessage.payload?.ticketId : lastMessage.payload?.id;
      if (typeof ticketId === 'string') void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    }

    if (lastMessage.type === 'ticket.created' || lastMessage.type === 'ticket.updated') {
      const isCreated = lastMessage.type === 'ticket.created';
      const toast: Toast = {
        id: Math.random().toString(36).substring(2),
        type: lastMessage.type,
        title: isCreated ? 'New Ticket' : 'Ticket Updated',
        message: lastMessage.payload.subject,
        ticketId: lastMessage.payload.id,
      };

      // Avoid duplicate toasts for the same event if multiple updates happen fast
      setToasts(prev => [toast, ...prev].slice(0, 5));

      setTimeout(() => {
        // Do not remove a notification while its keyboard action has focus.
        const focused = document.activeElement?.closest('[data-ticket-notification]');
        if (focused?.getAttribute('data-ticket-notification') !== toast.id) {
          setToasts(prev => prev.filter(t => t.id !== toast.id));
        }
      }, 8000);
    }
  }, [lastMessage, queryClient]);

  return (
    <div className={cn('flex bg-slate-50', isInboxRoute ? 'h-dvh min-h-0 overflow-hidden' : 'min-h-screen')}>
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            data-ticket-notification={toast.id}
            className="bg-white border border-slate-200 shadow-xl rounded-lg p-4 w-80 pointer-events-auto transform transition-all animate-in slide-in-from-right hover:scale-[1.02] cursor-pointer"
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                toast.type === 'ticket.created' ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600"
              )}>
                <Bell className="w-4 h-4" />
              </div>
              <TocynButton type="button" aria-label={`Open ticket notification: ${toast.title}`}
                onClick={() => {
                  if (toast.ticketId) navigate(`/inbox/all/${toast.ticketId}`);
                  setToasts(prev => prev.filter(t => t.id !== toast.id));
                }} className="flex-1 min-w-0 text-left rounded focus-visible:outline focus-visible:outline-2">
                <p role="status" className="text-sm font-semibold text-slate-900">{toast.title}</p>
                <p className="text-xs text-slate-500 truncate">{toast.message}</p>
              </TocynButton>
              <TocynButton
                type="button"
                aria-label="Dismiss ticket notification"
                onClick={(e) => {
                  e.stopPropagation();
                  main.current?.focus();
                  setToasts(prev => prev.filter(t => t.id !== toast.id));
                }}
                className="text-slate-600 hover:text-slate-900 p-1 rounded focus-visible:outline focus-visible:outline-2"
              >
                <X className="w-4 h-4" />
              </TocynButton>
            </div>
          </div>
        ))}
      </div>

      <aside data-tocyn-inverse="" className="hidden lg:block w-16 shrink-0 bg-slate-900 border-r border-slate-800">
        <SidebarContent navigationFocus={() => main.current} />
      </aside>
        <TocynDialog id={mobileDialogId} open={isSidebarOpen} onOpenChange={setIsSidebarOpen}
          labelledBy={`${mobileDialogId}-title`} initialFocusEl={() => navigationClose.current}
          finalFocusEl={() => restoreNavigationFocus.current ? navigationTrigger.current : main.current}
          data-tocyn-dialog-edge="" data-tocyn-inverse=""
          className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-20 overflow-visible border-0 bg-slate-900 text-white p-2 backdrop:bg-slate-900/50">
          <h2 id={`${mobileDialogId}-title`} className="sr-only">Navigation</h2>
          <TocynButton ref={navigationClose} type="button" aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)}
            className="rounded p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><X aria-hidden="true" /></TocynButton>
          <div className="h-[calc(100dvh-4rem)]"><SidebarContent navigationFocus={() => main.current} onNavigate={() => { restoreNavigationFocus.current = false; setIsSidebarOpen(false); }} /></div>
        </TocynDialog>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8">
          <TocynButton
            type="button"
            ref={navigationTrigger}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={isSidebarOpen}
            aria-controls={mobileDialogId}
            className="lg:hidden rounded p-2 text-slate-600 focus-visible:outline focus-visible:outline-2"
            onClick={() => { restoreNavigationFocus.current = true; setIsSidebarOpen(true); }}
          >
            <Menu className="w-6 h-6" />
          </TocynButton>

          <div className="max-w-md w-full relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <TocynInput
              type="text"
              placeholder="Search all authorised tickets..."
              aria-label="Search all authorised tickets"
              aria-describedby="global-ticket-search-scope"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (searchInput.trim()) {
                    navigate(`/tickets?search=${encodeURIComponent(searchInput.trim())}`);
                  } else {
                    navigate('/tickets');
                  }
                } else if (e.key === 'Escape' && searchInput) {
                  e.preventDefault();
                  clearGlobalTicketSearch();
                }
              }}
              className="w-full pl-10 pr-20 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-brand-500 transition-all focus:bg-white focus:shadow-inner"
            />
            <TocynButton type="button" aria-label="Clear global ticket search" disabled={!searchInput} onClick={clearGlobalTicketSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-slate-700 underline disabled:no-underline disabled:opacity-50">Clear</TocynButton>
            <p id="global-ticket-search-scope" className="sr-only">Searches all tickets you are authorised to access. Filter this view is available in the Inbox.</p>
          </div>

          {!isConnected && <Popover.Root open={showConnDetails} onOpenChange={({open}) => setShowConnDetails(open)} ids={{content:connectionId}} positioning={{placement:'bottom-end',strategy:'fixed'}} finalFocusEl={() => connectionTrigger.current} lazyMount unmountOnExit>
          <div className="flex items-center gap-4 relative">
            <Popover.Trigger asChild>
            <TocynButton
              type="button"
              ref={connectionTrigger}
              aria-expanded={showConnDetails}
              aria-controls={connectionId}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border shadow-sm hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                isConnected
                  ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                  : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
              )}
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span>Disconnected</span>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showConnDetails && "rotate-180")} />
            </TocynButton></Popover.Trigger>

            <Popover.Positioner>
              <Popover.Content aria-label="Connection Status" className=" w-64 bg-white border border-slate-200 shadow-xl rounded-xl p-4 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900">Connection Status</h3>
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    isConnected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-red-500"
                  )} />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <Activity className="w-3 h-3" /> Latency
                    </span>
                    <span className="font-mono text-slate-900">{connectionDetails.latency}ms</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <RefreshCw className="w-3 h-3" /> Reconnects
                    </span>
                    <span className="font-mono text-slate-900">{connectionDetails.reconnectCount}</span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100">
                  <TocynButton
                    onClick={() => {
                      manualReconnect();
                      setShowConnDetails(false);
                      connectionTrigger.current?.focus();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Force Reconnect
                  </TocynButton>
                </div>
              </Popover.Content>
            </Popover.Positioner>
          </div>
          </Popover.Root>}
        </header>

        <main ref={main} tabIndex={-1} aria-label="Workspace" className={cn('flex-1 min-h-0', isInboxRoute ? 'overflow-hidden' : 'overflow-auto', !location.pathname.startsWith('/settings') && !isInboxRoute && 'p-4 lg:p-8')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function Layout() {
  const { user, sessionGeneration } = useAuthStore();
  const identity = `${sessionGeneration}:${user?.tenant_id ?? ''}:${user?.id ?? ''}`;
  return <OperatorThemeProvider key={identity}><LayoutContent /></OperatorThemeProvider>;
}

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Inbox', href: '/inbox', icon: TicketIcon },
  { name: 'Knowledge Base', href: '/knowledge', icon: Book },
];
