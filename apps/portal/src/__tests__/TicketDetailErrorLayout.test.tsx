import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { portalApi } from '../api/client';

vi.mock('../api/client', () => ({ portalApi: { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), download: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('wraps Park empty-state recovery actions while keeping retry and back navigation', async () => {
  vi.mocked(portalApi.get).mockImplementation(async path => {
    if (path === '/config') return { TICKET_PREFIX: '#' } as never;
    throw new Error('Synthetic conversation failure');
  });
  render(<MemoryRouter initialEntries={['/tickets/synthetic']}>
    <Routes><Route path="/tickets/:id" element={<TicketDetailPage />} /></Routes>
  </MemoryRouter>);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveClass('emptyState__root');
  const retry = screen.getByRole('button', { name: 'Retry loading conversation' });
  const back = screen.getByRole('link', { name: 'Back to Tickets' });
  expect(back).toHaveAttribute('href', '/tickets');
  expect(retry.parentElement).toContainElement(back);
  expect(retry.parentElement).toHaveClass('flex-wrap_wrap');

  const readsBeforeRetry = vi.mocked(portalApi.get).mock.calls.filter(([path]) => path === '/tickets/synthetic').length;
  fireEvent.click(retry);
  expect(await screen.findByRole('button', { name: 'Retry loading conversation' })).toBeInTheDocument();
  await waitFor(() => expect(vi.mocked(portalApi.get).mock.calls.filter(([path]) => path === '/tickets/synthetic')).toHaveLength(readsBeforeRetry + 1));
});
