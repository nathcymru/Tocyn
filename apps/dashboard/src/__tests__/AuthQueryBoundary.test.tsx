import { StrictMode, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthQueryBoundary } from '../components/auth/AuthQueryBoundary';
import { useTickets } from '../hooks/useTickets';
import { useAuthStore } from '../store/authStore';
import { dashboardApi } from '../api/client';

const user = (name: string) => ({id:name,email:`${name}@example.invalid`,full_name:name,role:'admin',mfa_enabled:true});
const response = (name: string) => new Response(JSON.stringify({data:[{id:name,subject:name}],meta:{page:1,limit:20,total:1,total_pages:1}}),
  {status:200,headers:{'Content-Type':'application/json'}});
function deferred<T>() {
  let resolve!: (value:T)=>void;
  const promise = new Promise<T>(done => {resolve=done;});
  return {promise,resolve};
}
const clients = new Set<QueryClient>();
function Feed() {
  const result = useTickets();
  const client = useQueryClient();
  const [draft,setDraft] = useState('');
  useEffect(() => {clients.add(client);},[client]);
  return <><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)}/>
    <div>{result.isLoading ? 'Loading' : result.data?.data.map(ticket => <span key={ticket.id}>{ticket.subject}</span>)}</div></>;
}
function SignedInFeed() {
  const token = useAuthStore(state => state.token);
  return token ? <Feed/> : <p>Signed out</p>;
}
const renderFeed = () => render(<AuthQueryBoundary><SignedInFeed/></AuthQueryBoundary>);

beforeEach(() => {
  clients.clear();localStorage.clear();
  useAuthStore.setState({token:null,user:null,mfaRequired:false,sessionGeneration:0});
});
afterEach(() => {
  cleanup();for (const client of clients) client.clear();
  useAuthStore.getState().logout();localStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();
});

describe('authentication-scoped dashboard data', () => {
  it.each([200,401])('discards old cached state and ignored-abort %i responses after account change', async status => {
    const oldRefresh = deferred<Response>();
    const nextFetch = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(response('First account'))
      .mockReturnValueOnce(oldRefresh.promise).mockReturnValueOnce(nextFetch.promise);
    vi.stubGlobal('fetch',fetchMock);
    useAuthStore.getState().setAuth('synthetic-first',user('first'));
    renderFeed();
    await screen.findByText('First account');
    fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'Unsent first draft'}});
    const firstClient = [...clients][0];
    void firstClient.invalidateQueries({queryKey:['tickets']});
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const oldSignal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    act(() => {useAuthStore.getState().logout();useAuthStore.getState().setAuth('synthetic-second',user('second'));});
    expect(screen.queryByText('First account')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Draft')).toHaveValue('');
    expect(firstClient.getQueryCache().findAll()).toHaveLength(0);
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect((fetchMock.mock.calls[2][1].headers as Headers).get('Authorization')).toBe('Bearer synthetic-second');
    await act(async () => {oldRefresh.resolve(status === 200 ? response('Obsolete response') : new Response('',{status:401}));});
    expect(useAuthStore.getState().token).toBe('synthetic-second');
    expect(screen.queryByText('Obsolete response')).not.toBeInTheDocument();
    nextFetch.resolve(response('Second account'));
    await screen.findByText('Second account');
    expect(screen.queryByText('First account')).not.toBeInTheDocument();
  });

  it('resets same-token auth sessions while ordinary profile refresh preserves current state', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response('Initial view')).mockResolvedValueOnce(response('New session')));
    useAuthStore.getState().setAuth('synthetic-shared',user('first'));
    renderFeed();await screen.findByText('Initial view');
    fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'Current draft'}});
    act(() => useAuthStore.getState().updateUser({full_name:'Updated name'}));
    expect(screen.getByLabelText('Draft')).toHaveValue('Current draft');expect(clients.size).toBe(1);
    act(() => useAuthStore.getState().setAuth('synthetic-shared',user('second')));
    expect(screen.queryByText('Initial view')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Draft')).toHaveValue('');
    await screen.findByText('New session');expect(clients.size).toBe(2);
  });

  it('clears a transient session announcement on subsequent authority or session changes', () => {
    useAuthStore.getState().setAuth('synthetic-first',user('first'),'Synthetic confirmation');
    expect(useAuthStore.getState().sessionAnnouncement).toMatchObject({message:'Synthetic confirmation'});
    useAuthStore.getState().updateUser({role:'agent'});
    expect(useAuthStore.getState().sessionAnnouncement).toBeNull();
    useAuthStore.getState().setAuth('synthetic-second',user('second'));
    expect(useAuthStore.getState().sessionAnnouncement).toBeNull();
  });

  it('hydrates persisted authentication without persisting a cache generation or losing StrictMode startup', async () => {
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => response('Restored session')));
    render(<StrictMode><AuthQueryBoundary><SignedInFeed/></AuthQueryBoundary></StrictMode>);
    expect(screen.getByText('Signed out')).toBeInTheDocument();
    localStorage.setItem('lumina-auth',JSON.stringify({state:{token:'synthetic-restored',user:user('restored'),mfaRequired:false},version:0}));
    await act(async () => {await useAuthStore.persist.rehydrate();});
    await screen.findByText('Restored session');
    act(() => useAuthStore.getState().updateUser({full_name:'Profile refreshed'}));
    expect(JSON.parse(localStorage.getItem('lumina-auth')!).state).not.toHaveProperty('sessionGeneration');
    expect(JSON.parse(localStorage.getItem('lumina-auth')!).state).not.toHaveProperty('sessionAnnouncement');
  });

  it('resets principal-sensitive state when a profile response changes authority', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response('Previous authority')).mockResolvedValueOnce(response('Updated authority')));
    useAuthStore.getState().setAuth('synthetic-authority',user('operator'));
    renderFeed();await screen.findByText('Previous authority');
    fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'Old authority draft'}});
    act(()=>useAuthStore.getState().updateUser({role:'agent'}));
    expect(screen.queryByText('Previous authority')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Draft')).toHaveValue('');
    await screen.findByText('Updated authority');
  });

  it('rejects late attachment bodies before creating a browser download', async () => {
    const body = deferred<Blob>();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,blob:()=>body.promise}));
    const createObjectURL = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal('URL',class extends NativeURL {static createObjectURL=createObjectURL;});
    useAuthStore.getState().setAuth('synthetic-first',user('first'));
    const download = dashboardApi.download('/attachments/synthetic/download','synthetic.txt');
    const rejected = expect(download).rejects.toMatchObject({name:'AbortError'});
    await Promise.resolve();useAuthStore.getState().setAuth('synthetic-second',user('second'));
    body.resolve(new Blob(['synthetic']));await rejected;
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
