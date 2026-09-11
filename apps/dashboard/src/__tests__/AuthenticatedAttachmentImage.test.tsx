// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthenticatedAttachmentImage } from '../components/AuthenticatedAttachmentImage';
import { useAuthStore } from '../store/authStore';

function user(id: string) {
  return { id, tenant_id: 'tenant-a', email: `${id}@example.invalid`, full_name: id, role: 'admin', mfa_enabled: true };
}

function imageResponse(body = 'synthetic-image', headers: HeadersInit = {}) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'image/png', ...headers } });
}

function preview(overrides: Partial<React.ComponentProps<typeof AuthenticatedAttachmentImage>> = {}) {
  return <AuthenticatedAttachmentImage ticketId="ticket-a" attachmentId="image-a" filename="diagram.png" contentType="image/png" size={12} {...overrides} />;
}

beforeEach(() => {
  useAuthStore.getState().setAuth('synthetic-first', user('first'));
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('does not request unsupported attachment types', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(preview({ contentType: 'image/svg+xml' }));
  expect(screen.queryByRole('button', { name: /preview image/i })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('fetches one verified attachment only after an explicit action and uses a local blob URL', async () => {
  const fetchMock = vi.fn().mockResolvedValue(imageResponse());
  const createObjectURL = vi.fn(() => 'blob:synthetic-preview');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const mounted = render(preview());
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview image diagram.png' }));
  await screen.findByRole('img', { name: 'Preview of diagram.png' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/attachments/image-a/download');
  expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer synthetic-first');
  expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ size: 15, type: 'image/png' }));
  mounted.unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-preview');
});

it('shows recoverable feedback for an invalid response and retries without accepting it', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('not an image', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    .mockResolvedValueOnce(imageResponse());
  const createObjectURL = vi.fn(() => 'blob:retry-preview');
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  render(preview());
  fireEvent.click(screen.getByRole('button', { name: 'Preview image diagram.png' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Image preview could not be loaded.');
  expect(createObjectURL).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry image preview diagram.png' }));
  await screen.findByRole('img', { name: 'Preview of diagram.png' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('retains one focused control while showing and hiding a completed preview', async () => {
  const fetchMock = vi.fn().mockResolvedValue(imageResponse());
  const createObjectURL = vi.fn(() => 'blob:focus-preview');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  render(preview());
  const control = screen.getByRole('button', { name: 'Preview image diagram.png' });
  control.focus();
  fireEvent.click(control);
  await screen.findByRole('img', { name: 'Preview of diagram.png' });
  const hide = screen.getByRole('button', { name: 'Hide image preview diagram.png' });
  expect(hide).toBe(control);
  expect(document.activeElement).toBe(control);
  fireEvent.click(hide);
  expect(screen.queryByRole('img', { name: 'Preview of diagram.png' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Preview image diagram.png' })).toBe(control);
  expect(document.activeElement).toBe(control);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:focus-preview');
});

it('releases the prior completed preview before showing a different attachment', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse('one')).mockResolvedValueOnce(imageResponse('two'));
  const createObjectURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  render(<><AuthenticatedAttachmentImage ticketId="ticket-a" attachmentId="one" filename="one.png" contentType="image/png" size={1} />
    <AuthenticatedAttachmentImage ticketId="ticket-a" attachmentId="two" filename="two.png" contentType="image/png" size={1} /></>);
  fireEvent.click(screen.getByRole('button', { name: 'Preview image one.png' }));
  await screen.findByRole('img', { name: 'Preview of one.png' });
  fireEvent.click(screen.getByRole('button', { name: 'Preview image two.png' }));
  await screen.findByRole('img', { name: 'Preview of two.png' });
  expect(screen.queryByRole('img', { name: 'Preview of one.png' })).toBeNull();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
});

it('recovers when the browser cannot decode a MIME-validated image', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce(imageResponse());
  const createObjectURL = vi.fn().mockReturnValueOnce('blob:broken').mockReturnValueOnce('blob:recovered');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  render(preview());
  fireEvent.click(screen.getByRole('button', { name: 'Preview image diagram.png' }));
  fireEvent.error(await screen.findByRole('img', { name: 'Preview of diagram.png' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:broken');
  fireEvent.click(screen.getByRole('button', { name: 'Retry image preview diagram.png' }));
  await screen.findByRole('img', { name: 'Preview of diagram.png' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('rejects declared or streamed bodies over 10 MiB before creating a preview URL', async () => {
  const tooLarge = 10 * 1024 * 1024 + 1;
  const streamedTooLarge = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(10 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'image/png' } });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('header rejected', { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(tooLarge) } }))
    .mockResolvedValueOnce(streamedTooLarge);
  const createObjectURL = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  render(preview());
  fireEvent.click(screen.getByRole('button', { name: 'Preview image diagram.png' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry image preview diagram.png' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await screen.findByRole('alert');
  expect(createObjectURL).not.toHaveBeenCalled();
});

it('cancels the previous explicit preview before starting another attachment request', async () => {
  let resolveFirst!: (response: Response) => void;
  let resolveSecond!: (response: Response) => void;
  const first = new Promise<Response>(done => { resolveFirst = done; });
  const second = new Promise<Response>(done => { resolveSecond = done; });
  const fetchMock = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
  render(<><AuthenticatedAttachmentImage ticketId="ticket-a" attachmentId="one" filename="one.png" contentType="image/png" size={1} />
    <AuthenticatedAttachmentImage ticketId="ticket-a" attachmentId="two" filename="two.png" contentType="image/png" size={1} /></>);
  fireEvent.click(screen.getByRole('button', { name: 'Preview image one.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview image two.png' }));
  expect((fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
  await act(async () => { resolveFirst(imageResponse()); resolveSecond(imageResponse()); });
});

it('drops a late body after ticket or authenticated-session changes', async () => {
  let resolveFirst!: (response: Response) => void;
  let resolveSecond!: (response: Response) => void;
  const first = new Promise<Response>(done => { resolveFirst = done; });
  const second = new Promise<Response>(done => { resolveSecond = done; });
  const fetchMock = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const createObjectURL = vi.fn(() => 'blob:never-stale');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const mounted = render(preview());
  fireEvent.click(screen.getByRole('button', { name: 'Preview image diagram.png' }));
  const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
  mounted.rerender(preview({ ticketId: 'ticket-b' }));
  expect(signal.aborted).toBe(true);
  await act(async () => { resolveFirst(imageResponse()); });
  expect(createObjectURL).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Preview image diagram.png' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await act(async () => { useAuthStore.getState().setAuth('synthetic-second', user('second')); });
  expect((fetchMock.mock.calls[1]?.[1]?.signal as AbortSignal).aborted).toBe(true);
  await act(async () => { resolveSecond(imageResponse()); });
  mounted.unmount();
  expect(revokeObjectURL).not.toHaveBeenCalled();
});
