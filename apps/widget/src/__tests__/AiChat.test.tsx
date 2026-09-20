// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AiChat from '../components/AiChat';
vi.mock('../api', () => ({ BASE_URL: '/local-widget', widgetHeaders: () => new Headers({ Authorization: 'Bearer synthetic-token' }) }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function question() {
  render(<AiChat config={{ primaryColor: '#123456', welcomeMessage: 'Welcome' }} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'Synthetic question' } });
  return screen.getByRole('form', { name: 'Ask AI support' });
}
it('names controls, prevents concurrent sends and retains the authenticated history contract', async () => {
  let finish!: (response: Response) => void;
  const request = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', request);
  const form = question();
  const log = screen.getByRole('log', { name: 'AI conversation' });
  expect(log).toHaveClass('scroll-area__viewport');
  expect(log.closest('.scroll-area__root')).toBeInTheDocument();
  expect(log).toHaveAttribute('tabindex', '0');
  log.focus(); expect(log).toHaveFocus();
  fireEvent.submit(form); fireEvent.submit(form);
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox', { name: 'Your question' })).toBeDisabled();
  const waiting = screen.getByRole('status', { name: 'Waiting for AI response' });
  expect(waiting).toHaveTextContent('Waiting for AI response…');
  expect(waiting.querySelectorAll('.skeleton')).toHaveLength(2);
  expect(form).toHaveAttribute('aria-busy', 'true');
  const [url, options] = request.mock.calls[0];
  expect(url).toBe('/local-widget/chat'); expect(options.credentials).toBe('omit');
  expect(new Headers(options.headers).get('Authorization')).toBe('Bearer synthetic-token');
  expect(JSON.parse(options.body as string)).toEqual({ message: 'Synthetic question', history: [] });
  await act(async () => finish(new Response(JSON.stringify({ response: 'Synthetic answer' }))));
  expect(await screen.findByText('Synthetic answer')).toBeInTheDocument();
  expect(screen.getByRole('log', { name: 'AI conversation' })).toHaveTextContent('Synthetic question');
  await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'false'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'Follow up' } });
  fireEvent.submit(form);
  expect(JSON.parse(request.mock.calls[1][1].body as string)).toEqual({ message: 'Follow up', history: [{ role: 'user', content: 'Synthetic question' }, { role: 'assistant', content: 'Synthetic answer' }] });
  await act(async () => finish(new Response(JSON.stringify({ response: 'Next answer' }))));
});
it.each([403, 200])('retains the failed question and focus for explicit retry after status %s or malformed response', async status => {
  const request = vi.fn().mockResolvedValueOnce(new Response('{}', { status })).mockResolvedValueOnce(new Response(JSON.stringify({ response: 'Recovered' })));
  vi.stubGlobal('fetch', request); const form = question(); fireEvent.submit(form);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveClass('alert__root');
  expect(alert.querySelector('.alert__description')).toHaveTextContent('could not be confirmed');
  const input = screen.getByRole('textbox', { name: 'Your question' });
  await waitFor(() => expect(input).toHaveFocus()); expect(input).toHaveValue('Synthetic question');
  expect(screen.getByRole('log')).not.toHaveTextContent('could not be confirmed');
  expect(screen.getByRole('log')).not.toHaveTextContent('Synthetic question');
  expect(screen.getByRole('button', { name: 'Send question' })).toBeEnabled();
  fireEvent.submit(form); expect(await screen.findByText('Recovered')).toBeInTheDocument();
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ message: 'Synthetic question', history: [] });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
