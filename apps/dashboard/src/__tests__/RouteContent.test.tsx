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
  expect(screen.getByRole('status')).toHaveTextContent('Loading page');
  await act(async()=>finish({default:()=> <h1>Loaded ticket page</h1>}));
  expect(screen.getByRole('heading',{name:'Loaded ticket page'})).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('focuses a safe load-error message, offers a real reload and permits another route without changing auth',async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});
  const before=useAuthStore.getState();
  const Page=lazy(()=>Promise.reject(new Error('synthetic private module failure')));
  render(<MemoryRouter initialEntries={['/tickets?filter=open']}><Link to="/other">Other page</Link><Routes>
    <Route path="/tickets" element={<RouteContent><Page/></RouteContent>}/>
    <Route path="/other" element={<RouteContent><h1>Other page loaded</h1></RouteContent>}/>
  </Routes></MemoryRouter>);
  const heading=await screen.findByRole('heading',{name:'This page could not be loaded'});
  await waitFor(()=>expect(heading).toHaveFocus());
  expect(screen.getByRole('link',{name:'Reload this page'})).toHaveAttribute('href','/tickets?filter=open');
  expect(screen.queryByText(/synthetic private module failure/)).not.toBeInTheDocument();
  expect(useAuthStore.getState()).toBe(before);
  fireEvent.click(screen.getByRole('link',{name:'Other page'}));
  expect(await screen.findByRole('heading',{name:'Other page loaded'})).toBeInTheDocument();
});
