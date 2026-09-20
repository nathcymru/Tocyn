// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import userEvent from '@testing-library/user-event';
const session = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ BASE_URL: '/local-widget', widgetHeaders: () => new Headers(), getWidgetSession: session }));
beforeEach(() => {
  session.mockResolvedValue({ email: 'customer@example.invalid' });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function open(features: { aiChat: boolean | string; ticketForm: boolean | string } = { aiChat: true, ticketForm: true }, extraConfig: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'Synthetic support', primaryColor: '#123456', features, ...extraConfig }))));
  render(<App />); const launcher = await screen.findByRole('button', { name: 'Open support' });
  fireEvent.click(launcher); return launcher;
}
it('names the disclosure and tabs, supports keyboard selection and preserves drafts across tabs and closing', async () => {
  const launcher = await open(); const region = screen.getByRole('region', { name: 'Synthetic support' });
  expect(launcher).toHaveClass('button--variant_solid');
  expect(within(region).getByRole('button', { name: 'Close support' })).toHaveClass('button--variant_plain');
  expect(launcher).toHaveAttribute('aria-expanded', 'true'); expect(region.querySelector('button')).toHaveFocus();
  const panelViewport = within(region).getByRole('region', { name: 'Support content' });
  expect(panelViewport).toHaveClass('scroll-area__viewport');
  expect(panelViewport.closest('.scroll-area__root')).toBeInTheDocument();
  expect(panelViewport).toHaveAttribute('tabindex', '0');
  panelViewport.focus(); expect(panelViewport).toHaveFocus();
  const chat = screen.getByRole('tab', { name: 'AI Chat' }); await userEvent.click(chat); await userEvent.keyboard('{ArrowRight}');
  const ticket = screen.getByRole('tab', { name: 'New Ticket' }); await waitFor(() => expect(ticket).toHaveFocus()); await userEvent.keyboard('{Enter}'); await waitFor(() => expect(ticket).toHaveAttribute('aria-selected', 'true'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Keep this draft' } });
  await userEvent.click(ticket); await userEvent.keyboard('{Home}'); await waitFor(() => expect(chat).toHaveFocus());
  await userEvent.click(ticket); expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft');
  fireEvent.keyDown(region, { key: 'Escape' }); expect(launcher).toHaveFocus(); expect(launcher).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region')).not.toBeInTheDocument(); fireEvent.click(launcher);
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft');
});
it('selects the available ticket form when AI is disabled', async () => {
  await open({ aiChat: false, ticketForm: true });
  expect(screen.queryByRole('tab', { name: 'AI Chat' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'New Ticket' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeVisible();
});
it('keeps a long tenant title inside the widget header', async () => {
  const title = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  await open({ aiChat: true, ticketForm: true }, { title });
  const heading = screen.getByRole('heading', { name: title });
  expect(heading).toHaveClass('min-w_0', 'ov-wrap_anywhere');
  const region = screen.getByRole('region', { name: title });
  expect(region).toHaveAttribute('aria-labelledby', heading.id);
  expect(within(region).getByRole('button', { name: 'Close support' })).toBeVisible();
});
it('honours string-valued tenant feature switches and hides a widget with no enabled option', async () => {
  await open({ aiChat: 'false', ticketForm: 'true' });
  expect(screen.queryByRole('tab', { name: 'AI Chat' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'New Ticket' })).toBeInTheDocument();
  cleanup();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    title: 'Synthetic support', features: { aiChat: 'false', ticketForm: 'false' },
  }))));
  await act(async () => { render(<App />); });
  expect(fetch).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Open support' })).not.toBeInTheDocument();
});
it('removes private drafts when the verified session disappears', async () => {
  await open({ aiChat: true, ticketForm: true }, { portalUrl: 'https://example.invalid/support' }); await userEvent.click(screen.getByRole('tab', { name: 'New Ticket' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Private synthetic draft' } });
  session.mockResolvedValueOnce(null); fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument());
  const signIn = screen.getByText(/Sign in through the support portal/);
  expect(signIn).toBeVisible();
  expect(signIn.closest('.alert__root')).toBeInTheDocument();
  const portalLink = screen.getByRole('link', { name: 'Open support portal' });
  expect(portalLink).toHaveClass('link');
  expect(portalLink).toHaveAttribute('href', 'https://example.invalid/support');
  session.mockResolvedValueOnce({ email: 'customer@example.invalid' }); fireEvent(window, new Event('focus'));
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
});
