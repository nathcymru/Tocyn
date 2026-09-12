import userEvent from '@testing-library/user-event';
import { dashboardApi } from '../api/client';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Layout } from '../components/layout/Layout';
import { CollaborationProvider } from '../components/CollaborationContext';
import { useRealtime } from '../hooks/useRealtime';
import { useAuthStore } from '../store/authStore';

vi.mock('../hooks/useRealtime', () => ({ useRealtime: vi.fn() }));
vi.mock('../api/client', () => ({ dashboardApi: {
  post: vi.fn(),
  get: vi.fn(async (path: string) => path === '/workspace/theme-preference'
    ? { revision: 0, mode: 'system', updatedAt: null }
    : { version: '1', light: {}, dark: {} }),
  put: vi.fn(),
} }));
let client: QueryClient;
const realtime = { isConnected: true, lastMessage: null, presence: [], updateLocation: vi.fn(), connectionDetails: { latency: 10, reconnectCount: 0 }, manualReconnect: vi.fn() };
function Destination() { const location = useLocation(); return <h1>Route {location.pathname}{location.search}</h1>; }
function tree(initialEntry = '/tickets') {
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

it('names global search, makes its authorised scope available to assistive technology, clears it predictably, and keeps shared navigation reachable', async () => {
  await renderReady();
  expect(screen.getByRole('main', { name: 'Workspace' })).toHaveFocus();
  const search = screen.getByRole('textbox', { name: 'Search all authorised tickets' });
  expect(screen.getByText('Searches all tickets you are authorised to access. Filter this view is available in the Inbox.')).toHaveClass('sr-only');
  fireEvent.change(search, { target: { value: 'Follow up' } }); fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByRole('heading')).toHaveTextContent('/tickets?search=Follow%20up');
  const clear = screen.getByRole('button', { name: 'Clear global ticket search' });
  fireEvent.click(clear);
  expect(screen.getByRole('heading')).toHaveTextContent('Route /tickets');
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
  const search = screen.getByRole('textbox', { name: 'Search all authorised tickets' });
  fireEvent.change(search, { target: { value: 'ticket subject' } });
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(search).toHaveFocus();
  expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  expect(screen.getByText(/Press Command or Control K to focus this search/)).toHaveClass('sr-only');
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(search).toHaveFocus();
});

it('constrains the inbox shell to the viewport while keeping the shared header visible', async () => {
  render(tree('/inbox/all/synthetic-ticket'));
  const main = await screen.findByRole('main', { name: 'Workspace' });
  const shell = main.parentElement?.parentElement;
  expect(shell).toHaveClass('h-dvh', 'min-h-0', 'overflow-hidden');
  expect(main).toHaveClass('flex-1', 'min-h-0', 'overflow-hidden');
  expect(main).not.toHaveClass('h-[calc(100dvh-4rem)]');
  expect(main.previousElementSibling).toHaveClass('h-16', 'shrink-0');
});

it('names account/connection disclosures and restores focus when their child actions close', async () => {
  const result=await renderReady();
  const account = screen.getByRole('button', { name: 'Account options' });
  await userEvent.click(account); expect(account).toHaveAttribute('aria-expanded', 'true');
  const security = await screen.findByRole('link', { name: 'Security Profile' });
  await waitFor(() => expect(security).toHaveFocus()); await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(account).toHaveFocus()); expect(account).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button',{name:'Real-time'})).not.toBeInTheDocument();
  vi.mocked(useRealtime).mockReturnValue({...realtime,isConnected:false} as ReturnType<typeof useRealtime>);
  act(()=>result.rerender(tree()));
  const connection = screen.getByRole('button', { name: 'Disconnected' });
  await userEvent.click(connection); expect(connection).toHaveAttribute('aria-expanded', 'true');
  const reconnect = await screen.findByRole('button', { name: 'Force Reconnect' });
  await waitFor(() => expect(reconnect).toHaveFocus()); await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(connection).toHaveFocus()); expect(connection).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(connection); fireEvent.click(screen.getByRole('button', { name: 'Force Reconnect' }));
  expect(realtime.manualReconnect).toHaveBeenCalledTimes(1); await waitFor(() => expect(connection).toHaveFocus());
});

