import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { AuthQueryBoundary } from '../components/auth/AuthQueryBoundary';
import { useAuthStore } from '../store/authStore';
import { useRealtime } from '../hooks/useRealtime';

// Keep the actual router, guards, login and MFA pages; unrelated layout content is a leaf.
vi.mock('../components/layout/Layout',async () => {
  const {Outlet} = await import('react-router-dom');
  return {Layout:()=> <Outlet/>};
});
vi.mock('../pages/DashboardPage',() => ({DashboardPage:()=> <h1>Dashboard ready</h1>}));
afterEach(() => {cleanup();useAuthStore.getState().logout();localStorage.clear();vi.unstubAllGlobals();vi.useRealTimers();});

it('continues from actual login through MFA to the dashboard when the auth boundary remounts the router', async () => {
  window.history.replaceState({},'','/login');
  useAuthStore.getState().logout();
  const user = {id:'synthetic-operator',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true};
  const fetchMock = vi.fn().mockImplementation(async (url:string,options:RequestInit) => {
    if (url.endsWith('/auth/login')) return new Response(JSON.stringify({token:'synthetic-challenge',user,mfa_required:true}),{status:200});
    if (url.endsWith('/auth/mfa/verify')) {
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer synthetic-challenge');
      return new Response(JSON.stringify({token:'synthetic-session',user}),{status:200});
    }
    throw new Error('Unexpected navigation request');
  });
  vi.stubGlobal('fetch',fetchMock);
  render(<AuthQueryBoundary><App/></AuthQueryBoundary>);
  fireEvent.change(screen.getByPlaceholderText('agent@company.com'),{target:{value:user.email}});
  fireEvent.change(screen.getByPlaceholderText('••••••••'),{target:{value:'synthetic-password'}});
  fireEvent.click(screen.getByRole('button',{name:'Sign In'}));
  const code = await screen.findByPlaceholderText('000000');
  expect(window.location.pathname).toBe('/mfa');
  fireEvent.change(code,{target:{value:'123456'}});
  fireEvent.submit(code.closest('form')!);
  await screen.findByRole('heading',{name:'Dashboard ready'});
  expect(window.location.pathname).toBe('/');
  expect(useAuthStore.getState().token).toBe('synthetic-session');
  expect(useAuthStore.getState().mfaRequired).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('disposes old realtime presence and a scheduled reconnect when auth changes', async () => {
  vi.useFakeTimers();
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen: (()=>void)|null=null;
    onclose: (()=>void)|null=null;
    onmessage: ((event:{data:string})=>void)|null=null;
    onerror: (()=>void)|null=null;
    send = vi.fn();
    close = vi.fn();
    constructor() {sockets.push(this);}
  }
  vi.stubGlobal('WebSocket',FakeSocket);
  const user = {id:'synthetic-a',email:'a@example.invalid',full_name:'A',role:'admin',mfa_enabled:true};
  useAuthStore.getState().setAuth('synthetic-a',user);
  function Presence() {
    const {presence} = useRealtime();
    return <div>{presence.map(person => <span key={person.userId}>{person.name}</span>)}</div>;
  }
  render(<AuthQueryBoundary><Presence/></AuthQueryBoundary>);
  expect(sockets).toHaveLength(1);
  act(() => sockets[0].onmessage?.({data:JSON.stringify({type:'presence.sync',payload:[{userId:'synthetic-a',name:'Previous viewer'}]})}));
  expect(screen.getByText('Previous viewer')).toBeInTheDocument();
  act(() => sockets[0].onclose?.());
  act(() => useAuthStore.getState().setAuth('synthetic-b',{...user,id:'synthetic-b'}));
  expect(sockets[0].close).toHaveBeenCalled();
  expect(sockets[0].onclose).toBeNull();
  expect(screen.queryByText('Previous viewer')).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(30000));
  expect(sockets).toHaveLength(2);
});

it('retains mandatory setup and action focus after an authenticated invalid code, then completes login', async () => {
  window.history.replaceState({}, '', '/login');
  useAuthStore.getState().logout();
  const user = { id: 'synthetic-enrollee', email: 'enrollee@example.invalid', full_name: 'Operator', role: 'admin', mfa_enabled: false };
  let confirmations = 0;
  const fetchMock = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
    if (url.endsWith('/auth/login')) return Response.json({ token: 'synthetic-enrollment-challenge', user, mfa_required: true });
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer synthetic-enrollment-challenge');
    if (url.endsWith('/auth/mfa/setup')) return Response.json({ provisioning_uri: 'otpauth://totp/Synthetic?secret=SYNTHETIC' });
    if (url.endsWith('/auth/mfa/confirm')) {
      confirmations++;
      return confirmations === 1 ? Response.json({ error: 'Invalid MFA code' }, { status: 400 })
        : Response.json({ token: 'synthetic-completed-session', user: { ...user, mfa_enabled: true } });
    }
    throw new Error('Unexpected enrollment request');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<AuthQueryBoundary><App /></AuthQueryBoundary>);
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  await screen.findByRole('img', { name: /Authenticator setup QR/ });
  const code = screen.getByRole('textbox', { name: 'Authentication Code' });
  fireEvent.change(code, { target: { value: '123456' } });
  const submit = screen.getByRole('button', { name: 'Verify & Enable' });
  submit.focus(); fireEvent.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid MFA code');
  expect(window.location.pathname).toBe('/mfa');
  expect(useAuthStore.getState().token).toBe('synthetic-enrollment-challenge');
  expect(code).toHaveValue('123456'); expect(submit).toHaveFocus();
  fireEvent.change(code, { target: { value: '654321' } });
  fireEvent.click(submit);
  await screen.findByRole('heading', { name: 'Dashboard ready' });
  expect(useAuthStore.getState().token).toBe('synthetic-completed-session');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
