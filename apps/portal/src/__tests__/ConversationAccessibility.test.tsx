import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TicketListPage } from '../pages/TicketListPage';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { portalApi } from '../api/client';
vi.mock('../api/client', () => ({ portalApi: { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), download: vi.fn() } }));
vi.mock('@marsidev/react-turnstile', () => ({ Turnstile: () => null }));
// JSDOM omits native dialog methods. This only models open/close, not browser focus containment.
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterAll(() => {
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });
const ticket = { id: 'ticket', subject: 'Accepted conversation', status: 'open', priority: 'normal', ticket_no: 1, created_at: '2026-09-09 00:00:00' };
const article = { id: 'article', body: 'Accepted message', sender_type: 'customer', created_at: '2026-09-09 00:00:00', attachments: [{ id: 'file', filename: 'readable.txt', size: 100 }] };
const detail = { ticket, articles: [article], pagination: { has_more: false, next_cursor: null } };
function mountList() { render(<MemoryRouter><TicketListPage /></MemoryRouter>); }
function mountDetail() { render(<MemoryRouter initialEntries={['/tickets/ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage />} /></Routes></MemoryRouter>); }
function setupReads() {
  vi.mocked(portalApi.get).mockImplementation(async path => (path === '/config' ? { TICKET_PREFIX: '#' } : path === '/tickets' ? { data: [ticket] } : detail) as never);
}

describe('portal conversation accessibility and recovery', () => {
  it.each([null, 42])('shows a truthful ticket reference in list and detail when number is %s', async ticketNumber => {
    const current = { ...ticket, id: '43c8cee6-28f5-4d32-aa8f-59b80c3a2dc4', ticket_no: ticketNumber };
    const reference = ticketNumber === null ? current.id : 'CASE-42';
    vi.mocked(portalApi.get).mockImplementation(async path => (
      path === '/config' ? { TICKET_PREFIX: 'CASE-' }
        : path === '/tickets' ? { data: [current] } : { ...detail, ticket: current }
    ) as never);
    mountList();
    expect(await screen.findByText(reference)).toBeTruthy();
    cleanup();
    mountDetail();
    expect(await screen.findByText(new RegExp(`Ticket ${reference} • Created`))).toBeTruthy();
  });

  it('names the native create dialog, focuses its first field and returns focus after its cancel event', async () => {
    setupReads(); mountList();
    const opener = await screen.findByRole('button', { name: 'New Ticket' });
    opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Create New Ticket' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(screen.getByLabelText('Subject')).toBe(document.activeElement);
    expect(screen.getByLabelText('Message')).toBeTruthy();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(portalApi.post).not.toHaveBeenCalled();
  });

  it('announces rejected creation in the dialog, retains draft and focus, then recovers exactly once', async () => {
    setupReads();
    let reject!: (error: Error) => void;
    vi.mocked(portalApi.post).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    mountList();
    const opener = await screen.findByRole('button', { name: 'New Ticket' }); fireEvent.click(opener);
    const subject = screen.getByLabelText('Subject') as HTMLInputElement;
    const message = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(subject, { target: { value: 'Draft subject' } });
    fireEvent.change(message, { target: { value: 'Draft message' } });
    const submit = screen.getByRole('button', { name: 'Create Ticket' }); submit.focus(); fireEvent.click(submit);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('status').textContent).toContain('Creating ticket');
    fireEvent.click(submit);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(portalApi.post).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute('open')).toBe(true);
    reject(new Error('The operator has stopped intake.'));
    const alert = await screen.findByRole('alert');
    expect(subject.getAttribute('aria-describedby')).toBe(alert.id);
    expect(subject.value).toBe('Draft subject'); expect(message.value).toBe('Draft message');
    expect(document.activeElement).toBe(submit);
    vi.mocked(portalApi.post).mockResolvedValueOnce({ ticket: { ...ticket, id: 'new-ticket', subject: 'Draft subject' } });
    fireEvent.click(submit);
    await screen.findByRole('link', { name: /Draft subject/ });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
    expect(screen.getByRole('status').textContent).toContain('Ticket created');
    expect(portalApi.post).toHaveBeenCalledTimes(2);
  });

  it('announces a failed ticket list and focuses its heading after an explicit read retry', async () => {
    setupReads();
    vi.mocked(portalApi.get).mockRejectedValueOnce(new Error('Ticket list unavailable'));
    mountList(); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading tickets' }));
    const heading = await screen.findByRole('heading', { name: 'Your Tickets' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(portalApi.post).not.toHaveBeenCalled();
  });

  it('announces an initial conversation failure and focuses the recovered heading without a mutation', async () => {
    setupReads();
    vi.mocked(portalApi.get).mockImplementationOnce(async () => ({ TICKET_PREFIX: '#' }) as never);
    vi.mocked(portalApi.get).mockRejectedValueOnce(new Error('Conversation unavailable'));
    mountDetail();
    expect((await screen.findByRole('alert')).textContent).toContain('Conversation unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading conversation' }));
    const heading = await screen.findByRole('heading', { name: /Accepted conversation/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(portalApi.post).not.toHaveBeenCalled();
    expect(portalApi.postForm).not.toHaveBeenCalled();
  });

  it('names history, reply and attachment controls and restores focus when a selected file is removed', async () => {
    setupReads(); mountDetail();
    await screen.findByRole('region', { name: 'Conversation messages' });
    expect(screen.getByRole('link', { name: 'Back to Tickets' })).toBeTruthy();
    expect(screen.getByLabelText('Reply')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download readable.txt' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Choose reply attachments'), { target: { files: [new File(['synthetic'], 'chosen.txt', { type: 'text/plain' })] } });
    const remove = screen.getByRole('button', { name: 'Remove chosen.txt' }); remove.focus(); fireEvent.click(remove);
    expect(screen.queryByRole('button', { name: 'Remove chosen.txt' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Attach Files' }));
    expect(screen.getByText('Attachment removed.')).toBeTruthy();
    expect(portalApi.postForm).not.toHaveBeenCalled();
  });

  it('retains a failed reply draft and selected file, announces failure and prevents duplicate pending uploads', async () => {
    setupReads(); mountDetail();
    const message = await screen.findByLabelText('Reply') as HTMLTextAreaElement;
    fireEvent.change(message, { target: { value: 'Preserved reply' } });
    fireEvent.change(screen.getByLabelText('Choose reply attachments'), { target: { files: [new File(['synthetic'], 'chosen.txt', { type: 'text/plain' })] } });
    let reject!: (error: Error) => void;
    vi.mocked(portalApi.postForm).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const submit = screen.getByRole('button', { name: 'Send Reply' }); submit.focus(); fireEvent.click(submit); fireEvent.click(submit);
    expect(portalApi.postForm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove chosen.txt' }).getAttribute('aria-disabled')).toBe('true');
    expect(message.readOnly).toBe(true);
    reject(new Error('Attachment transfer unavailable'));
    const alert = await screen.findByRole('alert');
    expect(message.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
    expect(message.value).toBe('Preserved reply');
    expect(screen.getByRole('button', { name: 'Remove chosen.txt' })).toBeTruthy();
    expect(document.activeElement).toBe(submit);
    expect(portalApi.post).not.toHaveBeenCalled();
  });

  it('keeps accepted messages and reports saved reply separately from refresh failure, recovering by reading', async () => {
    setupReads(); mountDetail();
    const message = await screen.findByLabelText('Reply') as HTMLTextAreaElement;
    fireEvent.change(message, { target: { value: 'One accepted reply' } });
    vi.mocked(portalApi.post).mockResolvedValue({});
    vi.mocked(portalApi.get).mockRejectedValueOnce(new Error('Refresh unavailable'));
    const submit = screen.getByRole('button', { name: 'Send Reply' }); submit.focus(); fireEvent.click(submit);
    await screen.findByRole('alert');
    expect(screen.getByText(/Reply sent. Refresh messages/)).toBeTruthy();
    expect(screen.getByText('Accepted message')).toBeTruthy();
    expect(message.value).toBe(''); expect(document.activeElement).toBe(submit);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Conversation messages' }));
    expect(portalApi.post).toHaveBeenCalledTimes(1);
  });

  it('waits for sibling uploads to settle and reuses their successful references on retry', async () => {
    setupReads(); mountDetail();
    fireEvent.change(await screen.findByLabelText('Reply'), { target: { value: 'Reply with two files' } });
    const first = new File(['first'], 'first.txt');
    const second = new File(['second'], 'second.txt');
    fireEvent.change(screen.getByLabelText('Choose reply attachments'), { target: { files: [first, second] } });
    let finishSibling!: (result: { key: string }) => void;
    vi.mocked(portalApi.postForm)
      .mockRejectedValueOnce(new Error('First upload failed'))
      .mockImplementationOnce(() => new Promise(resolve => { finishSibling = resolve as typeof finishSibling; }));
    const submit = screen.getByRole('button', { name: 'Send Reply' });
    fireEvent.click(submit);
    await act(async () => {});
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(submit);
    expect(portalApi.postForm).toHaveBeenCalledTimes(2);
    await act(async () => { finishSibling({ key: 'second-key' }); });
    expect((await screen.findByRole('alert')).textContent).toContain('First upload failed');
    vi.mocked(portalApi.postForm).mockResolvedValueOnce({ key: 'first-key' });
    vi.mocked(portalApi.post).mockResolvedValueOnce({});
    fireEvent.click(submit);
    await screen.findByText('Reply sent.');
    expect(portalApi.postForm).toHaveBeenCalledTimes(3);
    expect(vi.mocked(portalApi.postForm).mock.calls[2][1].get('file')).toBe(first);
    expect(portalApi.post).toHaveBeenCalledExactlyOnceWith('/tickets/ticket/messages', {
      message: 'Reply with two files',
      attachments: [
        { filename: 'first.txt', size: first.size, contentType: 'application/octet-stream', storageKey: 'first-key' },
        { filename: 'second.txt', size: second.size, contentType: 'application/octet-stream', storageKey: 'second-key' }
      ]
    });
  });

  it('reuses completed uploads after a rejected message write', async () => {
    setupReads(); mountDetail();
    fireEvent.change(await screen.findByLabelText('Reply'), { target: { value: 'Retained draft' } });
    fireEvent.change(screen.getByLabelText('Choose reply attachments'), { target: { files: [new File(['file'], 'file.txt')] } });
    vi.mocked(portalApi.postForm).mockResolvedValueOnce({ key: 'saved-key' });
    vi.mocked(portalApi.post).mockRejectedValueOnce(new Error('Intake stopped'));
    const submit = screen.getByRole('button', { name: 'Send Reply' });
    fireEvent.click(submit);
    await screen.findByRole('alert');
    vi.mocked(portalApi.post).mockResolvedValueOnce({});
    fireEvent.click(submit);
    await screen.findByText('Reply sent.');
    expect(portalApi.postForm).toHaveBeenCalledTimes(1);
    expect(portalApi.post).toHaveBeenCalledTimes(2);
  });

  it('explains required reply text and prevents attachment-only uploads', async () => {
    setupReads(); mountDetail();
    const message = await screen.findByLabelText('Reply');
    fireEvent.change(message, { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Choose reply attachments'), { target: { files: [new File(['file'], 'file.txt')] } });
    expect(screen.getByText('Reply text is required, including when attaching files.')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Send Reply' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(submit);
    expect(screen.getByRole('alert').textContent).toContain('Enter reply text');
    expect(message.getAttribute('aria-describedby')).toContain('reply-requirement');
    expect(portalApi.postForm).not.toHaveBeenCalled();
    expect(portalApi.post).not.toHaveBeenCalled();
  });

  it('reports download failure inline and permits explicit retry without losing control focus', async () => {
    setupReads(); mountDetail();
    const button = await screen.findByRole('button', { name: 'Download readable.txt' });
    vi.mocked(portalApi.download).mockRejectedValueOnce(new Error('Download unavailable'));
    button.focus(); fireEvent.click(button);
    await screen.findByRole('alert'); expect(document.activeElement).toBe(button);
    vi.mocked(portalApi.download).mockResolvedValueOnce(); fireEvent.click(button);
    await screen.findByText('Attachment download started.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(portalApi.download).toHaveBeenCalledTimes(2);
  });
});