it('closes mobile navigation after a selected destination and focuses the workspace', async () => {
  await renderReady(); fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Navigation' })).getByRole('link', { name: 'Dashboard home' }));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('main', { name: 'Workspace' })).toHaveFocus();
  expect(screen.getByRole('heading')).toHaveTextContent('Route /');
});

it('exposes native notification open and dismiss actions without changing realtime invalidation', async () => {
  const result = await renderReady();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.mocked(useRealtime).mockReturnValue({ ...realtime, lastMessage: { type: 'ticket.created', payload: { id: 'synthetic-ticket', subject: 'Synthetic arrival' } } } as ReturnType<typeof useRealtime>);
  act(() => result.rerender(tree()));
  const open = screen.getByRole('button', { name: 'Open ticket notification: New Ticket' });
  expect(open.tagName).toBe('BUTTON');
  expect(screen.getByRole('status')).toHaveTextContent('New Ticket');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ticket', 'synthetic-ticket'] });
  fireEvent.click(open);
  expect(screen.getByRole('heading')).toHaveTextContent('/inbox/all/synthetic-ticket');
  expect(screen.getByRole('main', { name: 'Workspace' })).toHaveFocus();
});

it('keeps a focused notification available and returns focus when it is dismissed', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(useRealtime).mockReturnValue({ ...realtime, lastMessage: { type: 'ticket.created', payload: { id: 'synthetic-ticket', subject: 'Synthetic arrival' } } } as ReturnType<typeof useRealtime>);
    render(tree());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    const dismiss = screen.getByRole('button', { name: 'Dismiss ticket notification' });
    dismiss.focus(); act(() => vi.advanceTimersByTime(8_000));
    expect(dismiss).toHaveFocus();
    fireEvent.click(dismiss);
    expect(screen.queryByRole('button', { name: 'Dismiss ticket notification' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveFocus();
  } finally { vi.useRealTimers(); }
});

it('navigates from the account popover without stealing destination focus', async () => {
  await renderReady(); await userEvent.click(screen.getByRole('button', { name: 'Account options' }));
  const destination = await screen.findByRole('link', { name: 'Security Profile' });
  await userEvent.click(destination);
  await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('/profile/security'));
  await waitFor(() => expect(screen.getByRole('main', { name: 'Workspace' })).toHaveFocus());
});

it('guards overlapping sign-outs and still clears local authentication when server sign-out fails', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  let reject!: (error: Error) => void;
  vi.mocked(dashboardApi.post).mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
  await renderReady(); await userEvent.click(screen.getByRole('button', { name: 'Account options' }));
  const signOut = await screen.findByRole('button', { name: 'Sign out of all sessions' });
  fireEvent.click(signOut); fireEvent.click(signOut); expect(dashboardApi.post).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Synthetic failure')));
  expect(useAuthStore.getState().user).toBeNull();
  expect(screen.getByRole('heading')).toHaveTextContent('/login');
  expect(alert).toHaveBeenCalledWith(expect.stringContaining('Server sign-out could not be confirmed'));
});

it('keeps nested account content fixed-positioned and dismisses it before mobile navigation', async () => {
  await renderReady(); await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  const navigation=await screen.findByRole('dialog',{name:'Navigation'});
  await waitFor(()=>expect(within(navigation).getByRole('button',{name:'Close navigation'})).toHaveFocus());
  const account=within(navigation).getByRole('button',{name:'Account options'});
  await userEvent.click(account);
  const security=await within(navigation).findByRole('link',{name:'Security Profile'});
  await waitFor(()=>expect(security).toHaveFocus());
  const positioner=security.closest('[data-scope="popover"][data-part="positioner"]');
  expect(positioner).toHaveStyle({position:'fixed'});
  await userEvent.keyboard('{Escape}');
  await waitFor(()=>expect(account).toHaveFocus());
  expect(screen.getByRole('dialog',{name:'Navigation'})).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Navigation'})).not.toBeInTheDocument());
  await waitFor(()=>expect(screen.getByRole('button',{name:'Open navigation'})).toHaveFocus());
});
