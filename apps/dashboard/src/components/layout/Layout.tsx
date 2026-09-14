import { GlobalSearch } from './GlobalSearch';
import { OperatorCapacityPanel } from '../capacity/OperatorCapacityPanel';
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
import { useOperatorPreferencesContext, OperatorPreferencesControl, OperatorThemeControl, OperatorThemeProvider } from '../theme/OperatorThemeProvider';

function cn(...inputs: any[]) {
  return clsx(inputs);
}

type ActivityItem = Readonly<{ id: string; ticketId: string; ticketSubject: string | null; kind: string; facts: Record<string, unknown>; revision: number; createdAt: string; readAt: string | null; dismissedAt: string | null }>;
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
  const capacityTitleId=React.useId();
  const [capacityOpen,setCapacityOpen]=useState(false);
  const capacityClose=useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      restoreAccountFocus.current = true;
      setIsOpen(false);
      requestAnimationFrame(() => trigger.current?.focus());
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

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
    <>
    <Popover.Root open={isOpen} onOpenChange={({open}) => { if (open) restoreAccountFocus.current = true; setIsOpen(open); }} ids={{content:disclosureId}} positioning={{placement:'top-start',strategy:'fixed'}} initialFocusEl={() => securityProfile.current} finalFocusEl={() => trigger.current} lazyMount unmountOnExit>
    <div className="tocyn-shell-account-wrapper">
      <Popover.Trigger asChild>
      <TocynButton
        type="button"
        ref={trigger}
        aria-label="Account options"
        aria-expanded={isOpen}
        aria-controls={disclosureId}
        title={user?.full_name || 'User'}
        className="tocyn-shell-account-trigger"
      >
        {user?.full_name?.[0] || 'A'}
      </TocynButton></Popover.Trigger>

      <Popover.Positioner>
        <Popover.Content aria-label="Account options" data-tocyn-inverse="" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); restoreAccountFocus.current = true; setIsOpen(false); requestAnimationFrame(() => trigger.current?.focus()); } }} className="tocyn-shell-account-popover">
          <div className="tocyn-shell-account-summary">
            <p className="tocyn-shell-account-name">{user?.full_name}</p>
            <p className="tocyn-shell-account-email">{user?.email}</p>
          </div>
          <Link
            ref={securityProfile}
            to="/profile/security"
            onClick={() => { restoreAccountFocus.current = false; setIsOpen(false); onNavigate?.(); setTimeout(() => navigationFocus()?.focus(), 50); }}
            className="tocyn-shell-account-action"
          >
            <Key className="tocyn-shell-small-icon" />
            Security Profile
          </Link>
          <TocynButton
            onClick={handleLogout}
            className="tocyn-shell-account-action tocyn-shell-account-action-full"
          >
            <LogOut className="tocyn-shell-small-icon" />
            Sign out of all sessions
          </TocynButton>
          <TocynButton type="button" aria-haspopup="dialog" onClick={()=>{restoreAccountFocus.current=false;setIsOpen(false);setCapacityOpen(true);}}
            className="tocyn-shell-account-action tocyn-shell-account-action-left">Current work</TocynButton>
          <OperatorThemeControl />
          <OperatorPreferencesControl />
        </Popover.Content>
      </Popover.Positioner>
    </div>
    </Popover.Root>
    <TocynDialog open={capacityOpen} onOpenChange={setCapacityOpen} labelledBy={capacityTitleId}
      initialFocusEl={()=>capacityClose.current} finalFocusEl={()=>trigger.current}>
      <div className="tocyn-shell-capacity-dialog">
        <div className="tocyn-shell-dialog-header">
          <h2 id={capacityTitleId} className="tocyn-shell-dialog-title">Current work</h2>
          <TocynButton ref={capacityClose} type="button" onClick={()=>setCapacityOpen(false)} className="tocyn-shell-dialog-close">Close current work</TocynButton>
        </div>
        {capacityOpen&&user?.id&&<OperatorCapacityPanel userId={user.id}/>}
      </div>
    </TocynDialog>
    </>
  );
}

