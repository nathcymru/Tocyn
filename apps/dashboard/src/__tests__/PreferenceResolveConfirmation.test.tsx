import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { CollaborationProvider } from '../components/CollaborationContext';
import { useAuthStore } from '../store/authStore';

class Socket { static OPEN=1; readyState=1; onopen:null|(()=>void)=null; onclose:null|(()=>void)=null; onmessage:null|((event:{data:string})=>void)=null; onerror:null|(()=>void)=null; send(){} close(){} }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const preference=(revision:number,panel:'conversation'|'details'='conversation',selectedTicketId:string|null=null)=>({revision,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId,panel,updatedAt:'2026-09-11T00:00:00Z'});
const ticket={id:'workspace-ticket',subject:'Workspace ticket',customer_email:'customer@example.invalid',ticket_no:1,status:'open',priority:'normal',assigned_to:null,group_id:null,created_at:'2026-09-11T00:00:00Z',articles:[],pagination:{limit:20,next_cursor:null,has_more:false}};
const history={events:[{id:'event-1',kind:'ticket.intake',recordedAt:'2026-09-11T00:00:00Z',source:'dashboard',visibility:'public' as const,actor:{kind:'staff',id:'agent-a',provenance:'mfa-staff' as const},facts:{},articleId:null}],nextCursor:null};
const unavailableSla={response:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},resolution:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},handlerName:null};

const presentation = vi.hoisted(() => ({ enabled: true, contextDefault: 'remember' as 'remember'|'conversation'|'details' }));
vi.mock('../components/theme/OperatorThemeProvider', () => ({
  useOptionalOperatorPreferencesContext: () => ({ advanceAfterResolve: presentation.enabled, contextDefault: presentation.contextDefault, status: 'restored' }),
}));
let client: QueryClient;
function show(remoteResolved = false) {
  let saved = remoteResolved;
  let failConfirmation = false;
  const onResolved = vi.fn();
  const writes: unknown[] = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path === `/api/tickets/${ticket.id}`) {
      if (options.method === 'PATCH') { writes.push(JSON.parse(String(options.body))); saved = true; failConfirmation = true; return json({success: true}); }
      if (failConfirmation) return json({error: 'Synthetic confirmation unavailable'}, 503);
      return json({...ticket, status: saved ? 'resolved' : 'open'});
    }
    if (path === '/api/workspace/state') return json(options.method === 'PUT' ? {...JSON.parse(String(options.body)), revision: 4} : preference(3));
    if (path.startsWith('/api/workspace/drafts')) return new Response(null, {status: 204});
    if (path.endsWith('/history')) return json(history);
    if (path.endsWith('/sla')) return json(unavailableSla);
    if (path === '/api/settings') return json({});
    return json([]);
  }));
  useAuthStore.getState().setAuth('synthetic-session', {id:'operator',tenant_id:'tenant-a',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
  client = new QueryClient({defaultOptions:{queries:{retry:false}, mutations:{retry:false}}});
  const router = createMemoryRouter([{path:'/tickets/:id',element:<TicketDetailPage onResolved={onResolved}/>}],{initialEntries:['/tickets/workspace-ticket']});
  render(<QueryClientProvider client={client}><CollaborationProvider><RouterProvider router={router}/></CollaborationProvider></QueryClientProvider>);
  return {onResolved, writes, restore: () => {failConfirmation = false;}};
}
afterEach(() => {cleanup();client?.clear();useAuthStore.getState().logout();presentation.enabled=true;presentation.contextDefault='remember';localStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('advances once only after local resolve acknowledgement and a successful explicit confirmation retry', async () => {
  const fixture = show();
  fireEvent.change(await screen.findByRole('combobox', {name:'Status'}), {target:{value:'resolved'}});
  await screen.findByText('Ticket details saved. Refresh the ticket before making another change.');
  expect(fixture.writes).toEqual([{status:'resolved'}]);
  expect(fixture.onResolved).not.toHaveBeenCalled();
  fixture.restore();
  fireEvent.click(screen.getByRole('button', {name:'Retry loading ticket'}));
  await waitFor(() => expect(fixture.onResolved).toHaveBeenCalledExactlyOnceWith('workspace-ticket'));
  await client.invalidateQueries({queryKey:['ticket', 'workspace-ticket']});
  expect(fixture.onResolved).toHaveBeenCalledTimes(1);
});

it('does not advance from a remotely resolved ticket without an acknowledged local resolve', async () => {
  const fixture = show(true);
  expect(await screen.findByRole('combobox', {name:'Status'})).toHaveValue('resolved');
  await client.invalidateQueries({queryKey:['ticket', 'workspace-ticket']});
  expect(fixture.writes).toHaveLength(0);
  expect(fixture.onResolved).not.toHaveBeenCalled();
});


it('does not advance on confirmation retry after the preference is turned off', async()=>{
  const fixture=show();
  fireEvent.change(await screen.findByRole('combobox',{name:'Status'}),{target:{value:'resolved'}});
  await screen.findByText('Ticket details saved. Refresh the ticket before making another change.');
  presentation.enabled=false;fixture.restore();
  fireEvent.click(screen.getByRole('button',{name:'Retry loading ticket'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Retry loading ticket'})).not.toBeInTheDocument());
  expect(fixture.onResolved).not.toHaveBeenCalled();
});

it('applies the explicit context default once and preserves a subsequent manual toggle',async()=>{
  presentation.contextDefault='details';show();
  fireEvent.click(await screen.findByRole('button',{name:'Hide ticket context'}));
  await screen.findByRole('button',{name:'Show ticket context'});
  await client.invalidateQueries({queryKey:['ticket','workspace-ticket']});
  expect(screen.getByRole('button',{name:'Show ticket context'})).toBeInTheDocument();
});
