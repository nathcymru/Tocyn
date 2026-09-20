import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TicketListPage } from '../pages/TicketListPage';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { portalApi } from '../api/client';
vi.mock('../api/client', () => ({ portalApi: { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), download: vi.fn() } }));
vi.mock('@marsidev/react-turnstile', () => ({ Turnstile: () => null }));
// JSDOM has no layout. Supply nonzero rects for mounted, non-hidden controls so
// the real Ark focus trap can classify them; browser focus/visibility is a separate gate.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]') && this.getAttribute('type') !== 'hidden'
      ? [new DOMRect(0, 0, 100, 30)] : []) as unknown as DOMRectList;
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const ticket = { id: 'ticket', subject: 'Accepted conversation', status: 'open', priority: 'normal', ticket_no: 1, created_at: '2026-09-09 00:00:00' };
const article = { id: 'article', body: 'Accepted message', sender_type: 'customer', created_at: '2026-09-09 00:00:00', attachments: [{ id: 'file', filename: 'readable.txt', size: 100 }] };
const detail = { ticket, articles: [article], pagination: { has_more: false, next_cursor: null } };
function mountList() { render(<MemoryRouter><TicketListPage /></MemoryRouter>); }
function mountDetail() { render(<MemoryRouter initialEntries={['/tickets/ticket']}><Routes><Route path="/tickets/:id" element={<TicketDetailPage />} /></Routes></MemoryRouter>); }
function setupReads() {
  vi.mocked(portalApi.get).mockImplementation(async path => (path === '/config' ? { TICKET_PREFIX: '#' } : path === '/tickets' ? { data: [ticket] } : detail) as never);
}