function SidebarContent({ onNavigate, navigationFocus }: SidebarProps) {
  const location = useLocation();
  const labelled = useOperatorPreferencesContext().navigation === 'labelled';
  return (
        <div className="tocyn-shell-sidebar">
          <Link aria-label="Dashboard home" onClick={onNavigate} to="/" className="tocyn-shell-logo-link">
            <ProductLogo compact decorative className="tocyn-shell-logo" />
          </Link>

          <nav aria-label="Workspace navigation" className="tocyn-shell-navigation">
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
                    labelled ? "tocyn-shell-navigation-link-labelled" : "tocyn-shell-navigation-link-icon",
                    isActive
                      ? "tocyn-shell-navigation-link-active"
                      : "tocyn-shell-navigation-link-inactive"
                  )}
                >
                  <item.icon aria-hidden="true" className="tocyn-shell-navigation-icon" />{labelled && <span>{item.name}</span>}
                </Link>
              );
            })}
          </nav>

          <div className="tocyn-shell-sidebar-footer">
            <Link
              to="/settings"
              title="Settings"
              aria-label="Settings"
              onClick={onNavigate}
              className={cn(
                labelled ? "tocyn-shell-navigation-link-labelled" : "tocyn-shell-navigation-link-icon",
                location.pathname.startsWith('/settings')
                  ? "tocyn-shell-navigation-link-active"
                  : "tocyn-shell-navigation-link-inactive"
              )}
            >
              <Settings aria-hidden="true" className="tocyn-shell-navigation-icon" />{labelled && <span>Settings</span>}
            </Link>

            <UserMenu onNavigate={onNavigate} navigationFocus={navigationFocus} />
          </div>
        </div>
  );
}

