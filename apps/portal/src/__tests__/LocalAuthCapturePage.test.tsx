import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAuthCapturePage } from '../pages/LocalAuthCapturePage';

afterEach(() => vi.unstubAllGlobals());

describe('LocalAuthCapturePage', () => {
  it('renders escaped local capture data and uses native refresh/reset controls', async () => {
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
});
