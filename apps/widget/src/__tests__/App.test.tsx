// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import userEvent from '@testing-library/user-event';
const session = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ BASE_URL: '/local-widget', widgetHeaders: () => new Headers(), getWidgetSession: session }));
beforeEach(() => { session.mockResolvedValue({ email: 'customer@example.invalid' }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function open(features = { aiChat: true, ticketForm: true }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'Synthetic support', primaryColor: '#123456', features }))));
  render(<App />); const launcher = await screen.findByRole('button', { name: 'Open support' });
  fireEvent.click(launcher); return launcher;
}
it('names the disclosure and tabs, supports keyboard selection and preserves drafts across tabs and closing', async () => {
  const launcher = await open(); const region = screen.getByRole('region', { name: 'Synthetic support' });
  expect(launcher).toHaveAttribute('aria-expanded', 'true'); expect(region.querySelector('button')).toHaveFocus();
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
it('removes private drafts when the verified session disappears', async () => {
  await open(); await userEvent.click(screen.getByRole('tab', { name: 'New Ticket' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Private synthetic draft' } });
  session.mockResolvedValueOnce(null); fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument());
  expect(screen.getByText(/Sign in through the support portal/)).toBeVisible();
  session.mockResolvedValueOnce({ email: 'customer@example.invalid' }); fireEvent(window, new Event('focus'));
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
});
