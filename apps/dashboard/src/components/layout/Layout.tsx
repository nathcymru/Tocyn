import { GlobalSearch } from './GlobalSearch';
import { ProductLogo } from '@luminatick/ui/brand';
import { Popover } from '@luminatick/ui/ark';
import { TocynConfirmDialog, TocynDialog } from '@luminatick/ui/dialog';
import { ParkAvatar, ParkAvatarFallback, ParkButton, ParkMenu, ParkShell } from '@luminatick/ui/park';
import { useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../../api/client';
import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  HouseIcon,
  Ticket as TicketIcon,
  Users,
  Settings,
  BooksIcon,
  Menu,
  X,
  WifiOff,
  Bell,
  ChevronDown,
  RefreshCw,
} from '../icons';
import { useAuthStore } from '../../store/authStore';
import { useCollaboration } from '../CollaborationContext';
import { clsx } from 'clsx';
import { useOperatorPreferencesContext, OperatorThemeProvider } from '../theme/OperatorThemeProvider';

function cn(...inputs: any[]) {
  return clsx(inputs);
}

type ActivityItem = Readonly<{ id: string; ticketId: string; ticketSubject: string | null; kind: string; facts: Record<string, unknown>; revision: number; createdAt: string; readAt: string | null; dismissedAt: string | null }>;
type ActivityResponse = Readonly<{ page: Readonly<{ items: readonly ActivityItem[]; next: string | null }>; unread: Readonly<{ status: 'available'; count: number } | { status: 'unavailable'; count: null; reason: string }> }>;
const ACTIVITY_PAGE_SIZE = 20;
const MAX_RENDERED_ACTIVITY_ITEMS = 100;

interface SidebarProps { onNavigate?: () => void; navigationFocus: () => HTMLElement | null; }

function UserMenu({ onNavigate }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const loggingOut = useRef(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutCountdown, setLogoutCountdown] = useState(10);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const shellStyles = ParkShell();
  const handleNavigate = (path: string) => { onNavigate?.(); navigate(path); };
  useEffect(() => {
    if (!logoutOpen) return;
    setLogoutCountdown(10);
    const timer = window.setInterval(() => setLogoutCountdown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [logoutOpen]);
  const handleLogout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    setLogoutBusy(true);
    let confirmed = false;
    try { await dashboardApi.post('/auth/logout'); confirmed = true; }
    catch { /* Local sign-out must still complete. */ }
    finally { logout(); navigate('/login'); setLogoutBusy(false); setLogoutOpen(false); }
    if (!confirmed) window.alert("Server sign-out could not be confirmed. Local sign-in data was cleared. On a shared device, clear this site's browser data.");
  };

  return <>
  <ParkMenu.Root positioning={{ placement: 'bottom-end' }}>
    <ParkMenu.Trigger asChild>
      <ParkButton type="button" aria-label="Account options" title={user?.full_name || 'User'} className={shellStyles.personaTrigger}>
        <ParkAvatar className={shellStyles.personaAvatar}>
          <ParkAvatarFallback>{user?.full_name?.slice(0, 2).toUpperCase() || 'OP'}</ParkAvatarFallback>
        </ParkAvatar>
        <span className={shellStyles.personaStatus} aria-label="Online" />
      </ParkButton>
    </ParkMenu.Trigger>
    <ParkMenu.Positioner>
      <ParkMenu.Content aria-label="Account menu" className={shellStyles.accountMenu}>
        <div className={shellStyles.accountSummary}>
          <strong className={shellStyles.accountSummaryName}>{user?.full_name || 'Operator'}</strong>
          <span className={shellStyles.accountSummaryEmail}>{user?.email || 'No email available'}</span>
        </div>
        <ParkMenu.Item value="account" onClick={() => handleNavigate('/settings/account')} className={shellStyles.menuItem}>Account</ParkMenu.Item>
        <ParkMenu.Item value="settings" onClick={() => handleNavigate('/settings/general')} className={shellStyles.menuItem}>Settings</ParkMenu.Item>
        <ParkMenu.Item value="logout" data-tone="critical" onClick={() => { setLogoutCountdown(10); setLogoutOpen(true); }} className={shellStyles.menuItem}>Log out</ParkMenu.Item>
      </ParkMenu.Content>
    </ParkMenu.Positioner>
  </ParkMenu.Root>
  <TocynConfirmDialog
    open={logoutOpen}
    onOpenChange={setLogoutOpen}
    role="alertdialog"
    busy={logoutBusy}
    title="Confirm Logout"
    description="You are about to log out of the system. Please ensure any active work is saved before proceeding. You will need to sign in again to resume access."
    cancelLabel="Cancel"
    confirmLabel={`Log Out (${logoutCountdown})`}
    confirmClassName="tocyn-logout-confirm"
    cancelClassName="tocyn-logout-cancel"
    onConfirm={() => void handleLogout()}
  />
  </>;
}

function SidebarContent({ onNavigate, navigationFocus }: SidebarProps) {
  const location = useLocation();
  const labelled = useOperatorPreferencesContext().navigation === 'labelled';
  const shellStyles = ParkShell();
  return (
        <div className={cn(shellStyles.sidebar, labelled ? shellStyles.sidebarLabelled : shellStyles.sidebarCompact)}>
          <Link aria-label="Dashboard home" onClick={onNavigate} to="/" className={shellStyles.logoLink}>
            <ProductLogo compact decorative className={shellStyles.logo} />
          </Link>

          <nav aria-label="Workspace navigation" className={shellStyles.navigation}>
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
                    shellStyles.navigationLink,
                    labelled ? shellStyles.navigationLinkLabelled : shellStyles.navigationLinkIcon,
                  )}
                >
                  <item.icon aria-hidden="true" className={shellStyles.navigationIcon} />{labelled && <span>{item.name}</span>}
                </Link>
              );
            })}
          </nav>

        </div>
  );
}

