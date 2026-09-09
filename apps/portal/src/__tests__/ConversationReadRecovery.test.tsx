import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { portalApi } from '../api/client';

vi.mock('../api/client', () => ({ portalApi: { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), download: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });
const ticket = { id: 'ticket', subject: 'Conversation', status: 'open', priority: 'normal', ticket_no: 1, created_at: '2026-09-09 00:00:00' };
const page = (id: string, next = 'cursor') => ({
  ticket,
  articles: [{ id, body: id, sender_type: 'customer', created_at: ticket.created_at, attachments: [] }],
  pagination: { has_more: Boolean(next), next_cursor: next || null }
});
function deferred() {
  let resolve!: (value: ReturnType<typeof page>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ReturnType<typeof page>>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function mount() {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.mocked(portalApi.get).mockImplementation(async path => (path === '/config' ? { TICKET_PREFIX: '#' } : page('Initial message')) as never);
  render(<MemoryRouter initialEntries={['/tickets/ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage />} /></Routes></MemoryRouter>);
  await screen.findByText('Initial message');
}
function refresh() { fireEvent(document, new Event('visibilitychange')); }

describe('conversation read ownership during overlapping refresh and pagination', () => {
  it('ignores an older refresh error after the newer refresh succeeds', async () => {
    await mount();
    const old = deferred();
    vi.mocked(portalApi.get).mockImplementationOnce(() => old.promise as never);
    refresh();
    vi.mocked(portalApi.get).mockResolvedValueOnce(page('Newest message'));
    refresh();
    await screen.findByText('Newest message');
    await act(async () => { old.reject(new Error('Stale refresh failure')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status', { name: 'Message pagination' }).textContent).toContain('Showing 1 messages');
    expect(screen.getByText('Newest message')).toBeTruthy();
  });

  it('keeps a newer page busy when an older refresh fails and completes the page normally', async () => {
    await mount();
    const old = deferred();
    vi.mocked(portalApi.get).mockImplementationOnce(() => old.promise as never);
    refresh();
    const current = deferred();
    vi.mocked(portalApi.get).mockImplementationOnce(() => current.promise as never);
    fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
    await act(async () => { old.reject(new Error('Stale refresh failure')); });
    const busy = screen.getByRole('button', { name: 'Loading messages…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { current.resolve(page('Next message', '')); });
    expect(screen.getByText('Initial message')).toBeTruthy();
    expect(screen.getByText('Next message')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All messages loaded' })).toBe(busy);
  });

  it('clears the superseded page indicator when the current refresh fails and permits a read retry', async () => {
    await mount();
    const oldPage = deferred();
    vi.mocked(portalApi.get).mockImplementationOnce(() => oldPage.promise as never);
    fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
    vi.mocked(portalApi.get).mockRejectedValueOnce(new Error('Current refresh failed'));
    refresh();
    await screen.findByRole('alert');
    expect(screen.getByRole('status', { name: 'Message pagination' }).textContent).toContain('Could not refresh');
    expect(screen.getByRole('button', { name: 'Load more messages' }).getAttribute('aria-disabled')).toBe('false');
    const retry = deferred();
    vi.mocked(portalApi.get).mockImplementationOnce(() => retry.promise as never);
    const refreshButton = screen.getByRole('button', { name: 'Refresh messages' });
    fireEvent.click(refreshButton);
    await act(async () => { oldPage.reject(new Error('Stale page failed')); });
    expect(refreshButton.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { retry.resolve(page('Recovered first page')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Recovered first page')).toBeTruthy();
  });

  it('releases superseded page busy state without allowing its late failure to clear a newer page', async () => {
    await mount();
    const oldPage = deferred();
    vi.mocked(portalApi.get).mockImplementationOnce(() => oldPage.promise as never);
    fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
    vi.mocked(portalApi.get).mockResolvedValueOnce(page('Refreshed first page', 'new-cursor'));
    refresh();
    await screen.findByText('Refreshed first page');
    const currentPage = deferred();
    vi.mocked(portalApi.get).mockImplementationOnce(() => currentPage.promise as never);
    fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
    expect(portalApi.get).toHaveBeenLastCalledWith('/tickets/ticket?article_cursor=new-cursor');
    await act(async () => { oldPage.reject(new Error('Stale page failure')); });
    const busy = screen.getByRole('button', { name: 'Loading messages…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('status', { name: 'Message pagination' }).textContent).toContain('Loading more');
    fireEvent.click(busy);
    expect(portalApi.get).toHaveBeenCalledTimes(5);
    await act(async () => { currentPage.resolve(page('Current second page', '')); });
    expect(screen.getByText('Current second page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All messages loaded' })).toBe(busy);
  });
});
