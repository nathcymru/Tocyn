import { lazy, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, Link, MemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router-dom';
import { RouteContent } from '../components/RouteContent';
import { useAuthStore } from '../store/authStore';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('keeps the inbox route content mounted when selection navigation changes its pathname', async () => {
  let mounts = 0;
  function InboxRoute() {
    const location = useLocation();
    useEffect(() => { mounts += 1; }, []);
    return <><p data-testid="inbox-location">{location.pathname}</p><Link to="/inbox/all/ticket-2">Open next conversation</Link></>;
  }
  const router = createMemoryRouter([
    { path: '/inbox/*', element: <RouteContent persistent><InboxRoute /></RouteContent> },
  ], { initialEntries: ['/inbox/all/ticket-1'] });
  render(<RouterProvider router={router} />);
  expect(screen.getByTestId('inbox-location')).toHaveTextContent('/inbox/all/ticket-1');
  fireEvent.click(screen.getByRole('link', { name: 'Open next conversation' }));
  expect(await screen.findByTestId('inbox-location')).toHaveTextContent('/inbox/all/ticket-2');
  expect(mounts).toBe(1);
});
it('announces pending route code and then renders it',async()=>{
  let finish!:(module:{default:()=>React.JSX.Element})=>void;
  const Page=lazy(()=>new Promise<{default:()=>React.JSX.Element}>(resolve=>{finish=resolve;}));
  render(<MemoryRouter><RouteContent><Page/></RouteContent></MemoryRouter>);
  const loading = screen.getByRole('status', { name: 'Loading page' });
  expect(loading).toHaveTextContent('Loading page');
  expect(loading.querySelectorAll('.skeleton')).toHaveLength(4);
  await act(async()=>finish({default:()=> <h1>Loaded ticket page</h1>}));
  expect(screen.getByRole('heading',{name:'Loaded ticket page'})).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('adds Park progress with updated status when a route takes longer to load', () => {
  vi.useFakeTimers();
  try {
    const Page = lazy(() => new Promise<{ default: () => React.JSX.Element }>(() => {}));
    const { unmount } = render(<MemoryRouter><RouteContent><Page /></RouteContent></MemoryRouter>);
    const loading = screen.getByRole('status', { name: 'Loading page' });
    expect(loading.querySelectorAll('.skeleton')).toHaveLength(4);
    expect(loading.querySelector('.progress__root')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(loading.querySelector('.progress__root')).toBeInTheDocument();
    expect(loading).toHaveTextContent('Preparing this page…');
    act(() => vi.advanceTimersByTime(3_000));
    expect(loading).toHaveTextContent('This page is taking longer than expected to load…');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it('focuses a safe load-error message, offers a real reload and permits another route without changing auth',async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});
  const before=useAuthStore.getState();
  const Page=lazy(()=>Promise.reject(new Error('synthetic private module failure')));
  render(<MemoryRouter initialEntries={['/inbox/all?sort=updated_desc']}><Link to="/other">Other page</Link><Routes>
    <Route path="/inbox/all" element={<RouteContent><Page/></RouteContent>}/>
    <Route path="/other" element={<RouteContent><h1>Other page loaded</h1></RouteContent>}/>
  </Routes></MemoryRouter>);
  const heading=await screen.findByRole('heading',{name:'This page could not be loaded'});
  const alert=screen.getByRole('alert');
  expect(alert).toHaveClass('alert__root', 'alert__root--status_error', 'alert__root--variant_surface');
  expect(alert.querySelector('.alert__title')).toBe(heading);
  expect(alert.querySelector('.alert__description')).toHaveTextContent('Your sign-in has not been changed');
  await waitFor(()=>expect(heading).toHaveFocus());
  expect(screen.getByRole('link',{name:'Reload this page'})).toHaveAttribute('href','/inbox/all?sort=updated_desc');
  expect(screen.queryByText(/synthetic private module failure/)).not.toBeInTheDocument();
  expect(useAuthStore.getState()).toBe(before);
  fireEvent.click(screen.getByRole('link',{name:'Other page'}));
  expect(await screen.findByRole('heading',{name:'Other page loaded'})).toBeInTheDocument();
});
