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
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useCollaboration } from '../CollaborationContext';
import { clsx } from 'clsx';
import { OperatorThemeControl, OperatorThemeProvider } from '../theme/OperatorThemeProvider';

function cn(...inputs: any[]) {
  return clsx(inputs);
}

type ActivityItem = Readonly<{ id: string; ticketId: string; kind: string; facts: Record<string, unknown>; revision: number; createdAt: string; readAt: string | null; dismissedAt: string | null }>;
type ActivityResponse = Readonly<{ page: Readonly<{ items: readonly ActivityItem[]; next: string | null }>; unread: Readonly<{ status: 'available'; count: number } | { status: 'unavailable'; count: null; reason: string }> }>;
const ACTIVITY_PAGE_SIZE = 20;
const MAX_RENDERED_ACTIVITY_ITEMS = 100;

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
  const { isConnected, lastMessage, manualReconnect } = useCollaboration();
  const wasConnected = useRef(isConnected);
  const [connectionRecoveryMessage, setConnectionRecoveryMessage] = useState<string | null>(null);
  const [showConnDetails, setShowConnDetails] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityRetry, setActivityRetry] = useState<'refresh' | 'more' | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const activityRequestGeneration = useRef(0);
  const activityTrigger = useRef<HTMLButtonElement>(null);
  const activityId = React.useId();
  const connectionTrigger = useRef<HTMLButtonElement>(null);
  const connectionId = React.useId();
  const navigationClose = useRef<HTMLButtonElement>(null);
  const mobileDialogId = React.useId();
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const restoreNavigationFocus = useRef(true);
  const main = useRef<HTMLElement>(null);
  const globalSearchInput = useRef<HTMLInputElement>(null);
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
    const focusGlobalSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        globalSearchInput.current?.focus();
        globalSearchInput.current?.select();
      }
    };
    window.addEventListener('keydown', focusGlobalSearch);
    return () => window.removeEventListener('keydown', focusGlobalSearch);
  }, []);

  const loadActivity = React.useCallback(async () => {
    const generation = ++activityRequestGeneration.current;
    setActivityLoading(true); setActivityError(null); setActivityRetry(null);
    try {
      const response = await dashboardApi.get<ActivityResponse>(`/activities?limit=${ACTIVITY_PAGE_SIZE}`);
      if (generation === activityRequestGeneration.current) setActivity(response);
    } catch {
      if (generation === activityRequestGeneration.current) {
        setActivityError('Activity could not be refreshed. Try again when the connection is available.');
        setActivityRetry('refresh');
      }
    } finally {
      if (generation === activityRequestGeneration.current) setActivityLoading(false);
    }
  }, []);

  const loadMoreActivity = React.useCallback(async () => {
    const next = activity?.page.next;
    if (!next || activityLoading || (activity?.page.items.length ?? 0) >= MAX_RENDERED_ACTIVITY_ITEMS) return;
    const generation = activityRequestGeneration.current;
    setActivityLoading(true); setActivityError(null); setActivityRetry(null);
    try {
      const response = await dashboardApi.get<ActivityResponse>(`/activities?limit=${ACTIVITY_PAGE_SIZE}&cursor=${encodeURIComponent(next)}`);
      if (generation !== activityRequestGeneration.current) return;
      setActivity(current => {
        if (!current) return response;
        const capacity = MAX_RENDERED_ACTIVITY_ITEMS - current.page.items.length;
        const seen = new Set(current.page.items.map(item => item.id));
        const items = [...current.page.items, ...response.page.items.filter(item => !seen.has(item.id)).slice(0, capacity)];
        return { ...response, page: { items, next: response.page.next } };
      });
    } catch {
      if (generation === activityRequestGeneration.current) {
        setActivityError('More activity could not be loaded. Try again to continue.');
        setActivityRetry('more');
      }
    } finally {
      if (generation === activityRequestGeneration.current) setActivityLoading(false);
    }
  }, [activity, activityLoading]);

  useEffect(() => {
    if (!lastMessage) return;

    if (['ticket.created', 'ticket.updated', 'article.created'].includes(lastMessage.type)) {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      const ticketId = lastMessage.type === 'article.created'
        ? lastMessage.payload?.ticket_id ?? lastMessage.payload?.ticketId : lastMessage.payload?.id;
      if (typeof ticketId === 'string') void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    }

    // Signals never carry activity content. A visible panel recovers from D1.
    if (activityOpen) void loadActivity();
  }, [activityOpen, lastMessage, loadActivity, queryClient]);

  // Realtime is only an invalidation channel. Once a dropped connection is
  // restored, re-read the bounded durable projection so unread activity and
  // recovery state do not depend on a transient frame or toast.
  useEffect(() => {
    const restored = !wasConnected.current && isConnected;
    wasConnected.current = isConnected;
    if (!restored) return;
    setConnectionRecoveryMessage('Connection restored. Durable activity refreshed.');
    void loadActivity();
  }, [isConnected, loadActivity]);

  const openActivity = (open: boolean) => {
    setActivityOpen(open);
    if (open) void loadActivity();
  };

  const transitionActivity = async (item: ActivityItem, action: 'read' | 'dismiss') => {
    try {
      await dashboardApi.patch(`/activities/${encodeURIComponent(item.id)}/${action}`, { expectedRevision: item.revision });
      await loadActivity();
    } catch { setActivityError('Activity changed before it could be updated. The list was refreshed.'); void loadActivity(); }
  };

  return (
    <div className={cn('flex bg-slate-50', isInboxRoute ? 'h-dvh min-h-0 overflow-hidden' : 'min-h-screen')}>
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
              ref={globalSearchInput}
              type="text"
              placeholder="Search all authorised tickets..."
              aria-label="Search all tickets (global shell)"
              aria-keyshortcuts="Control+K Meta+K"
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
            <p id="global-ticket-search-scope" className="sr-only">Searches all tickets you are authorised to access. Press Command or Control K to focus this search. Filter this view is available in the Inbox.</p>
            <span aria-hidden="true" className="pointer-events-none absolute right-14 top-1/2 hidden -translate-y-1/2 text-[10px] font-semibold text-slate-500 sm:inline">⌘/Ctrl K</span>
          </div>

          <Popover.Root open={activityOpen} onOpenChange={({ open }) => openActivity(open)} ids={{content:activityId}} positioning={{placement:'bottom-end',strategy:'fixed'}} finalFocusEl={() => activityTrigger.current} lazyMount unmountOnExit>
            <Popover.Trigger asChild>
              <TocynButton ref={activityTrigger} type="button" aria-label={activity?.unread.status === 'available' ? `Activity, ${activity.unread.count} unread` : 'Activity'} aria-expanded={activityOpen} aria-controls={activityId} className="relative rounded p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2">
                <Bell className="w-5 h-5" />
                {activity?.unread.status === 'available' && activity.unread.count > 0 && <span aria-hidden="true" className="absolute right-0 top-0 min-w-4 rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{activity.unread.count > 99 ? '99+' : activity.unread.count}</span>}
              </TocynButton>
            </Popover.Trigger>
            <Popover.Positioner>
              <Popover.Content aria-label="Activity" className="w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold text-slate-900">Activity</h2><TocynButton type="button" onClick={() => void loadActivity()} disabled={activityLoading} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2">Refresh</TocynButton></div>
                {activityError && <div role="alert" className="rounded bg-amber-50 p-2 text-sm text-amber-900"><p>{activityError}</p><TocynButton type="button" onClick={() => void (activityRetry === 'more' ? loadMoreActivity() : loadActivity())} disabled={activityLoading} className="mt-2 rounded px-2 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2">Retry loading activity</TocynButton></div>}
                {activityLoading && !activity && <p role="status" className="p-2 text-sm text-slate-600">Loading durable activity…</p>}
                {activity?.unread.status === 'unavailable' && <p role="status" className="rounded bg-amber-50 p-2 text-sm text-amber-900">Unread count is temporarily unavailable. Your activity remains available below.</p>}
                {activity && activity.page.items.length === 0 && <p className="p-2 text-sm text-slate-600">No current activity.</p>}
                <ul aria-label="Durable activity" className="max-h-96 divide-y overflow-y-auto">
                  {activity?.page.items.filter(item => !item.dismissedAt).map(item => <li key={item.id} className="flex gap-2 py-2">
                    <TocynButton type="button" onClick={async () => { if (!item.readAt) await transitionActivity(item, 'read'); navigate(`/inbox/all/${item.ticketId}`); }} className="min-w-0 flex-1 rounded p-1 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2">
                      <p className="text-sm font-semibold text-slate-900">{item.kind.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-slate-600">Ticket activity saved {new Date(item.createdAt).toLocaleString()}</p>
                    </TocynButton>
                    <TocynButton type="button" aria-label="Dismiss activity" onClick={() => void transitionActivity(item, 'dismiss')} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2"><X className="h-4 w-4" /></TocynButton>
                  </li>)}
                </ul>
                {activity && activity.page.items.length >= MAX_RENDERED_ACTIVITY_ITEMS && activity.page.next && <p role="status" className="mt-2 text-sm text-slate-600">Showing the most recent {MAX_RENDERED_ACTIVITY_ITEMS} activity items. Refresh to restart activity recovery.</p>}
                {activity && activity.page.items.length < MAX_RENDERED_ACTIVITY_ITEMS && activity.page.next && <div className="mt-2"><TocynButton type="button" onClick={() => void loadMoreActivity()} disabled={activityLoading} className="w-full rounded px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2">{activityLoading ? 'Loading more activity…' : 'Load more activity'}</TocynButton></div>}
                {activity && !activityLoading && activity.page.items.length > 0 && <p role="status" className="sr-only">Showing {activity.page.items.length} activity item{activity.page.items.length === 1 ? '' : 's'}.</p>}
              </Popover.Content>
            </Popover.Positioner>
          </Popover.Root>

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

                <p role="status" className="text-sm text-slate-600">Live updates are paused. Reconnect to refresh shared changes; saved activity can be recovered from the Activity menu.</p>

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
          {connectionRecoveryMessage && <p role="status" aria-live="polite" className="sr-only">{connectionRecoveryMessage}</p>}
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
