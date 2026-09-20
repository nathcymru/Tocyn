import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketActionBar } from '../components/TicketActionBar';
import { parseTicketUtilityActions } from '../hooks/useTicketUtilityActions';
import { ticketReference } from '../utils/ticket-reference';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

const manifest = (enabled = true) => ({ version: 1, ticketId: 'ticket-1', actions: [
  { id: 'copy-ticket-reference', label: 'Copy ticket reference', description: 'Copies the current ticket reference.', slot: 'action-bar', capability: 'tools.reference.read', kind: 'application-command', command: 'copy-ticket-reference', enabled },
  { id: 'view-ticket-reference', label: 'View ticket reference', description: 'Shows the current ticket reference in this workspace.', slot: 'more', capability: 'tools.reference.read', kind: 'internal-dialog', dialog: 'ticket-reference', enabled },
  { id: 'open-governed-action-guidance', label: 'Open action safety guidance', description: 'Opens the documented action security boundary in a new tab.', slot: 'more', capability: 'tools.reference.read', kind: 'external-link', href: 'https://github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md', enabled },
] });

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this: HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]') ? [new DOMRect(0, 0, 100, 44)] : []) as unknown as DOMRectList;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor); else Reflect.deleteProperty(navigator, 'clipboard'); });

it('keeps the command and More actions keyboard-accessible, with dialog focus return', async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const actions = parseTicketUtilityActions(manifest(), 'ticket-1').actions;
  render(<TicketActionBar reference="#42" actions={actions} loading={false} error={false} retry={() => {}} />);
  const copy = screen.getByRole('button', { name: 'Copy ticket reference' });
  copy.focus(); await user.keyboard('{Enter}');
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('#42'));
  expect(await screen.findByRole('status')).toHaveTextContent('Ticket reference copied.');
  const more = screen.getByText('More ticket actions');
  more.focus(); await user.keyboard('{Enter}');
  const opener = await screen.findByRole('button', { name: 'View ticket reference' });
  opener.focus(); await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', { name: 'Ticket reference' });
  expect(within(dialog).getByText('#42')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close ticket reference' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
  const link = screen.getByRole('link', { name: 'Open action safety guidance' });
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it('renders denied server actions disabled with their reason and refuses broadened links', () => {
  const denied = manifest(false) as any;
  for (const action of denied.actions) action.reason = 'Reference utilities are not permitted by the current server policy.';
  const actions = parseTicketUtilityActions(denied, 'ticket-1').actions;
  render(<TicketActionBar reference="#42" actions={actions} loading={false} error={false} retry={() => {}} />);
  expect(screen.getByRole('button', { name: 'Copy ticket reference' })).toBeDisabled();
  expect(screen.getAllByText('Reference utilities are not permitted by the current server policy.')).toHaveLength(3);
  const unsafe = manifest() as any;
  unsafe.actions[2].href = 'javascript:alert(1)';
  expect(() => parseTicketUtilityActions(unsafe, 'ticket-1')).toThrow('Ticket actions are unavailable.');
});

it('offers a selectable reference fallback when clipboard support is missing', async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  render(<TicketActionBar reference="#42" actions={parseTicketUtilityActions(manifest(), 'ticket-1').actions} loading={false} error={false} retry={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Copy ticket reference' }));
  expect(screen.getByRole('status')).toHaveTextContent('could not be copied');
  await user.click(screen.getByText('More ticket actions'));
  await user.click(screen.getByRole('button', { name: 'View ticket reference' }));
  expect(within(screen.getByRole('dialog')).getByText('#42')).toBeVisible();
});

it.each([null, 62])('copies the actual ticket reference when its allocated number is %s', async number => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const reference = ticketReference({ id: 'ticket-1', ticket_no: number }, '#');
  render(<TicketActionBar reference={reference} actions={parseTicketUtilityActions(manifest(), 'ticket-1').actions} loading={false} error={false} retry={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Copy ticket reference' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(number === null ? 'ticket-1' : '#62'));
  await userEvent.click(screen.getByText('More ticket actions'));
  await userEvent.click(screen.getByRole('button', { name: 'View ticket reference' }));
  expect(within(screen.getByRole('dialog', { name: 'Ticket reference' })).getByText(reference)).toBeVisible();
});

it('keeps copy focus and an available reference after the clipboard rejects the write', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<TicketActionBar reference="#42" actions={parseTicketUtilityActions(manifest(), 'ticket-1').actions} loading={false} error={false} retry={() => {}} />);
  const copy = screen.getByRole('button', { name: 'Copy ticket reference' });
  copy.focus();
  await userEvent.click(copy);
  expect(await screen.findByRole('status')).toHaveTextContent('The ticket reference could not be copied. Select it in More ticket actions instead.');
  expect(copy).toHaveFocus();
  await userEvent.click(screen.getByText('More ticket actions'));
  await userEvent.click(screen.getByRole('button', { name: 'View ticket reference' }));
  expect(within(screen.getByRole('dialog', { name: 'Ticket reference' })).getByText('#42')).toBeVisible();
  expect(writeText).toHaveBeenCalledTimes(1);
});

it('clears the old ticket dialog and ignores a late clipboard result after switching tickets', async () => {
  const user = userEvent.setup();
  let finishCopy!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>(resolve => { finishCopy = resolve; }) } });
  const props = { actions: parseTicketUtilityActions(manifest(), 'ticket-1').actions, loading: false, error: false, retry: () => {} };
  const view = render(<TicketActionBar {...props} reference="#42" />);
  await user.click(screen.getByRole('button', { name: 'Copy ticket reference' }));
  await user.click(screen.getByText('More ticket actions'));
  await user.click(screen.getByRole('button', { name: 'View ticket reference' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  view.rerender(<TicketActionBar {...props} reference="#43" />);
  finishCopy();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
