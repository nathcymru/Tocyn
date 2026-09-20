import { GlobalSearch } from './GlobalSearch';
import { ProductLogo } from '@luminatick/ui/brand';
import { ParkAlert, ParkAvatar, ParkAvatarFallback, ParkButton, ParkDialog, ParkEmptyState, ParkMenu, ParkPopover, ParkScrollArea, ParkShell, ParkSkeleton, ParkVisuallyHidden } from '@luminatick/ui/park';
import { IconButton as ParkIconButton, Link as ParkLink } from '@luminatick/ui/components';
import { InboxGlobalAlertProvider } from '../InboxGlobalAlert';
import { useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../../api/client';
import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
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
import { css } from '@luminatick/ui/styled-system/css';
import { useOperatorPreferencesContext, OperatorThemeProvider } from '../theme/OperatorThemeProvider';

function cn(...inputs: any[]) {
  return clsx(inputs);
}

type ActivityItem = Readonly<{ id: string; ticketId: string; ticketSubject: string | null; kind: string; facts: Record<string, unknown>; revision: number; createdAt: string; readAt: string | null; dismissedAt: string | null }>;
type ActivityResponse = Readonly<{ page: Readonly<{ items: readonly ActivityItem[]; next: string | null }>; unread: Readonly<{ status: 'available'; count: number } | { status: 'unavailable'; count: null; reason: string }> }>;
const ACTIVITY_PAGE_SIZE = 20;
const MAX_RENDERED_ACTIVITY_ITEMS = 100;
const DESKTOP_PERSONA_QUERY = '(min-width: 64rem)';

interface SidebarProps { onNavigate?: () => void; personaHost?: React.Ref<HTMLDivElement>; }

function UserMenu({ onNavigate, desktop, labelled, open, onOpenChange }: { onNavigate?: () => void; desktop: boolean; labelled: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const loggingOut = useRef(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutCountdown, setLogoutCountdown] = useState(10);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const logoutCancel = useRef<HTMLButtonElement>(null);
  const logoutTitleId = React.useId();
  const logoutDescriptionId = React.useId();
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
    let warning: string | undefined;
    try { await dashboardApi.post('/auth/logout'); }
    catch { warning = "Server sign-out could not be confirmed. Local sign-in data was cleared. On a shared device, clear this site's browser data."; }
    finally { logout(); navigate('/login', { state: warning ? { logoutWarning: warning } : undefined }); setLogoutBusy(false); setLogoutOpen(false); }
  };

  return <>
  <ParkMenu.Root open={open} onOpenChange={({ open: nextOpen }) => onOpenChange(nextOpen)} positioning={{ placement: desktop ? 'top-start' : 'bottom-end', strategy: 'fixed' }}>
    <ParkMenu.Trigger asChild>
      <ParkButton ref={accountTrigger} type="button" variant="plain" size="md" aria-label="Account options" title={user?.full_name || 'User'} className={cn(shellStyles.personaTrigger, desktop && labelled && shellStyles.personaTriggerLabelled)}>
        <ParkAvatar size="md" className={shellStyles.personaAvatar}>
          <ParkAvatarFallback name={user?.full_name || 'Operator'} />
          <span className={shellStyles.personaStatus} aria-hidden="true" />
        </ParkAvatar>
        {desktop && labelled && <span className={shellStyles.personaDetails} aria-hidden="true"><strong className={shellStyles.personaName}>{user?.full_name || 'Operator'}</strong><span className={shellStyles.personaPresence}>Signed in</span></span>}
      </ParkButton>
    </ParkMenu.Trigger>
    <ParkMenu.Positioner>
      <ParkMenu.Content aria-label="Account menu" className={shellStyles.accountMenu}>
        <ParkMenu.ItemGroup>
          <ParkMenu.ItemGroupLabel className={shellStyles.accountSummary}>
            <strong className={shellStyles.accountSummaryName}>{user?.full_name || 'Operator'}</strong>
            <span className={shellStyles.accountSummaryEmail}>{user?.email || 'No email available'}</span>
          </ParkMenu.ItemGroupLabel>
          <ParkMenu.Item value="account" onClick={() => handleNavigate('/settings/account')} className={shellStyles.menuItem}>Account</ParkMenu.Item>
          <ParkMenu.Item value="settings" onClick={() => handleNavigate('/settings/general')} className={shellStyles.menuItem}>Settings</ParkMenu.Item>
          <ParkMenu.Item value="logout" data-tone="critical" onClick={() => { setLogoutCountdown(10); setLogoutOpen(true); }} className={shellStyles.menuItem}>Log out</ParkMenu.Item>
        </ParkMenu.ItemGroup>
      </ParkMenu.Content>
    </ParkMenu.Positioner>
  </ParkMenu.Root>
  <ParkDialog.Root open={logoutOpen} onOpenChange={({ open: next }) => { if (!logoutBusy) setLogoutOpen(next); }}
    initialFocusEl={() => logoutCancel.current} finalFocusEl={() => accountTrigger.current}
    closeOnEscape={!logoutBusy} closeOnInteractOutside={false} lazyMount unmountOnExit>
    <ParkDialog.Backdrop />
    <ParkDialog.Positioner>
      <ParkDialog.Content role="alertdialog" aria-labelledby={logoutTitleId} aria-describedby={logoutDescriptionId}>
        <ParkDialog.Header><ParkDialog.Title id={logoutTitleId}>Confirm Logout</ParkDialog.Title></ParkDialog.Header>
        <ParkDialog.Body><ParkDialog.Description id={logoutDescriptionId}>You are about to log out of the system. Please ensure any active work is saved before proceeding. You will need to sign in again to resume access.</ParkDialog.Description></ParkDialog.Body>
        <ParkDialog.Footer>
          <ParkButton ref={logoutCancel} type="button" disabled={logoutBusy} onClick={() => setLogoutOpen(false)}>Cancel</ParkButton>
          <ParkButton type="button" disabled={logoutBusy} onClick={() => void handleLogout()}>{`Log Out (${logoutCountdown})`}</ParkButton>
        </ParkDialog.Footer>
      </ParkDialog.Content>
    </ParkDialog.Positioner>
  </ParkDialog.Root>
  </>;
}

function SidebarContent({ onNavigate, personaHost }: SidebarProps) {
  const location = useLocation();
  const labelled = useOperatorPreferencesContext().navigation === 'labelled';
  const shellStyles = ParkShell();
  const renderNavigationItem = (item: (typeof navigation)[number]) => {
    const isActive = location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href));
    return <ParkLink key={item.name} asChild variant="plain">
      <Link
        to={item.href}
        title={item.name}
        aria-label={item.name}
        aria-current={isActive ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(shellStyles.navigationLink, labelled ? shellStyles.navigationLinkLabelled : shellStyles.navigationLinkIcon)}
      >
        <item.icon aria-hidden="true" className={shellStyles.navigationIcon} />{labelled && <span>{item.name}</span>}
      </Link>
    </ParkLink>;
  };
  return (
        <div className={cn(shellStyles.sidebar, labelled ? shellStyles.sidebarLabelled : shellStyles.sidebarCompact)}>
          <ParkLink asChild variant="plain">
            <Link aria-label="Dashboard home" onClick={onNavigate} to="/" className={shellStyles.logoLink}>
              <ProductLogo compact decorative className={shellStyles.logo} />
            </Link>
          </ParkLink>

          <nav aria-label="Workspace navigation" className={shellStyles.navigation}>
            {navigation.filter(item => item.name !== 'Settings').map(renderNavigationItem)}
          </nav>
          <div className={shellStyles.sidebarFooter}>
            <nav aria-label="Settings navigation" className={shellStyles.settingsNavigation}>
              {navigation.filter(item => item.name === 'Settings').map(renderNavigationItem)}
            </nav>
            {personaHost && <div ref={personaHost} className={shellStyles.sidebarPersonaHost} />}
          </div>
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
  const [desktopPersona, setDesktopPersona] = useState(() => window.matchMedia?.(DESKTOP_PERSONA_QUERY).matches ?? false);
  const desktopPersonaRef = useRef(desktopPersona);
  desktopPersonaRef.current = desktopPersona;
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuOpenRef = useRef(accountMenuOpen);
  accountMenuOpenRef.current = accountMenuOpen;
  const [personaPortal] = useState(() => document.createElement('div'));
  const [headerPersonaHost, setHeaderPersonaHost] = useState<HTMLDivElement | null>(null);
  const [sidebarPersonaHost, setSidebarPersonaHost] = useState<HTMLDivElement | null>(null);
  const restorePersonaFocus = useRef(false);
  const isInboxRoute = location.pathname.startsWith('/inbox');
  const shellStyles = ParkShell();
  const title = pageTitle(location.pathname);

  useEffect(() => {
    const media = window.matchMedia?.(DESKTOP_PERSONA_QUERY);
    if (!media) return;
    const onBreakpointChange = () => {
      if (media.matches === desktopPersonaRef.current) return;
      restorePersonaFocus.current = accountMenuOpenRef.current || personaPortal.contains(document.activeElement);
      setAccountMenuOpen(false);
      desktopPersonaRef.current = media.matches;
      setDesktopPersona(media.matches);
    };
    onBreakpointChange();
    media.addEventListener('change', onBreakpointChange);
    return () => media.removeEventListener('change', onBreakpointChange);
  }, [personaPortal]);

  React.useLayoutEffect(() => {
    const destination = desktopPersona ? sidebarPersonaHost : headerPersonaHost;
    if (!destination) return;
    destination.appendChild(personaPortal);
    if (restorePersonaFocus.current) {
      restorePersonaFocus.current = false;
      queueMicrotask(() => personaPortal.querySelector<HTMLButtonElement>('button[aria-label="Account options"]')?.focus());
    }
  }, [desktopPersona, headerPersonaHost, sidebarPersonaHost, personaPortal]);

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
      // A live event can arrive before the first list read has returned. Query
      // invalidation reuses a pending fetch with no cached data, so cancel it
      // first and read the authoritative post-event list.
      void queryClient.cancelQueries({ queryKey: ['tickets'], predicate: query =>
        query.queryKey.length === 3 && typeof query.queryKey[1] === 'object' && query.state.data === undefined,
      }).then(() =>
        queryClient.invalidateQueries({ queryKey: ['tickets'] }));
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
      <div className={cn(shellStyles.root, isInboxRoute ? shellStyles.rootInbox : shellStyles.rootStandard)}>
        <header className={shellStyles.header}>
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

          <div className={shellStyles.headerSearch}><GlobalSearch shortcutsEnabled={preferences.shortcutsEnabled} /></div>

          <ParkPopover.Root open={activityOpen} onOpenChange={({ open }) => openActivity(open)} ids={{content:activityId}} positioning={{placement:'bottom-end',strategy:'fixed'}} finalFocusEl={() => activityTrigger.current} lazyMount unmountOnExit>
            <ParkPopover.Trigger asChild>
              <ParkIconButton ref={activityTrigger} type="button" variant="plain" aria-label={activity?.unread.status === 'available' ? `Activity, ${activity.unread.count} unread` : 'Activity'} aria-expanded={activityOpen} aria-controls={activityId} className={shellStyles.activityTrigger}>
                <Bell className={shellStyles.icon} />
                {activity?.unread.status === 'available' && activity.unread.count > 0 && <span aria-hidden="true" className={shellStyles.activityBadge}>{activity.unread.count > 99 ? '99+' : activity.unread.count}</span>}
              </ParkIconButton>
            </ParkPopover.Trigger>
            <ParkPopover.Positioner>
              <ParkPopover.Content aria-label="Activity" className={shellStyles.activityPopover}>
                <ParkPopover.Header className={shellStyles.activityHeader}><ParkPopover.Title className={shellStyles.activityTitle}>Activity</ParkPopover.Title><ParkButton type="button" onClick={() => void loadActivity()} disabled={activityLoading} className={shellStyles.activityRefresh}>Refresh</ParkButton></ParkPopover.Header>
                {activityUpdatesAvailable && <ParkAlert.Root role="status" status="info"><ParkAlert.Content><ParkAlert.Description>Updates available. Refresh to load current activity.</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
                {activityError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content>
                  <ParkAlert.Description>{activityError}</ParkAlert.Description>
                  <ParkButton type="button" onClick={() => void (activityRetry === 'more' ? loadMoreActivity() : loadActivity())} disabled={activityLoading}>Retry loading activity</ParkButton>
                </ParkAlert.Content></ParkAlert.Root>}
                {activityLoading && !activity && <section role="status" aria-label="Loading activity" aria-busy="true" className={shellStyles.activityLoading}>
                  <ParkSkeleton height="4" width="70%" />
                  <ParkSkeleton height="4" width="90%" />
                  <ParkSkeleton height="4" width="55%" />
                  <ParkVisuallyHidden>Loading durable activity…</ParkVisuallyHidden>
                </section>}
                {activity?.unread.status === 'unavailable' && <ParkAlert.Root role="status" status="warning"><ParkAlert.Content><ParkAlert.Description>Unread count is temporarily unavailable. Your activity remains available below.</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
                {activity && visibleActivityItems.length === 0 && <ParkEmptyState title={activity.page.next ? 'No current activity in the loaded items.' : 'No current activity.'} headingLevel={false} className={shellStyles.activityEmpty} />}
                {visibleActivityItems.length > 0 && <ParkScrollArea.Root className={shellStyles.activityScroll}>
                  <ParkScrollArea.Viewport>
                    <ParkScrollArea.Content>
                      <ul aria-label="Durable activity" className={shellStyles.activityList}>
                        {visibleActivityItems.map(item => <li key={item.id} className={shellStyles.activityRow}>
                          <ParkButton type="button" aria-label={`Open ${item.kind.replace(/_/g, ' ')} activity for ${item.ticketSubject ?? `ticket ${item.ticketId}`}`} onClick={async () => { if (!item.readAt) await transitionActivity(item, 'read'); navigate(`/inbox/all/${item.ticketId}`); }} className={shellStyles.activityItem}>
                            <span>{item.kind.replace(/_/g, ' ')}</span>
                            <span className={shellStyles.activitySubject}>{item.ticketSubject ?? `Ticket ${item.ticketId}`}</span>
                            <span>Ticket activity saved {new Date(item.createdAt).toLocaleString()}</span>
                          </ParkButton>
                          <ParkIconButton type="button" variant="plain" aria-label={`Dismiss ${item.kind.replace(/_/g, ' ')} activity for ${item.ticketSubject ?? `ticket ${item.ticketId}`}`} onClick={() => void transitionActivity(item, 'dismiss')} className={shellStyles.activityDismiss}><X className={shellStyles.dismissIcon} /></ParkIconButton>
                        </li>)}
                      </ul>
                    </ParkScrollArea.Content>
                  </ParkScrollArea.Viewport>
                  <ParkScrollArea.Scrollbar orientation="vertical" />
                </ParkScrollArea.Root>}
                {activity && activity.page.items.length >= MAX_RENDERED_ACTIVITY_ITEMS && activity.page.next && <p role="status">Loaded activity limit reached. Refresh to restart activity recovery.</p>}
                {activity && activity.page.items.length < MAX_RENDERED_ACTIVITY_ITEMS && activity.page.next && <div className={shellStyles.activityMoreWrap}><ParkButton type="button" onClick={() => void loadMoreActivity()} disabled={activityLoading} className={shellStyles.activityMore}>{activityLoading ? 'Loading more activity…' : 'Load more activity'}</ParkButton></div>}
                {activity && !activityLoading && visibleActivityItems.length > 0 && <ParkVisuallyHidden role="status">Showing {visibleActivityItems.length} activity item{visibleActivityItems.length === 1 ? '' : 's'}.</ParkVisuallyHidden>}
              </ParkPopover.Content>
            </ParkPopover.Positioner>
          </ParkPopover.Root>

          <div ref={setHeaderPersonaHost} className={shellStyles.headerPersonaHost} />

          {!isConnected && <ParkPopover.Root open={showConnDetails} onOpenChange={({open}) => setShowConnDetails(open)} ids={{content:connectionId}} positioning={{placement:'bottom-end',strategy:'fixed'}} finalFocusEl={() => connectionTrigger.current} lazyMount unmountOnExit>
          <div className={shellStyles.connectionWrap}>
            <ParkPopover.Trigger asChild>
            <ParkButton
              type="button"
              ref={connectionTrigger}
              aria-label="Disconnected"
              aria-expanded={showConnDetails}
              aria-controls={connectionId}
              className={shellStyles.connectionButton}
            >
              <WifiOff aria-hidden="true" className={shellStyles.smallIcon} />
              <span className={shellStyles.connectionLabel}>Disconnected</span>
              <ChevronDown aria-hidden="true" className={cn(shellStyles.connectionChevron, showConnDetails && css({ transform: 'rotate(180deg)' }))} />
            </ParkButton></ParkPopover.Trigger>

            <ParkPopover.Positioner>
              <ParkPopover.Content aria-label="Connection Status" className={shellStyles.connectionPopover}>
                <ParkPopover.Header className={shellStyles.activityHeader}>
                  <ParkPopover.Title asChild><h3 className={shellStyles.activityTitle}>Connection Status</h3></ParkPopover.Title>
                  <div className={shellStyles.connectionDot} data-state={isConnected ? 'connected' : 'disconnected'} />
                </ParkPopover.Header>

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
              </ParkPopover.Content>
            </ParkPopover.Positioner>
          </div>
          </ParkPopover.Root>}
          {connectionRecoveryMessage && <ParkVisuallyHidden role="status" aria-live="polite">{connectionRecoveryMessage}</ParkVisuallyHidden>}
        </header>
        <div className={shellStyles.body}>
          <aside className={shellStyles.sidebarDesktop}>
            <SidebarContent personaHost={setSidebarPersonaHost} />
          </aside>
          <ParkDialog.Root ids={{ content: mobileDialogId }} open={isSidebarOpen} onOpenChange={({ open }) => setIsSidebarOpen(open)}
            initialFocusEl={() => navigationClose.current}
            finalFocusEl={() => restoreNavigationFocus.current ? navigationTrigger.current : main.current}
            closeOnInteractOutside={false} lazyMount unmountOnExit>
            <ParkDialog.Backdrop />
            <ParkDialog.Positioner>
              <ParkDialog.Content aria-labelledby={`${mobileDialogId}-title`}
                className={cn(shellStyles.mobileDialog, preferences.navigation === 'labelled' ? shellStyles.mobileDialogLabelled : shellStyles.mobileDialogCompact)}>
                <ParkVisuallyHidden id={`${mobileDialogId}-title`}>Navigation</ParkVisuallyHidden>
                <div className={css({ display: 'flex', justifyContent: 'flex-end' })}>
                  <ParkButton ref={navigationClose} type="button" aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)}
                    className={shellStyles.mobileClose}><X aria-hidden="true" /></ParkButton>
                </div>
                <div className={shellStyles.mobileContent}><SidebarContent onNavigate={() => { restoreNavigationFocus.current = false; setIsSidebarOpen(false); }} /></div>
              </ParkDialog.Content>
            </ParkDialog.Positioner>
          </ParkDialog.Root>

          <div className={shellStyles.main}>
            <main ref={main} tabIndex={-1} aria-label="Workspace" className={cn(shellStyles.content, isInboxRoute ? shellStyles.contentInbox : shellStyles.contentStandard, !location.pathname.startsWith('/settings') && !location.pathname.startsWith('/knowledge') && !isInboxRoute && shellStyles.contentPadded)}>
              <Outlet />
            </main>
          </div>
        </div>
        {createPortal(<UserMenu onNavigate={() => { setTimeout(() => main.current?.focus(), 50); }} desktop={desktopPersona} labelled={preferences.navigation === 'labelled'} open={accountMenuOpen} onOpenChange={setAccountMenuOpen} />, personaPortal)}
    </div>
  );
}

export function Layout() {
  const { user, sessionGeneration } = useAuthStore();
  const identity = `${sessionGeneration}:${user?.tenant_id ?? ''}:${user?.id ?? ''}`;
  return <OperatorThemeProvider key={identity}><InboxGlobalAlertProvider><LayoutContent /></InboxGlobalAlertProvider></OperatorThemeProvider>;
}

const navigation = [
  { name: 'Dashboard', href: '/', icon: HouseIcon },
  { name: 'Inbox', href: '/inbox', icon: TicketIcon },
  { name: 'Knowledge Base', href: '/knowledge', icon: BooksIcon },
  { name: 'Settings', href: '/settings/general', icon: Settings },
];
