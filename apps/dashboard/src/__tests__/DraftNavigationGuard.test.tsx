import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
afterEach(cleanup);
function setup(flush: () => Promise<boolean>, pending = true) {
  const router = createMemoryRouter([
    { path: '/previous', element: <p>Previous ticket</p> },
    { path: '/draft', element: <><DraftNavigationGuard pending={pending} flush={flush} /><Link to="/next">Next ticket</Link><p>Current draft</p></> },
    { path: '/next', element: <p>Next page</p> },
  ], { initialEntries: ['/previous', '/draft'], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  return router;
}
it('waits for durable acknowledgement before completing link navigation', async () => {
  let resolve!: (saved: boolean) => void;
  const flush = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
  const router = setup(flush);
  fireEvent.click(screen.getByRole('link', { name: 'Next ticket' }));
  await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
  expect(router.state.location.pathname).toBe('/draft');
  await act(async () => resolve(true));
  expect(await screen.findByText('Next page')).toBeInTheDocument();
});
it('keeps browser-back navigation on the draft when saving fails', async () => {
  const router = setup(async () => false);
  await act(async () => { await router.navigate(-1); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is not saved');
  expect(router.state.location.pathname).toBe('/draft');
});
it('warns for document unload only while unsaved work remains', () => {
  setup(async () => true);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  cleanup();
  setup(async () => true, false);
  const savedEvent = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(savedEvent);
  expect(savedEvent.defaultPrevented).toBe(false);
});
