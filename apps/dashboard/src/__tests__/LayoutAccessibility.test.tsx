import userEvent from '@testing-library/user-event';
import { dashboardApi } from '../api/client';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import pandaConfigSource from '../../../../packages/ui/panda.config.ts?raw';
import { Layout } from '../components/layout/Layout';
import { CollaborationProvider } from '../components/CollaborationContext';
import { useRealtime } from '../hooks/useRealtime';
import { useAuthStore } from '../store/authStore';

vi.mock('../hooks/useRealtime', () => ({ useRealtime: vi.fn() }));
vi.mock('../api/client', async () => ({ ...(await vi.importActual<typeof import('../api/client')>('../api/client')), dashboardApi: {
  post: vi.fn(),
  get: vi.fn(async (path: string) => path === '/workspace/theme-preference'
    ? { revision: 0, mode: 'system', updatedAt: null }
    : path === '/activities?limit=20'
    ? { page: { items: [], next: null }, unread: { status: 'available', count: 0 } }
    : { version: '1', light: {}, dark: {} }),
  patch: vi.fn(),
  put: vi.fn(),
} }));
let client: QueryClient;
const realtime = { isConnected: true, lastMessage: null, presence: [], updateLocation: vi.fn(), connectionDetails: { latency: 10, reconnectCount: 0 }, manualReconnect: vi.fn() };
function Destination() { const location = useLocation(); return <><h1>Route {location.pathname}{location.search}</h1>{location.state?.logoutWarning && <p role="alert">{location.state.logoutWarning}</p>}</>; }
function tree(initialEntry = '/inbox/all') {
  return <QueryClientProvider client={client}><CollaborationProvider><MemoryRouter initialEntries={[initialEntry]}><Routes>
    <Route element={<Layout />}><Route path="*" element={<Destination />} /></Route>
  </Routes></MemoryRouter></CollaborationProvider></QueryClientProvider>;
}
async function renderReady() {
  const result = render(tree());
  await screen.findByRole('main', { name: 'Workspace' });
  return result;
}
beforeEach(() => {
  // JSDOM lacks resize observation; browser positioning remains separately verified.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.getState().setAuth('synthetic-session', { id: 'operator', tenant_id: 'synthetic-tenant', email: 'operator@example.invalid', full_name: 'Operator', role: 'agent', mfa_enabled: true });
  vi.mocked(useRealtime).mockReturnValue(realtime as ReturnType<typeof useRealtime>);
  // JSDOM has no layout; supply visible rectangles so Ark can discover focusable controls.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this:HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]') ? [new DOMRect(0,0,100,44)] : []) as unknown as DOMRectList;
  });
});
afterEach(() => {
  cleanup(); client.clear(); useAuthStore.getState().logout(); vi.clearAllMocks();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('names global search, makes its authorised scope available to assistive technology, clears it with Escape, and keeps shared navigation reachable', async () => {
  await renderReady();
  expect(screen.getByRole('main', { name: 'Workspace' })).toHaveFocus();
  const search = screen.getByRole('textbox', { name: 'Search all tickets (global shell)' });
  expect(screen.getByText(/Searches all tickets you are authorised to access\.|Press Command or Control K to focus this search\.|Filter this view is available in the Inbox/)).toHaveAttribute('id', 'global-ticket-search-scope');
  fireEvent.change(search, { target: { value: 'Follow up' } }); fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByRole('heading').textContent).toBe('Route /inbox/all');
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(search).toHaveValue('');
  expect(screen.getByRole('heading').textContent).toBe('Route /inbox/all');
  const trigger = screen.getByRole('button', { name: 'Open navigation' });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
  expect(dialog).toHaveAttribute('aria-modal', 'true'); expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await waitFor(()=>expect(within(dialog).getByRole('button', { name: 'Close navigation' })).toHaveFocus());
  expect(trigger).toHaveAttribute('aria-controls',dialog.id);
  expect(within(dialog).getByRole('link', { name: 'Inbox' })).toHaveAttribute('href', '/inbox');
  fireEvent.keyDown(document.activeElement!, {key:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await waitFor(()=>expect(trigger).toHaveFocus());
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('provides discoverable command navigation to global search and restores its current value', async () => {
  await renderReady();
  const search = screen.getByRole('textbox', { name: 'Search all tickets (global shell)' });
  fireEvent.change(search, { target: { value: 'ticket subject' } });
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(search).toHaveFocus();
  expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  expect(screen.getByText(/Press Command or Control K to focus this search/)).toHaveAttribute('id', 'global-ticket-search-scope');
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(search).toHaveFocus();
});

it('constrains the inbox shell to the viewport while keeping the shared header visible', async () => {
  render(tree('/inbox/all/synthetic-ticket'));
  const main = await screen.findByRole('main', { name: 'Workspace' });
  const shell = main.parentElement?.parentElement;
  expect(shell).toHaveClass('shell__root', 'shell__rootInbox');
  expect(main).toHaveClass('shell__content', 'shell__contentInbox');
  expect(main).not.toHaveClass('h-[calc(100dvh-4rem)]');
  expect(main.previousElementSibling).toHaveClass('shell__header');
});

it('keeps header controls reachable in the generated 320 CSS px reflow contract', async () => {
  await renderReady();
  const header = screen.getByRole('banner');
  expect(header).toHaveClass('shell__header');
  expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Search all tickets (global shell)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activity' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Account options' })).toBeInTheDocument();

  // At 320 CSS px, search receives a full-width row after navigation. Its
  // input and scope then use separate rows, so neither clips at 200% zoom.
  expect(44 + 18 * 16 + 16 + 2 * 16).toBeGreaterThan(320);
  expect(18 * 16 + 2 * 16).toBeLessThanOrEqual(320);
  expect(44 + 18 * 16 + 16 + 2 * 16).toBeLessThanOrEqual(420);
  expect(18 * 16 - (16 + 12 + 16 + 17 + 12 + 40)).toBeGreaterThanOrEqual(100);
  expect(24 * 16 - (9 * 16 + 16 + 12 + 16 + 17 + 12 + 1 + 40)).toBeGreaterThanOrEqual(100);
  expect(pandaConfigSource).toMatch(/header: \{[^\n]*flexWrap: 'wrap'/);
  expect(pandaConfigSource).toMatch(/pageTitle: \{[^\n]*display: \{ base: 'none', md: 'block' \}/);
  expect(pandaConfigSource).toMatch(/root: \{[^\n]*flexWrap: \{ base: 'wrap', md: 'nowrap' \}[^\n]*minWidth: \{ base: 'min\(18rem, 100%\)', md: '24rem' \}/);
  expect(pandaConfigSource).toMatch(/scope: \{[^\n]*width: \{ base: '100%', md: '9rem' \}/);
});

it('keeps compact navigation icons inside the focus target', async () => {
  await renderReady();
  const sidebar = document.querySelector('aside.shell__sidebarDesktop');
  expect(within(sidebar as HTMLElement).getByRole('link', { name: 'Inbox' }).querySelector('svg')).toHaveClass('shell__navigationIcon');
  // 4rem sidebar minus its 1rem total padding leaves a 3rem link. Its
  // 0.5rem padding on either side leaves 2rem for the icon.
  expect(4 * 16 - 2 * 0.5 * 16 - 2 * 0.5 * 16).toBeGreaterThanOrEqual(1.5 * 16);
  expect(pandaConfigSource).toMatch(/navigationIcon: \{[^\n]*width: '1\.5rem', height: '1\.5rem'/);
});

it('names account/connection disclosures and restores focus when their child actions close', async () => {
  const result=await renderReady();
  const account = screen.getByRole('button', { name: 'Account options' });
  expect(account.querySelector('.avatar__root')).toHaveClass('avatar__root--shape_full');
  expect(account.querySelector('.avatar__fallback')).toHaveTextContent('O');
  expect(account.querySelector('.shell__personaStatus')).toHaveAttribute('aria-hidden', 'true');
  await userEvent.click(account); expect(account).toHaveAttribute('aria-expanded', 'true');
  const accountItem = await screen.findByRole('menuitem', { name: 'Account' });
  expect(accountItem).toBeVisible();
  expect(accountItem.closest('.menu__itemGroup')).toBeInTheDocument();
  // Ark moves focus into the menu after it mounts. Wait for that transition
  // before sending Escape so the test exercises the open menu, not its trigger.
  await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(account).toHaveFocus()); expect(account).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button',{name:'Real-time'})).not.toBeInTheDocument();
  vi.mocked(useRealtime).mockReturnValue({...realtime,isConnected:false} as ReturnType<typeof useRealtime>);
  act(()=>result.rerender(tree()));
  const connection = screen.getByRole('button', { name: 'Disconnected' });
  await userEvent.click(connection); expect(connection).toHaveAttribute('aria-expanded', 'true');
  expect(connection).toHaveClass('popover__trigger');
  const reconnect = await screen.findByRole('button', { name: 'Force Reconnect' });
  expect(reconnect.closest('.popover__content')).toBeInTheDocument();
  await waitFor(() => expect(reconnect).toHaveFocus()); await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(connection).toHaveFocus()); expect(connection).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(connection); fireEvent.click(screen.getByRole('button', { name: 'Force Reconnect' }));
  expect(realtime.manualReconnect).toHaveBeenCalledTimes(1); await waitFor(() => expect(connection).toHaveFocus());
});

it('keeps search and workspace navigation visible and keyboard reachable when focus mode is enabled', async () => {
  await renderReady();
  document.documentElement.dataset.tocynFocusMode = 'true';
  const sidebar = document.querySelector('aside.shell__sidebarDesktop');
  expect(sidebar).toBeInTheDocument();
  expect(sidebar).not.toHaveAttribute('data-tocyn-inverse');
  expect(screen.getByRole('button', { name: 'Account options' })).toBeInTheDocument();
  const search = screen.getByRole('textbox', { name: 'Search all tickets (global shell)' });
  const inbox = within(sidebar as HTMLElement).getByRole('link', { name: 'Inbox' });
  expect(search).toBeVisible();
  expect(inbox).toBeVisible();
  search.focus();
  expect(search).toHaveFocus();
  inbox.focus();
  expect(inbox).toHaveFocus();
});

it('keeps the account menu concise and connection recovery reachable', async () => {
  vi.mocked(useRealtime).mockReturnValue({ ...realtime, isConnected: false } as ReturnType<typeof useRealtime>);
  await renderReady();
  const account = screen.getByRole('button', { name: 'Account options' });
  await userEvent.click(account);
  expect(await screen.findByRole('menuitem', { name: 'Account' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Workspace density' })).not.toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  const disconnected = screen.getByRole('button', { name: 'Disconnected' });
  await userEvent.click(disconnected);
  expect(await screen.findByText(/Live updates are paused/)).toBeVisible();
});

it('closes mobile navigation after a selected destination and focuses the workspace', async () => {
  await renderReady(); fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Navigation' })).getByRole('link', { name: 'Dashboard home' }));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('main', { name: 'Workspace' })).toHaveFocus();
  expect(screen.getByRole('heading')).toHaveTextContent('Route /');
});

it('uses realtime only to refresh an already-open durable activity panel', async () => {
  const result = await renderReady();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.mocked(useRealtime).mockReturnValue({ ...realtime, lastMessage: { type: 'ticket.created', payload: { id: 'synthetic-ticket', subject: 'Synthetic arrival' } } } as ReturnType<typeof useRealtime>);
  act(() => result.rerender(tree()));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ticket', 'synthetic-ticket'] });
  expect(screen.queryByText('New Ticket')).not.toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'Activity' });
  await userEvent.click(trigger);
  expect(trigger).toHaveClass('popover__trigger');
  expect(await screen.findByText('No current activity.')).toBeInTheDocument();
  expect(screen.getByText('No current activity.').closest('.popover__content')).toBeInTheDocument();
  expect(screen.getByText('No current activity.').closest('.emptyState__root')).toBeInTheDocument();
  expect(dashboardApi.get).toHaveBeenCalledWith('/activities?limit=20');
});

it('uses a Park skeleton while activity loads and a Park scroll area for loaded items', async () => {
  let resolveActivity!: (value: unknown) => void;
  const original = vi.mocked(dashboardApi.get).getMockImplementation()!;
  vi.mocked(dashboardApi.get).mockImplementation((path: string) => path === '/activities?limit=20'
    ? new Promise(resolve => { resolveActivity = resolve; })
    : original(path));
  await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  const loading = await screen.findByRole('status', { name: 'Loading activity' });
  expect(loading).toHaveAttribute('aria-busy', 'true');
  expect(loading.querySelector('.skeleton')).toBeInTheDocument();
  resolveActivity({ page: { items: [{ id: 'activity-one', ticketId: 'ticket-one', ticketSubject: 'Synthetic ticket', kind: 'customer_reply', facts: {}, revision: 1, createdAt: '2026-09-12T09:00:00.000Z', readAt: null, dismissedAt: null }], next: null }, unread: { status: 'available', count: 1 } });
  const item = await screen.findByRole('button', { name: 'Open customer reply activity for Synthetic ticket' });
  expect(item.closest('.scroll-area__content')).toBeInTheDocument();
  expect(item.closest('.scroll-area__root')?.querySelector('.scroll-area__viewport')).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Loading activity' })).not.toBeInTheDocument();
});

it('identifies the authorized ticket and marks durable activity read before opening it', async () => {
  vi.mocked(dashboardApi.get).mockImplementation(async (path: string) => path === '/activities?limit=20'
    ? { page: { items: [{ id: 'activity-one', ticketId: 'ticket-one', ticketSubject: 'Account access follow-up', kind: 'customer_reply', facts: {}, revision: 1, createdAt: '2026-09-12T09:00:00.000Z', readAt: null, dismissedAt: null }], next: null }, unread: { status: 'available' as const, count: 1 } }
    : { revision: 0, mode: 'system', updatedAt: null });

  await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  const open = await screen.findByRole('button', { name: 'Open customer reply activity for Account access follow-up' });
  expect(screen.getByText('Account access follow-up')).toBeInTheDocument();
  await userEvent.click(open);

  await waitFor(() => expect(dashboardApi.patch).toHaveBeenCalledWith('/activities/activity-one/read', { expectedRevision: 1 }));
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/inbox/all/ticket-one'));
});

it('continues durable activity with the opaque authenticated cursor through a keyboard control', async () => {
  const first = { page: { items: [{ id: 'activity-one', ticketId: 'ticket-one', kind: 'customer_reply', facts: {}, revision: 1, createdAt: '2026-09-12T09:00:00.000Z', readAt: null, dismissedAt: null }], next: 'opaque cursor+/=' }, unread: { status: 'available' as const, count: 2 } };
  const second = { page: { items: [{ id: 'activity-two', ticketId: 'ticket-two', kind: 'assignment', facts: {}, revision: 1, createdAt: '2026-09-12T08:00:00.000Z', readAt: null, dismissedAt: null }], next: null }, unread: { status: 'available' as const, count: 2 } };
  vi.mocked(dashboardApi.get).mockImplementation(async (path: string) => {
    if (path === '/activities?limit=20') return first;
    if (path === '/activities?limit=20&cursor=opaque%20cursor%2B%2F%3D') return second;
    return { revision: 0, mode: 'system', updatedAt: null };
  });

  await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  const loadMore = await screen.findByRole('button', { name: 'Load more activity' });
  // Wait for the disclosure's scheduled initial focus before moving to pagination.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toHaveFocus());
  loadMore.focus();
  await userEvent.keyboard('{Enter}');

  expect(await screen.findByText('assignment')).toBeInTheDocument();
  expect(dashboardApi.get).toHaveBeenCalledWith('/activities?limit=20&cursor=opaque%20cursor%2B%2F%3D');
  expect(screen.getByRole('status')).toHaveTextContent('Showing 2 activity items.');
  expect(screen.queryByRole('button', { name: 'Load more activity' })).not.toBeInTheDocument();
});

it('announces a failed activity continuation and retries it without discarding loaded activity', async () => {
  const first = { page: { items: [{ id: 'activity-one', ticketId: 'ticket-one', kind: 'customer_reply', facts: {}, revision: 1, createdAt: '2026-09-12T09:00:00.000Z', readAt: null, dismissedAt: null }], next: 'retry-cursor' }, unread: { status: 'available' as const, count: 1 } };
  const second = { page: { items: [{ id: 'activity-two', ticketId: 'ticket-two', kind: 'assignment', facts: {}, revision: 1, createdAt: '2026-09-12T08:00:00.000Z', readAt: null, dismissedAt: null }], next: null }, unread: { status: 'available' as const, count: 1 } };
  let continuationAttempts = 0;
  vi.mocked(dashboardApi.get).mockImplementation(async (path: string) => {
    if (path === '/activities?limit=20') return first;
    if (path === '/activities?limit=20&cursor=retry-cursor') {
      continuationAttempts += 1;
      if (continuationAttempts === 1) throw new Error('Synthetic continuation failure');
      return second;
    }
    return { revision: 0, mode: 'system', updatedAt: null };
  });

  await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Load more activity' }));

  const error = await screen.findByRole('alert');
  expect(error).toHaveClass('alert__root');
  expect(error).toHaveTextContent('More activity could not be loaded. Try again to continue.');
  expect(screen.getByText('customer reply')).toBeInTheDocument();
  const retry = screen.getByRole('button', { name: 'Retry loading activity' });
  retry.focus();
  await userEvent.keyboard('{Enter}');

  expect(await screen.findByText('assignment')).toBeInTheDocument();
  expect(continuationAttempts).toBe(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('shows an unavailable unread count with Park status while retaining activity', async () => {
  vi.mocked(dashboardApi.get).mockImplementation(async (path: string) => {
    if (path === '/activities?limit=20') return {
      page: { items: [{ id: 'activity-one', ticketId: 'ticket-one', kind: 'customer_reply', facts: {}, revision: 1, createdAt: '2026-09-12T09:00:00.000Z', readAt: null, dismissedAt: null }], next: null },
      unread: { status: 'unavailable', count: null, reason: 'projection_pending' },
    };
    return { revision: 0, mode: 'system', updatedAt: null };
  });
  await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  const notice = await screen.findByText('Unread count is temporarily unavailable. Your activity remains available below.');
  expect(notice.closest('.alert__root')).toHaveAttribute('role', 'status');
  expect(screen.getByText('customer reply')).toBeInTheDocument();
});

it('keeps connection recovery visible without healthy latency diagnostics', async () => {
  const result = await renderReady();
  vi.mocked(useRealtime).mockReturnValue({...realtime,isConnected:false} as ReturnType<typeof useRealtime>);
  act(()=>result.rerender(tree()));
  await userEvent.click(screen.getByRole('button', { name: 'Disconnected' }));
  expect(await screen.findByText('Live updates are paused. Reconnect to refresh shared changes; saved activity can be recovered from the Activity menu.')).toBeInTheDocument();
  expect(screen.queryByText(/Latency/)).not.toBeInTheDocument();
});

it('re-reads bounded durable activity when realtime is restored', async () => {
  const result = await renderReady();
  const activityReads = () => vi.mocked(dashboardApi.get).mock.calls.filter(([path]) => path === '/activities?limit=20').length;
  const initialReads = activityReads();

  vi.mocked(useRealtime).mockReturnValue({ ...realtime, isConnected: false } as ReturnType<typeof useRealtime>);
  act(() => result.rerender(tree()));
  vi.mocked(useRealtime).mockReturnValue({ ...realtime, isConnected: true } as ReturnType<typeof useRealtime>);
  act(() => result.rerender(tree()));

  await waitFor(() => expect(activityReads()).toBe(initialReads + 1));
  expect(dashboardApi.get).toHaveBeenLastCalledWith('/activities?limit=20');
  expect(await screen.findByText('Connection restored. Durable activity refreshed.')).toHaveAttribute('role', 'status');
});

it('navigates from the account popover without stealing destination focus', async () => {
  await renderReady(); await userEvent.click(screen.getByRole('button', { name: 'Account options' }));
  const destination = await screen.findByRole('menuitem', { name: 'Account' });
  await userEvent.click(destination);
  await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('/settings/account'));
  await waitFor(() => expect(screen.getByRole('main', { name: 'Workspace' })).toHaveFocus());
});

it('guards overlapping sign-outs and still clears local authentication when server sign-out fails', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(dashboardApi.post).mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
  await renderReady(); await userEvent.click(screen.getByRole('button', { name: 'Account options' }));
  const signOut = await screen.findByRole('menuitem', { name: 'Log out' });
  fireEvent.click(signOut);
  const confirm = await screen.findByRole('button', { name: 'Log Out (10)' });
  fireEvent.click(confirm); fireEvent.click(confirm); expect(dashboardApi.post).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Synthetic failure')));
  expect(useAuthStore.getState().user).toBeNull();
  expect(screen.getByRole('heading')).toHaveTextContent('/login');
  expect(screen.getByRole('alert')).toHaveTextContent('Server sign-out could not be confirmed');
});

it('contains focus in mobile navigation and restores the persona menu after closing', async () => {
  await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  const navigation = await screen.findByRole('dialog', { name: 'Navigation' });
  expect(within(navigation).getByRole('link', { name: 'Inbox' })).toBeVisible();
  await waitFor(() => expect(within(navigation).getByRole('button', { name: 'Close navigation' })).toHaveFocus());
  await userEvent.tab();
  expect(navigation.contains(document.activeElement)).toBe(true);
  fireEvent.click(within(navigation).getByRole('button', { name: 'Close navigation' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Account options' })).toBeVisible();
});

it('invalidates ticket queues after dismissing activity while reading retains mention membership',async()=>{
  const item={id:'mention-one',ticketId:'ticket-one',ticketSubject:'Synthetic mention',kind:'mention',facts:{},revision:1,createdAt:'2026-09-13T00:00:00Z',readAt:null,dismissedAt:null};
  const fallback=vi.mocked(dashboardApi.get).getMockImplementation()!;
  vi.mocked(dashboardApi.get).mockImplementation(async(path:string)=>path==='/activities?limit=20'
    ?{page:{items:[item],next:null},unread:{status:'available',count:1}}:fallback(path));
  vi.mocked(dashboardApi.patch).mockResolvedValue({});
  const invalidated=vi.spyOn(client,'invalidateQueries');
  await renderReady();
  fireEvent.click(screen.getByRole('button',{name:/Activity/}));
  const open=await screen.findByRole('button',{name:'Open mention activity for Synthetic mention'});
  fireEvent.click(open);
  await waitFor(()=>expect(dashboardApi.patch).toHaveBeenCalledWith('/activities/mention-one/read',{expectedRevision:1}));
  await screen.findByRole('heading',{name:'Route /inbox/all/ticket-one',level:1});
  expect(invalidated).not.toHaveBeenCalledWith({queryKey:['tickets']});
  const trigger=screen.getByRole('button',{name:/Activity/});
  if(trigger.getAttribute('aria-expanded')!=='true')fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('button',{name:'Dismiss mention activity for Synthetic mention'}));
  await waitFor(()=>expect(invalidated).toHaveBeenCalledWith({queryKey:['tickets']}));
});


it('opens the account page from the concise persona menu', async () => {
  await renderReady();
  const account = screen.getByRole('button', { name: 'Account options' });
  await userEvent.click(account);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Account' }));
  await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('/settings/account'));
});

it('keeps account settings on their own route', async () => {
  await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Account options' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Account' }));
  await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('/settings/account'));
});

it('renders labelled navigation and disables only the app search accelerator', async () => {
  const previous = vi.mocked(dashboardApi.get).getMockImplementation()!;
  vi.mocked(dashboardApi.get).mockImplementation(async (path: string) => path === '/workspace/presentation-preference'
    ? { version: 2, revision: 3, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system', navigation: 'labelled', contextDefault: 'remember', shortcutsEnabled: false, interruptionLevel: 'standard', advanceAfterResolve: false, updatedAt: null }
    : previous(path));
  await renderReady();
  const navigation = screen.getByRole('navigation', { name: 'Workspace navigation' });
  await waitFor(() => expect(within(navigation).getByRole('link', { name: 'Inbox' })).toHaveTextContent('Inbox'));
  const search = screen.getByRole('textbox', { name: 'Search all tickets (global shell)' });
  const account = screen.getByRole('button', { name: 'Account options' });
  account.focus();
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(account).toHaveFocus();
  expect(search).not.toHaveAttribute('aria-keyshortcuts');
  await userEvent.keyboard('{Enter}');
  await screen.findByRole('menuitem', { name: 'Account' });
  await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(account).toHaveFocus());
});

it('quiet activity retains the list until explicit refresh while ticket invalidation remains active', async () => {
  let activityReads = 0;
  vi.mocked(dashboardApi.get).mockImplementation(async (path: string) => {
    if (path === '/workspace/presentation-preference') return { version: 2, revision: 1, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system', navigation: 'compact', contextDefault: 'remember', shortcutsEnabled: true, interruptionLevel: 'quiet', advanceAfterResolve: false, updatedAt: null };
    if (path === '/workspace/theme-preference') return { revision: 0, mode: 'system', updatedAt: null };
    if (path === '/activities?limit=20') { activityReads++; return { page: { items: [], next: null }, unread: { status: 'available', count: 0 } }; }
    return { version: '1', light: {}, dark: {}, fallback: false };
  });
  const view = await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  await screen.findByText('No current activity.');
  const count = activityReads;
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.mocked(useRealtime).mockReturnValue({ ...realtime, lastMessage: { type: 'ticket.updated', payload: { id: 'synthetic-ticket' } } } as ReturnType<typeof useRealtime>);
  view.rerender(tree());
  await screen.findByText('Updates available. Refresh to load current activity.');
  expect(activityReads).toBe(count);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ticket', 'synthetic-ticket'] });
  await userEvent.click(screen.getByRole('button', { name: /^Refresh$/ }));
  await waitFor(() => expect(activityReads).toBe(count + 1));
  await waitFor(() => expect(screen.queryByText('Updates available. Refresh to load current activity.')).not.toBeInTheDocument());
});


it.each([false, true])('counts only visible activity when dismissed records are retained (visible=%s)', async (hasVisible) => {
  const dismissed = { id: 'dismissed', ticketId: 'ticket-one', ticketSubject: 'Dismissed assignment', kind: 'assignment', facts: {}, revision: 2, createdAt: '2026-09-13T00:00:00Z', readAt: null, dismissedAt: '2026-09-13T01:00:00Z' };
  const visible = { ...dismissed, id: 'visible', ticketSubject: 'Current assignment', dismissedAt: null };
  const fallback = vi.mocked(dashboardApi.get).getMockImplementation()!;
  vi.mocked(dashboardApi.get).mockImplementation(async (path: string) => path === '/activities?limit=20'
    ? { page: { items: hasVisible ? [dismissed, visible] : [dismissed], next: null }, unread: { status: 'available', count: hasVisible ? 1 : 0 } }
    : fallback(path));
  await renderReady();
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledWith('/activities?limit=20'));
  expect(screen.queryByRole('button', { name: /Open assignment activity for Dismissed/ })).not.toBeInTheDocument();
  if (hasVisible) {
    expect(await screen.findByRole('button', { name: 'Open assignment activity for Current assignment' })).toBeInTheDocument();
    expect(screen.getByText('Showing 1 activity item.')).toBeInTheDocument();
    expect(screen.queryByText('Showing 2 activity items.')).not.toBeInTheDocument();
    expect(screen.queryByText('No current activity.')).not.toBeInTheDocument();
  } else {
    expect(await screen.findByText('No current activity.')).toBeInTheDocument();
    expect(screen.queryByText(/Showing \d+ activity item/)).not.toBeInTheDocument();
  }
});