describe('portal conversation accessibility and recovery', () => {
  it('shows Park skeleton rows while the ticket list is initially loading', () => {
    vi.mocked(portalApi.get).mockImplementation(path => path === '/tickets'
      ? new Promise(() => {})
      : Promise.resolve({ TICKET_PREFIX: '#' }) as never);
    mountList();
    const loading = screen.getByRole('status', { name: 'Loading tickets…' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('.skeleton')).toHaveLength(3);
  });

  it('shows Park skeleton rows while a conversation is initially loading', () => {
    vi.mocked(portalApi.get).mockImplementation(path => path === '/tickets/ticket'
      ? new Promise(() => {})
      : Promise.resolve({ TICKET_PREFIX: '#' }) as never);
    mountDetail();
    const loading = screen.getByRole('status', { name: 'Loading conversation…' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('.skeleton')).toHaveLength(3);
  });

  it.each([
    [0, '0 B'], [62, '62 B'], [1536, '1.5 KB'], [1048576, '1 MB'],
  ])('displays attachment size %s in truthful units', async (size, expected) => {
    const data = { ...detail, articles: [{ ...article, attachments: [{ id: 'size-fixture', filename: 'size.txt', size }] }] };
    vi.mocked(portalApi.get).mockImplementation(async path => (path === '/config' ? {} : data) as never);
    mountDetail();
    const download = await screen.findByRole('button', { name: 'Download size.txt' });
    expect(within(download).getByText(expected)).toBeTruthy();
  });

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

  it('uses Park Dialog and Field anatomy, focuses its first field and returns focus after Escape', async () => {
    setupReads(); mountList();
    const opener = await screen.findByRole('button', { name: 'New Ticket' });
    opener.focus(); fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Create New Ticket' });
    expect(dialog).toHaveClass('dialog__content');
    expect(dialog.querySelector('.dialog__body')).toBeInTheDocument();
    const subject = screen.getByLabelText('Subject');
    expect(subject.closest('.field__root')).toBeInTheDocument();
    await waitFor(() => expect(subject).toBe(document.activeElement));
    expect(screen.getByLabelText('Message')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveClass('button--variant_outline');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    fireEvent.click(opener);
    const reopened = await screen.findByRole('dialog', { name: 'Create New Ticket' });
    fireEvent.click(within(reopened).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(portalApi.post).not.toHaveBeenCalled();
  });

  it('announces rejected creation in the dialog, retains draft and focus, then recovers exactly once', async () => {
    setupReads();
    let reject!: (error: Error) => void;
    vi.mocked(portalApi.post).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    mountList();
    const opener = await screen.findByRole('button', { name: 'New Ticket' }); fireEvent.click(opener);
    const subject = await screen.findByLabelText('Subject') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(subject));
    const message = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(subject, { target: { value: 'Draft subject' } });
    fireEvent.change(message, { target: { value: 'Draft message' } });
    const submit = screen.getByRole('button', { name: 'Create Ticket' }); submit.focus(); fireEvent.click(submit);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('status').textContent).toContain('Creating ticket');
    fireEvent.click(submit);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(portalApi.post).toHaveBeenCalledTimes(1);
    expect(dialog.getAttribute('data-state')).toBe('open');
    reject(new Error('The operator has stopped intake.'));
    const alert = await screen.findByRole('alert');
    expect(subject.getAttribute('aria-describedby')).toBe(alert.id);
    expect(subject.value).toBe('Draft subject'); expect(message.value).toBe('Draft message');
    expect(document.activeElement).toBe(submit);
    vi.mocked(portalApi.post).mockResolvedValueOnce({ ticket: { ...ticket, id: 'new-ticket', subject: 'Draft subject' } });
    fireEvent.click(submit);
    await screen.findByRole('link', { name: /Draft subject/ });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
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
    const feed = await screen.findByRole('region', { name: 'Conversation messages' });
    expect(feed).toHaveClass('scroll-area__viewport');
    expect(feed.closest('.scroll-area__root')?.querySelector('.scroll-area__content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Tickets' })).toBeTruthy();
    expect(screen.getByLabelText('Reply').closest('.field__root')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download readable.txt' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Choose reply attachments'), { target: { files: [new File(['synthetic'], 'chosen.txt', { type: 'text/plain' })] } });
    const remove = screen.getByRole('button', { name: 'Remove chosen.txt' }); remove.focus(); fireEvent.click(remove);
    expect(screen.queryByRole('button', { name: 'Remove chosen.txt' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Attach Files' }));
    expect(screen.getByText('Attachment removed.')).toBeTruthy();
    expect(portalApi.postForm).not.toHaveBeenCalled();
  });

  it('uses Park FileUpload anatomy and accepts the same file again after selection', async () => {
    setupReads(); mountDetail();
    const input = await screen.findByLabelText('Choose reply attachments') as HTMLInputElement;
    const trigger = screen.getByRole('button', { name: 'Attach Files' });
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveAttribute('data-scope', 'file-upload');
    expect(trigger).toHaveAttribute('data-part', 'trigger');
    const file = new File(['synthetic'], 'repeat.txt', { type: 'text/plain' });
    await userEvent.upload(input, file);
    expect(screen.getAllByRole('button', { name: 'Remove repeat.txt' })).toHaveLength(1);
    await userEvent.upload(input, file);
    expect(screen.getAllByRole('button', { name: 'Remove repeat.txt' })).toHaveLength(2);
    expect(screen.getByRole('status', { name: 'Reply status' })).toHaveTextContent('1 attachment added.');
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
    expect(alert).toHaveClass('alert__root');
    expect(alert.querySelector('.alert__description')).toHaveTextContent('Attachment transfer unavailable');
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
    const refreshAlert = await screen.findByRole('alert');
    expect(refreshAlert).toHaveClass('alert__root');
    expect(refreshAlert.querySelector('.alert__description')).toHaveTextContent('Refresh unavailable');
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
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('alert__root');
    expect(alert.querySelector('.alert__description')).toHaveTextContent('Download unavailable');
    expect(document.activeElement).toBe(button);
    vi.mocked(portalApi.download).mockResolvedValueOnce(); fireEvent.click(button);
    await screen.findByText('Attachment download started.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(portalApi.download).toHaveBeenCalledTimes(2);
  });
});


it('uses the safe public text projection only for declared Markdown articles', async () => {
  const data = { ...detail, articles: [
    { ...article, id: 'legacy', body: '**literal legacy**', body_text: 'must not replace legacy', attachments: [] },
    { ...article, id: 'markdown', body: '**formatted**', body_format: 'markdown-v1', body_text: 'formatted <script>literal</script>', attachments: [] },
  ] };
  vi.mocked(portalApi.get).mockImplementation(async path => (path === '/config' ? {} : data) as never);
  mountDetail();
  expect(await screen.findByText('**literal legacy**')).toBeTruthy();
  expect(await screen.findByText('formatted <script>literal</script>')).toBeTruthy();
  expect(screen.queryByText('must not replace legacy')).toBeNull();
  expect(document.querySelector('script')).toBeNull();
});
