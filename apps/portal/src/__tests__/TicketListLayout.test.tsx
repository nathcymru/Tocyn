import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TicketListPage } from '../pages/TicketListPage';
import { portalApi } from '../api/client';

vi.mock('../api/client', () => ({ portalApi: { get: vi.fn(), post: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('keeps an unbroken ticket subject readable inside its Park-linked row', async () => {
  const subject = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  vi.mocked(portalApi.get).mockImplementation(async path => (path === '/config'
    ? { TICKET_PREFIX: '#' }
    : { data: [{
      id: 'synthetic-ticket', ticket_no: 42, subject, status: 'open', priority: 'normal',
      customer_email: 'customer@example.invalid', created_at: '2026-09-20T07:00:00Z', updated_at: '2026-09-20T07:00:00Z',
    }] }) as never);

  render(<MemoryRouter><TicketListPage /></MemoryRouter>);
  const heading = await screen.findByText(subject);
  const link = heading.closest('a');
  expect(link).toHaveClass('link', 'link--variant_plain');
  expect(link).toHaveAttribute('href', '/tickets/synthetic-ticket');
  expect(heading).toHaveClass('min-w_0', 'ov-wrap_anywhere');
  expect(heading.parentElement).toHaveClass('min-w_0', 'flex-wrap_wrap');
  expect(link?.querySelector('span.badge')).toHaveClass('badge--variant_subtle', 'tt_capitalize', 'bg_info.surface');
});
