import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAuthCapturePage } from '../pages/LocalAuthCapturePage';

afterEach(() => vi.unstubAllGlobals());

describe('LocalAuthCapturePage', () => {
  it('renders escaped local capture data and uses Park refresh/reset controls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'capture-1', subject: '<unsafe>', to: 'tocyn-auth-test@example.invalid', from: 'local', text: 'Synthetic', createdAt: 'now', expiresAt: 'later', loginLink: 'http://localhost:5174/verify?token=synthetic' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LocalAuthCapturePage />);
    expect(await screen.findByRole('heading', { name: '<unsafe>' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open captured login link' })).toHaveAttribute('href', 'http://localhost:5174/verify?token=synthetic');
    fireEvent.click(screen.getByRole('button', { name: 'Clear captured messages' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/__local/auth-capture/reset', { method: 'POST', credentials: 'same-origin' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No captured messages.'));
  });

  it('keeps a failed read distinct from an empty capture and offers a working retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LocalAuthCapturePage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('alert__root');
    expect(alert).toHaveTextContent('Capture messages are unavailable.');
    expect(screen.queryByText('Captured local authentication messages will appear here.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading messages' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText('Captured local authentication messages will appear here.')).toBeInTheDocument();
  });

  it('keeps a failed reset distinct from an empty capture and retries the reset action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LocalAuthCapturePage />);

    await screen.findByText('Captured local authentication messages will appear here.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear captured messages' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('alert__root');
    expect(alert).toHaveTextContent('Captured messages could not be cleared.');
    expect(screen.queryByText('Captured local authentication messages will appear here.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry clearing messages' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText('Captured local authentication messages will appear here.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/__local/auth-capture/reset', { method: 'POST', credentials: 'same-origin' });
  });
});
