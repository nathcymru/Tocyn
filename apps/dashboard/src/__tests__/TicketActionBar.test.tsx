import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketActionBar } from '../components/TicketActionBar';
import { parseTicketUtilityActions } from '../hooks/useTicketUtilityActions';

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