function LayoutContent() {
  const preferences = useOperatorPreferencesContext();
  const [activityUpdatesAvailable, setActivityUpdatesAvailable] = useState(false);
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
  const isInboxRoute = location.pathname.startsWith('/inbox');

  useEffect(() => { main.current?.focus(); }, [location.pathname]);
  const loadActivity = React.useCallback(async () => {
    const generation = ++activityRequestGeneration.current;
    setActivityLoading(true); setActivityError(null); setActivityRetry(null);
    try {
      const response = await dashboardApi.get<ActivityResponse>(`/activities?limit=${ACTIVITY_PAGE_SIZE}`);
      if (generation === activityRequestGeneration.current) { setActivity(response); setActivityUpdatesAvailable(false); }
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
    if (activityOpen) {
      if (preferences.interruptionLevel === 'quiet') setActivityUpdatesAvailable(true);
      else void loadActivity();
    }
  }, [activityOpen, lastMessage, loadActivity, queryClient, preferences.interruptionLevel]);

  // Realtime is only an invalidation channel. Once a dropped connection is
  // restored, re-read the bounded durable projection so unread activity and
  // recovery state do not depend on a transient frame or toast.
  useEffect(() => {
    const restored = !wasConnected.current && isConnected;
    wasConnected.current = isConnected;
    if (!restored) return;
    setConnectionRecoveryMessage(preferences.interruptionLevel === 'quiet' ? 'Connection restored. Activity updates are available.' : 'Connection restored. Durable activity refreshed.');
    if (preferences.interruptionLevel === 'quiet') setActivityUpdatesAvailable(true); else void loadActivity();
  }, [isConnected, loadActivity, preferences.interruptionLevel]);

  const openActivity = (open: boolean) => {
    setActivityOpen(open);
    if (open) void loadActivity();
  };

  const transitionActivity = async (item: ActivityItem, action: 'read' | 'dismiss') => {
    try {
      await dashboardApi.patch(`/activities/${encodeURIComponent(item.id)}/${action}`, { expectedRevision: item.revision });
      if(action==='dismiss')await queryClient.invalidateQueries({queryKey:['tickets']});
      await loadActivity();
    } catch { setActivityError('Activity changed before it could be updated. The list was refreshed.'); void loadActivity(); }
  };

  const visibleActivityItems = activity?.page.items.filter(item => !item.dismissedAt) ?? [];

  return (
    <div className={cn('tocyn-shell-root', isInboxRoute ? 'tocyn-shell-root-inbox' : 'tocyn-shell-root-standard')}>
      <aside data-tocyn-inverse="" className={cn('tocyn-shell-sidebar-desktop', preferences.navigation === 'labelled' ? 'tocyn-shell-sidebar-labelled' : 'tocyn-shell-sidebar-compact')}>
        <SidebarContent navigationFocus={() => main.current} />
      </aside>
        <TocynDialog id={mobileDialogId} open={isSidebarOpen} onOpenChange={setIsSidebarOpen}
          labelledBy={`${mobileDialogId}-title`} initialFocusEl={() => navigationClose.current}
          finalFocusEl={() => restoreNavigationFocus.current ? navigationTrigger.current : main.current}
          data-tocyn-dialog-edge="" data-tocyn-inverse=""
          className={cn('tocyn-shell-mobile-dialog', preferences.navigation === 'labelled' ? 'tocyn-shell-mobile-labelled' : 'tocyn-shell-mobile-compact')}>
          <h2 id={`${mobileDialogId}-title`} className="tocyn-visually-hidden">Navigation</h2>
          <TocynButton ref={navigationClose} type="button" aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)}
            className="tocyn-shell-mobile-close"><X aria-hidden="true" /></TocynButton>
          <div className="tocyn-shell-mobile-content"><SidebarContent navigationFocus={() => main.current} onNavigate={() => { restoreNavigationFocus.current = false; setIsSidebarOpen(false); }} /></div>
        </TocynDialog>

      {/* Main content */}
      <div className="tocyn-shell-main">
        <header className="tocyn-shell-header tocyn-shell-header">
          <TocynButton
            type="button"
            ref={navigationTrigger}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={isSidebarOpen}
            aria-controls={mobileDialogId}
            className="tocyn-shell-mobile-trigger"
            onClick={() => { restoreNavigationFocus.current = true; setIsSidebarOpen(true); }}
          >
            <Menu className="tocyn-shell-menu-icon" />
          </TocynButton>

          <GlobalSearch shortcutsEnabled={preferences.shortcutsEnabled} />

          <Popover.Root open={activityOpen} onOpenChange={({ open }) => openActivity(open)} ids={{content:activityId}} positioning={{placement:'bottom-end',strategy:'fixed'}} finalFocusEl={() => activityTrigger.current} lazyMount unmountOnExit>
            <Popover.Trigger asChild>
              <TocynButton ref={activityTrigger} type="button" aria-label={activity?.unread.status === 'available' ? `Activity, ${activity.unread.count} unread` : 'Activity'} aria-expanded={activityOpen} aria-controls={activityId} className="tocyn-shell-activity-trigger">
                <Bell className="tocyn-shell-icon" />
                {activity?.unread.status === 'available' && activity.unread.count > 0 && <span aria-hidden="true" className="tocyn-shell-activity-badge">{activity.unread.count > 99 ? '99+' : activity.unread.count}</span>}
              </TocynButton>
            </Popover.Trigger>
            <Popover.Positioner>
              <Popover.Content aria-label="Activity" className="tocyn-shell-activity-popover">
                <div className="tocyn-shell-activity-header"><h2 className="tocyn-shell-activity-title">Activity</h2><TocynButton type="button" onClick={() => void loadActivity()} disabled={activityLoading} className="tocyn-shell-activity-refresh">Refresh</TocynButton></div>
                {activityUpdatesAvailable && <p role="status" className="tocyn-shell-activity-message">Updates available. Refresh to load current activity.</p>}
                {activityError && <div role="alert" className="tocyn-shell-activity-warning"><p>{activityError}</p><TocynButton type="button" onClick={() => void (activityRetry === 'more' ? loadMoreActivity() : loadActivity())} disabled={activityLoading} className="tocyn-shell-activity-retry">Retry loading activity</TocynButton></div>}
                {activityLoading && !activity && <p role="status" className="tocyn-shell-activity-message tocyn-shell-activity-muted">Loading durable activity…</p>}
                {activity?.unread.status === 'unavailable' && <p role="status" className="tocyn-shell-activity-warning">Unread count is temporarily unavailable. Your activity remains available below.</p>}
                {activity && visibleActivityItems.length === 0 && <p className="tocyn-shell-activity-message tocyn-shell-activity-muted">{activity.page.next ? 'No current activity in the loaded items.' : 'No current activity.'}</p>}
                <ul aria-label="Durable activity" className="tocyn-shell-activity-list">
                  {visibleActivityItems.map(item => <li key={item.id} className="tocyn-shell-activity-row">
                    <TocynButton type="button" aria-label={`Open ${item.kind.replace(/_/g, ' ')} activity for ${item.ticketSubject ?? `ticket ${item.ticketId}`}`} onClick={async () => { if (!item.readAt) await transitionActivity(item, 'read'); navigate(`/inbox/all/${item.ticketId}`); }} className="tocyn-shell-activity-item">
                      <p className="tocyn-shell-activity-item-kind">{item.kind.replace(/_/g, ' ')}</p>
                      <p className="tocyn-shell-activity-subject">{item.ticketSubject ?? `Ticket ${item.ticketId}`}</p>
                      <p className="tocyn-shell-activity-meta">Ticket activity saved {new Date(item.createdAt).toLocaleString()}</p>
                    </TocynButton>
                    <TocynButton type="button" aria-label={`Dismiss ${item.kind.replace(/_/g, ' ')} activity for ${item.ticketSubject ?? `ticket ${item.ticketId}`}`} onClick={() => void transitionActivity(item, 'dismiss')} className="tocyn-shell-activity-dismiss"><X className="tocyn-shell-dismiss-icon" /></TocynButton>
                  </li>)}
                </ul>
                {activity && activity.page.items.length >= MAX_RENDERED_ACTIVITY_ITEMS && activity.page.next && <p role="status" className="tocyn-shell-activity-limit">Loaded activity limit reached. Refresh to restart activity recovery.</p>}
                {activity && activity.page.items.length < MAX_RENDERED_ACTIVITY_ITEMS && activity.page.next && <div className="tocyn-shell-activity-more-wrap"><TocynButton type="button" onClick={() => void loadMoreActivity()} disabled={activityLoading} className="tocyn-shell-activity-more">{activityLoading ? 'Loading more activity…' : 'Load more activity'}</TocynButton></div>}
                {activity && !activityLoading && visibleActivityItems.length > 0 && <p role="status" className="tocyn-visually-hidden">Showing {visibleActivityItems.length} activity item{visibleActivityItems.length === 1 ? '' : 's'}.</p>}
              </Popover.Content>
            </Popover.Positioner>
          </Popover.Root>

          {!isConnected && <Popover.Root open={showConnDetails} onOpenChange={({open}) => setShowConnDetails(open)} ids={{content:connectionId}} positioning={{placement:'bottom-end',strategy:'fixed'}} finalFocusEl={() => connectionTrigger.current} lazyMount unmountOnExit>
          <div className="tocyn-shell-connection-wrap">
            <Popover.Trigger asChild>
            <TocynButton
              type="button"
              ref={connectionTrigger}
              aria-expanded={showConnDetails}
              aria-controls={connectionId}
              className={cn(
                "tocyn-shell-connection-button",
                isConnected
                  ? "tocyn-shell-connection-connected"
                  : "tocyn-shell-connection-disconnected"
              )}
            >
              <WifiOff className="tocyn-shell-small-icon" />
              <span>Disconnected</span>
              <ChevronDown className={cn("tocyn-shell-chevron", showConnDetails && "rotate-180")} />
            </TocynButton></Popover.Trigger>

            <Popover.Positioner>
              <Popover.Content aria-label="Connection Status" className="tocyn-shell-connection-popover">
                <div className="tocyn-shell-connection-header">
                  <h3 className="tocyn-shell-activity-title">Connection Status</h3>
                  <div className={cn(
                    "tocyn-shell-connection-dot",
                    isConnected ? "tocyn-shell-connection-dot-connected" : "tocyn-palette-red-fill"
                  )} />
                </div>

                <p role="status" className="tocyn-shell-connection-copy">Live updates are paused. Reconnect to refresh shared changes; saved activity can be recovered from the Activity menu.</p>

                <div className="tocyn-shell-reconnect-divider">
                  <TocynButton
                    onClick={() => {
                      manualReconnect();
                      setShowConnDetails(false);
                      connectionTrigger.current?.focus();
                    }}
                    className="tocyn-shell-reconnect-button"
                  >
                    <RefreshCw className="tocyn-shell-small-icon" />
                    Force Reconnect
                  </TocynButton>
                </div>
              </Popover.Content>
            </Popover.Positioner>
          </div>
          </Popover.Root>}
          {connectionRecoveryMessage && <p role="status" aria-live="polite" className="tocyn-visually-hidden">{connectionRecoveryMessage}</p>}
        </header>

        <main ref={main} tabIndex={-1} aria-label="Workspace" className={cn('tocyn-shell-content', isInboxRoute ? 'tocyn-shell-content-inbox' : 'tocyn-shell-content-standard', !location.pathname.startsWith('/settings') && !isInboxRoute && 'tocyn-shell-content-padded')}>
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
