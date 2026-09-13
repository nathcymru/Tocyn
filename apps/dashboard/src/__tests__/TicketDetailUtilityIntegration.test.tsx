import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { CollaborationProvider } from '../components/CollaborationContext';
import { useAuthStore } from '../store/authStore';

class Socket { static OPEN=1; readyState=1; onopen=null; onclose=null; onmessage=null; onerror=null; send(){} close(){} }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const manifest=(ticketId:string,enabled=true)=>({version:1,ticketId,actions:[
  {id:'copy-ticket-reference',label:'Copy ticket reference',description:'Copies the current reference.',slot:'action-bar',capability:'tools.reference.read',kind:'application-command',command:'copy-ticket-reference',enabled},
  {id:'view-ticket-reference',label:'View ticket reference',description:'Shows the current reference.',slot:'more',capability:'tools.reference.read',kind:'internal-dialog',dialog:'ticket-reference',enabled},
  {id:'open-governed-action-guidance',label:'Open action safety guidance',description:'Opens action safety guidance.',slot:'more',capability:'tools.reference.read',kind:'external-link',href:'https://github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md',enabled},
].map(action=>enabled?action:{...action,reason:'Reference access denied by policy.'})});
const clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
const clients:QueryClient[]=[];

function show(utility:(id:string)=>Response|Promise<Response>) {
  const utilityRequests:string[]=[];
  vi.stubGlobal('WebSocket',Socket);
  vi.stubGlobal('fetch',vi.fn(async (url:string,options:RequestInit={})=>{
    const path=new URL(url,'http://localhost').pathname;
    if(path==='/api/workspace/state') {
      const state={revision:1,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId:null,panel:'conversation',updatedAt:'2026-09-13T00:00:00Z'};
      return json(options.method==='PUT'?{...state,...JSON.parse(String(options.body)),revision:2}:state);
    }
    if(path.startsWith('/api/workspace/drafts')) return new Response(null,{status:204});
    const utilityMatch=path.match(/^\/api\/tickets\/([^/]+)\/utility-actions$/);
    if(utilityMatch){utilityRequests.push(utilityMatch[1]);return utility(utilityMatch[1]);}
    const ticketMatch=path.match(/^\/api\/tickets\/([^/]+)$/);
    if(ticketMatch) return json({id:ticketMatch[1],subject:`Conversation ${ticketMatch[1]}`,customer_email:'synthetic@example.invalid',ticket_no:ticketMatch[1]==='one'?1:2,status:'open',priority:'normal',assigned_to:null,group_id:null,created_at:'2026-09-13T00:00:00Z',articles:[],pagination:{limit:20,next_cursor:null,has_more:false}});
    if(path==='/api/settings') return json({});
    return json([]);
  }));
  useAuthStore.getState().setAuth('synthetic-session',{id:'operator',tenant_id:'synthetic-tenant',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
  const router=createMemoryRouter([{path:'/tickets/:id',element:<TicketDetailPage/>}],{initialEntries:['/tickets/one']});
  render(<QueryClientProvider client={client}><CollaborationProvider><RouterProvider router={router}/></CollaborationProvider></QueryClientProvider>);
  return {router,utilityRequests};
}

beforeEach(()=>{vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});});
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());useAuthStore.getState().logout();vi.unstubAllGlobals();vi.restoreAllMocks();if(clipboardDescriptor)Object.defineProperty(navigator,'clipboard',clipboardDescriptor);else Reflect.deleteProperty(navigator,'clipboard');});

it('retains the conversation through a utility request failure and restores actions only after explicit retry',async()=>{
  let unavailable=true;
  const {utilityRequests}=show(id=>unavailable?json({error:'Synthetic utility outage'},503):json(manifest(id)));
  await screen.findByRole('heading',{name:'Conversation one'});
  const retry=await screen.findByRole('button',{name:'Retry ticket actions'});
  expect(screen.queryByRole('button',{name:'Copy ticket reference'})).not.toBeInTheDocument();
  expect(utilityRequests).toEqual(['one']);
  unavailable=false;fireEvent.click(retry);
  expect(await screen.findByRole('button',{name:'Copy ticket reference'})).toBeEnabled();
  expect(screen.getByRole('heading',{name:'Conversation one'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Retry ticket actions'})).not.toBeInTheDocument();
  expect(utilityRequests).toEqual(['one','one']);
});

it('rejects a manifest for the previous ticket after route navigation, then shows current server denial without stale actions',async()=>{
  let wrongTicket=true;
  const {router}=show(id=>json(id==='two'&&wrongTicket?manifest('one'):manifest(id,id!=='two')));
  await screen.findByRole('button',{name:'Copy ticket reference'});
  await act(async()=>{await router.navigate('/tickets/two');});
  await screen.findByRole('heading',{name:'Conversation two'});
  const retry=await screen.findByRole('button',{name:'Retry ticket actions'});
  expect(screen.queryByRole('button',{name:'Copy ticket reference'})).not.toBeInTheDocument();
  wrongTicket=false;fireEvent.click(retry);
  expect(await screen.findByRole('button',{name:'Copy ticket reference'})).toBeDisabled();
  fireEvent.click(screen.getByText('More ticket actions'));
  expect(screen.getByRole('button',{name:'View ticket reference'})).toBeDisabled();
  expect(screen.queryByRole('link',{name:'Open action safety guidance'})).not.toBeInTheDocument();
  expect(screen.getAllByText('Reference access denied by policy.')).toHaveLength(3);
});

it('unmounts the active reference dialog and discards an unresolved copy result when the full page changes ticket',async()=>{
  let finishCopy!:()=>void;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>new Promise<void>(done=>{finishCopy=done;})}});
  const {router}=show(id=>json(manifest(id)));
  fireEvent.click(await screen.findByRole('button',{name:'Copy ticket reference'}));
  fireEvent.click(screen.getByText('More ticket actions'));
  const opener=screen.getByRole('button',{name:'View ticket reference'});opener.focus();fireEvent.click(opener);
  const dialog=await screen.findByRole('dialog',{name:'Ticket reference'});
  expect(within(dialog).getByText('#1')).toBeInTheDocument();
  await act(async()=>{await router.navigate('/tickets/two');finishCopy();});
  await screen.findByRole('heading',{name:'Conversation two'});
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText('Ticket reference copied.')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByText('More ticket actions'));
  const currentOpener=screen.getByRole('button',{name:'View ticket reference'});currentOpener.focus();fireEvent.click(currentOpener);
  const currentDialog=await screen.findByRole('dialog');
  expect(within(currentDialog).getByText('#2')).toBeInTheDocument();
  fireEvent.click(within(currentDialog).getByRole('button',{name:'Close ticket reference'}));
  await waitFor(()=>expect(currentOpener).toHaveFocus());
});