function pageTitle(pathname: string) {
  if (pathname.startsWith('/inbox')) return 'Support Inbox';
  if (pathname.startsWith('/knowledge')) return 'Knowledge Base';
  if (pathname.startsWith('/settings/account')) return 'My Account';
  if (pathname.startsWith('/settings')) return 'Admin Settings';
  return 'Home';
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
  const shellStyles = ParkShell();
  const title = pageTitle(location.pathname);

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
      <div className={cn(shellStyles.root, isInboxRoute ? shellStyles.rootInbox : shellStyles.rootStandard, 'tocyn-shell-root', isInboxRoute ? 'tocyn-shell-root-inbox' : 'tocyn-shell-root-standard')}>
      <aside data-tocyn-inverse="" className={shellStyles.sidebarDesktop}>
        <SidebarContent navigationFocus={() => main.current} />
      </aside>
        <TocynDialog id={mobileDialogId} open={isSidebarOpen} onOpenChange={setIsSidebarOpen}
          labelledBy={`${mobileDialogId}-title`} initialFocusEl={() => navigationClose.current}
          finalFocusEl={() => restoreNavigationFocus.current ? navigationTrigger.current : main.current}
          data-tocyn-dialog-edge="" data-tocyn-inverse=""
          className={cn(shellStyles.mobileDialog, preferences.navigation === 'labelled' ? shellStyles.mobileDialogLabelled : shellStyles.mobileDialogCompact)}>
          <h2 id={`${mobileDialogId}-title`} className="tocyn-visually-hidden">Navigation</h2>
          <ParkButton ref={navigationClose} type="button" aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)}
            className={shellStyles.mobileClose}><X aria-hidden="true" /></ParkButton>
          <div className={shellStyles.mobileContent}><SidebarContent navigationFocus={() => main.current} onNavigate={() => { restoreNavigationFocus.current = false; setIsSidebarOpen(false); }} /></div>
        </TocynDialog>

      {/* Main content */}
      <div className={shellStyles.main}>
        <header className={cn(shellStyles.header, 'tocyn-shell-header')}>
          <ParkButton
            type="button"
            ref={navigationTrigger}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={isSidebarOpen}
            aria-controls={mobileDialogId}
            className={shellStyles.mobileTrigger}
            onClick={() => { restoreNavigationFocus.current = true; setIsSidebarOpen(true); }}
          >
            <Menu className={shellStyles.menuIcon} />
          </ParkButton>

          <span className={shellStyles.pageTitle} aria-label={`Current page: ${title}`}>{title}</span>

          <GlobalSearch shortcutsEnabled={preferences.shortcutsEnabled} />

          <Popover.Root open={activityOpen} onOpenChange={({ open }) => openActivity(open)} ids={{content:activityId}} positioning={{placement:'bottom-end',strategy:'fixed'}} finalFocusEl={() => activityTrigger.current} lazyMount unmountOnExit>
            <Popover.Trigger asChild>
              <ParkButton ref={activityTrigger} type="button" aria-label={activity?.unread.status === 'available' ? `Activity, ${activity.unread.count} unread` : 'Activity'} aria-expanded={activityOpen} aria-controls={activityId} className={shellStyles.activityTrigger}>
                <Bell className={shellStyles.icon} />
                {activity?.unread.status === 'available' && activity.unread.count > 0 && <span aria-hidden="true" className={shellStyles.activityBadge}>{activity.unread.count > 99 ? '99+' : activity.unread.count}</span>}
              </ParkButton>
            </Popover.Trigger>
            <Popover.Positioner>
              <Popover.Content aria-label="Activity" className={shellStyles.activityPopover}>
                <div className={shellStyles.activityHeader}><h2 className={shellStyles.activityTitle}>Activity</h2><ParkButton type="button" onClick={() => void loadActivity()} disabled={activityLoading} className={shellStyles.activityRefresh}>Refresh</ParkButton></div>
                {activityUpdatesAvailable && <p role="status" className={shellStyles.activityMessage}>Updates available. Refresh to load current activity.</p>}
                {activityError && <div role="alert" className={shellStyles.activityWarning}><p>{activityError}</p><ParkButton type="button" onClick={() => void (activityRetry === 'more' ? loadMoreActivity() : loadActivity())} disabled={activityLoading} className={shellStyles.activityRetry}>Retry loading activity</ParkButton></div>}
                {activityLoading && !activity && <p role="status" className={shellStyles.activityMessage}>Loading durable activity…</p>}
                {activity?.unread.status === 'unavailable' && <p role="status" className={shellStyles.activityWarning}>Unread count is temporarily unavailable. Your activity remains available below.</p>}
                {activity && visibleActivityItems.length === 0 && <p className={shellStyles.activityMessage}>{activity.page.next ? 'No current activity in the loaded items.' : 'No current activity.'}</p>}
                <ul aria-label="Durable activity" className={shellStyles.activityList}>
                  {visibleActivityItems.map(item => <li key={item.id} className={shellStyles.activityRow}>
                    <ParkButton type="button" aria-label={`Open ${item.kind.replace(/_/g, ' ')} activity for ${item.ticketSubject ?? `ticket ${item.ticketId}`}`} onClick={async () => { if (!item.readAt) await transitionActivity(item, 'read'); navigate(`/inbox/all/${item.ticketId}`); }} className={shellStyles.activityItem}>
                      <p>{item.kind.replace(/_/g, ' ')}</p>
                      <p className={shellStyles.activitySubject}>{item.ticketSubject ?? `Ticket ${item.ticketId}`}</p>
                      <p>Ticket activity saved {new Date(item.createdAt).toLocaleString()}</p>
                    </ParkButton>
                    <ParkButton type="button" aria-label={`Dismiss ${item.kind.replace(/_/g, ' ')} activity for ${item.ticketSubject ?? `ticket ${item.ticketId}`}`} onClick={() => void transitionActivity(item, 'dismiss')} className={shellStyles.activityDismiss}><X className={shellStyles.dismissIcon} /></ParkButton>
                  </li>)}
                </ul>
                {activity && activity.page.items.length >= MAX_RENDERED_ACTIVITY_ITEMS && activity.page.next && <p role="status">Loaded activity limit reached. Refresh to restart activity recovery.</p>}
                {activity && activity.page.items.length < MAX_RENDERED_ACTIVITY_ITEMS && activity.page.next && <div className={shellStyles.activityMoreWrap}><ParkButton type="button" onClick={() => void loadMoreActivity()} disabled={activityLoading} className={shellStyles.activityMore}>{activityLoading ? 'Loading more activity…' : 'Load more activity'}</ParkButton></div>}
                {activity && !activityLoading && visibleActivityItems.length > 0 && <p role="status" className="tocyn-visually-hidden">Showing {visibleActivityItems.length} activity item{visibleActivityItems.length === 1 ? '' : 's'}.</p>}
              </Popover.Content>
            </Popover.Positioner>
          </Popover.Root>

          <UserMenu onNavigate={() => { setTimeout(() => main.current?.focus(), 50); }} navigationFocus={() => main.current} />

          {!isConnected && <Popover.Root open={showConnDetails} onOpenChange={({open}) => setShowConnDetails(open)} ids={{content:connectionId}} positioning={{placement:'bottom-end',strategy:'fixed'}} finalFocusEl={() => connectionTrigger.current} lazyMount unmountOnExit>
          <div className={shellStyles.connectionWrap}>
            <Popover.Trigger asChild>
            <ParkButton
              type="button"
              ref={connectionTrigger}
              aria-expanded={showConnDetails}
              aria-controls={connectionId}
              className={shellStyles.connectionButton}
            >
              <WifiOff className={shellStyles.smallIcon} />
              <span>Disconnected</span>
              <ChevronDown className={cn(shellStyles.connectionChevron, showConnDetails && "rotate-180")} />
            </ParkButton></Popover.Trigger>

            <Popover.Positioner>
              <Popover.Content aria-label="Connection Status" className={shellStyles.connectionPopover}>
                <div className={shellStyles.activityHeader}>
                  <h3 className={shellStyles.activityTitle}>Connection Status</h3>
                  <div className={shellStyles.connectionDot} data-state={isConnected ? 'connected' : 'disconnected'} />
                </div>

                <p role="status">Live updates are paused. Reconnect to refresh shared changes; saved activity can be recovered from the Activity menu.</p>

                <div className={shellStyles.reconnectDivider}>
                  <ParkButton
                    onClick={() => {
                      manualReconnect();
                      setShowConnDetails(false);
                      connectionTrigger.current?.focus();
                    }}
                    className={shellStyles.reconnectButton}
                  >
                    <RefreshCw className={shellStyles.smallIcon} />
                    Force Reconnect
                  </ParkButton>
                </div>
              </Popover.Content>
            </Popover.Positioner>
          </div>
          </Popover.Root>}
          {connectionRecoveryMessage && <p role="status" aria-live="polite" className="tocyn-visually-hidden">{connectionRecoveryMessage}</p>}
        </header>

        <main ref={main} tabIndex={-1} aria-label="Workspace" className={cn(shellStyles.content, isInboxRoute ? shellStyles.contentInbox : shellStyles.contentStandard, !location.pathname.startsWith('/settings') && !location.pathname.startsWith('/knowledge') && !isInboxRoute && shellStyles.contentPadded, 'tocyn-shell-content', isInboxRoute ? 'tocyn-shell-content-inbox' : 'tocyn-shell-content-standard')}>
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
  { name: 'Dashboard', href: '/', icon: HouseIcon },
  { name: 'Inbox', href: '/inbox', icon: TicketIcon },
  { name: 'Knowledge Base', href: '/knowledge', icon: BooksIcon },
  { name: 'Settings', href: '/settings/general', icon: Settings },
];
