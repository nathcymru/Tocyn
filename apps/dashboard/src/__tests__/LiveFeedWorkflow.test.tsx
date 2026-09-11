import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Layout } from '../components/layout/Layout';
import { TicketListPage } from '../pages/TicketListPage';
import { useAuthStore } from '../store/authStore';

class Socket {
  static OPEN=1;static latest:Socket;readyState=1;
  onopen:(()=>void)|null=null;onclose:(()=>void)|null=null;
  onmessage:((event:{data:string})=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(){Socket.latest=this;}send(){}close(){}
  emit(event:unknown){this.onmessage?.({data:JSON.stringify(event)});}
}
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
let client:QueryClient;
beforeEach(()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});vi.stubGlobal('WebSocket',Socket);
  useAuthStore.getState().setAuth('synthetic-live-session',{id:'operator',tenant_id:'synthetic-tenant',full_name:'Operator',email:'operator@example.invalid',role:'admin',mfa_enabled:true});
});
afterEach(()=>{cleanup();client.clear();useAuthStore.getState().logout();localStorage.clear();vi.unstubAllGlobals();});
function renderFeed() {
  const router = createMemoryRouter([{ path: '/', element: <Layout/>, children: [{ path: 'tickets', element: <TicketListPage/> }] }], { initialEntries: ['/tickets'] });
  render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
}

it.each(['ticket.created','ticket.updated','article.created'])('reloads authoritative feed data for %s without trusting event contents',async type=>{
  let arrived=false;let reads=0;
  const ticket={id:'live-ticket',ticket_no:62,subject:'Persisted live arrival',customer_email:'customer@example.invalid',status:'open',priority:'normal',created_at:'2026-09-09T00:00:00Z',updated_at:'2026-09-09T00:00:00Z'};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url==='/api/workspace/theme-preference')return json({revision:0,mode:'system',updatedAt:null});
    if(url==='/api/settings/theme')return json({version:'1',light:{},dark:{}});
    if(url.startsWith('/api/tickets?')){reads++;return json({data:arrived?[ticket]:[],meta:{page:1,limit:20,total:arrived?1:0,total_pages:1}});}
    return json(url==='/api/settings'?{}:[]);
  }));
  renderFeed();
  await screen.findByText('No tickets found.');const previous=reads;arrived=true;
  act(()=>Socket.latest.emit({type,payload:type==='article.created'?{ticket_id:ticket.id,article_id:'new-message'}:{id:ticket.id,subject:'Untrusted event display hint'}}));
  await screen.findByRole('link',{name:ticket.subject});
  await waitFor(()=>expect(reads).toBe(previous+1));
  expect(screen.queryByRole('link',{name:'Untrusted event display hint'})).not.toBeInTheDocument();
});


it('replaces a pending old feed read when a committed arrival is announced',async()=>{
  let release!: (response:Response)=>void;
  const stale=new Promise<Response>(resolve=>{release=resolve;});let reads=0;let arrived=false;let holdOldRead=false;
  const ticket={id:'after-event',ticket_no:63,subject:'Authoritative post-event arrival',customer_email:'customer@example.invalid',status:'open',priority:'normal',created_at:'2026-09-09T00:00:00Z',updated_at:'2026-09-09T00:00:00Z'};
  const empty={data:[],meta:{page:1,limit:20,total:0,total_pages:1}};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url==='/api/workspace/theme-preference')return json({revision:0,mode:'system',updatedAt:null});
    if(url==='/api/settings/theme')return json({version:'1',light:{},dark:{}});
    if(url.startsWith('/api/tickets?')){
      reads++;if(holdOldRead){holdOldRead=false;return stale;}
      return json(arrived?{data:[ticket],meta:{page:1,limit:20,total:1,total_pages:1}}:empty);
    }
    return json(url==='/api/settings'?{}:[]);
  }));
  renderFeed();
  await screen.findByText('No tickets found.');
  const readsBeforePending=reads;
  let pending:Promise<void>;holdOldRead=true;act(()=>{pending=client.invalidateQueries({queryKey:['tickets']});});
  await waitFor(()=>expect(reads).toBeGreaterThan(readsBeforePending));arrived=true;
  const readsBeforeEvent=reads;
  act(()=>Socket.latest.emit({type:'ticket.created',payload:{id:ticket.id}}));
  await screen.findByRole('link',{name:ticket.subject});
  await act(async()=>{release(json(empty));await pending!;});
  expect(screen.getByRole('link',{name:ticket.subject})).toBeInTheDocument();expect(reads).toBeGreaterThan(readsBeforeEvent);
});
