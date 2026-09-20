import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, dashboardApi } from '../api/client';
import { TicketAssignmentActions } from '../components/TicketAssignmentActions';
import { useAuthStore } from '../store/authStore';
vi.mock('../api/client', async () => ({ ...await vi.importActual<typeof import('../api/client')>('../api/client'),
  dashboardApi: { post: vi.fn(), patch: vi.fn() } }));
let client: QueryClient;
const onBlocked = vi.fn();
const props = { ticketId: 'ticket', ownerId: null as string | null, fresh: true, disabled: false,
  agents: [{ id: 'operator', email: 'operator@example.test', full_name: 'Synthetic operator' }], onBlocked };
const show = (extra: Partial<typeof props> = {}, refresh = vi.fn().mockResolvedValue(undefined)) => render(
  <QueryClientProvider client={client}><TicketAssignmentActions {...props} {...extra} refreshTicket={refresh} /></QueryClientProvider>);
async function selectOperator() {
  await userEvent.click(screen.getByRole('combobox', { name: 'Assign to operator' }));
  await userEvent.click(screen.getByRole('option', { name: 'Synthetic operator' }));
  // Ark Select restores trigger focus on the next frame; finish that close
  // before typing into the separate reason field.
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const selection = screen.getByRole('combobox', { name: 'Assign to operator' });
  expect(selection).toHaveAttribute('aria-expanded', 'false');
  expect(selection).toHaveTextContent('Synthetic operator');
  const reason = screen.getByLabelText('Override reason');
  await userEvent.click(reason);
  expect(reason).toHaveFocus();
}
beforeEach(() => {
  vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  useAuthStore.getState().setAuth('synthetic', { id: 'admin', tenant_id: 'a', role: 'admin', email: 'admin@example.test', full_name: 'Admin', mfa_enabled: true });
});
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().logout(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('requires fresh ownership and never automatically submits a balance action', async () => {
  show({ fresh: false });
  expect(screen.getByRole('button', { name: 'Balance assignment' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Override assignment capacity' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(dashboardApi.post).not.toHaveBeenCalled(); expect(dashboardApi.patch).not.toHaveBeenCalled();
});

it('opens by keyboard with close focus and Escape returns to the override opener', async () => {
  // Reuse the independently reproduced JSDOM29 ordering/geometry accommodation from UsersCapacity.
  // Simulator-only evidence: actual browser/AT acceptance remains separate. Restored after this test.
  const query = Element.prototype.querySelectorAll;
  vi.spyOn(Element.prototype, 'querySelectorAll').mockImplementation(function(this: Element, selector: string) {
    const result = query.call(this, selector);
    return !selector.includes(',') ? result : Array.from(result).sort((a,b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1) as unknown as NodeListOf<Element>;
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this: HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]') ? [new DOMRect(0,0,100,44)] : []) as unknown as DOMRectList;
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  show(); const opener = screen.getByRole('button', { name: 'Override assignment capacity' });
  opener.focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close assignment override' })).toHaveFocus());
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  await userEvent.tab({ shift: true }); expect(screen.getByLabelText('Override reason')).toHaveFocus();
  await userEvent.tab(); expect(screen.getByRole('button', { name: 'Close assignment override' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(opener).toHaveFocus(); expect(dashboardApi.patch).not.toHaveBeenCalled();
});

it('retains entered override values after conflict and submits a fresh explicit owner CAS', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  vi.mocked(dashboardApi.patch).mockRejectedValueOnce(new ApiError('changed', 409)).mockResolvedValueOnce({ success: true, responsibleOwnerId: 'operator' });
  const view = show({}, refresh);
  await userEvent.click(screen.getByRole('button', { name: 'Override assignment capacity' }));
  await selectOperator();
  await userEvent.type(screen.getByLabelText('Override reason'), 'Urgent approved exception');
  expect(screen.getByLabelText('Override reason')).toHaveValue('Urgent approved exception');
  await userEvent.click(screen.getByRole('button', { name: 'Assign with audited override' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/entered values are retained/));
  expect(screen.getByLabelText('Override reason')).toHaveValue('Urgent approved exception');
  expect(screen.getByRole('combobox', { name: 'Assign to operator' })).toHaveTextContent('Synthetic operator');
  expect(dashboardApi.patch).toHaveBeenCalledTimes(1);
  view.rerender(<QueryClientProvider client={client}><TicketAssignmentActions {...props} ownerId="new-owner" refreshTicket={refresh} /></QueryClientProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Assign with audited override' }));
  await waitFor(() => expect(dashboardApi.patch).toHaveBeenCalledTimes(2));
  expect(vi.mocked(dashboardApi.patch).mock.calls[1][1]).toEqual({ ownerId: 'operator', expectedOwnerId: 'new-owner', capacityOverride: { reason: 'Urgent approved exception' } });
});

it('rejects an oversized multibyte reason and never exposes override controls to an agent', async () => {
  show(); await userEvent.click(screen.getByRole('button', { name: 'Override assignment capacity' }));
  await selectOperator();
  await userEvent.type(screen.getByLabelText('Override reason'), 'é'.repeat(257));
  expect(screen.getByLabelText('Override reason')).toHaveValue('é'.repeat(257));
  expect(screen.getByRole('button', { name: 'Assign with audited override' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('reason is too long');
  expect(dashboardApi.patch).not.toHaveBeenCalled();
  cleanup(); act(() => useAuthStore.getState().updateUser({ role: 'agent' })); show();
  expect(screen.queryByRole('button', { name: 'Override assignment capacity' })).not.toBeInTheDocument();
});


it('removes the old administrator dialog synchronously on a same-generation tenant switch', async () => {
  show(); await userEvent.click(screen.getByRole('button', { name: 'Override assignment capacity' }));
  await userEvent.type(screen.getByLabelText('Override reason'), 'Private prior-tenant reason');
  act(() => useAuthStore.setState(state => ({ user: { ...state.user!, tenant_id: 'other' } })));
  expect(screen.queryByDisplayValue('Private prior-tenant reason')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(dashboardApi.patch).not.toHaveBeenCalled();
});
