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
const unavailableSla={response:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},resolution:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},handlerName:null};

function show(initial=preference(3), writeStatus=200) {
  const writes:unknown[]=[];
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('fetch',vi.fn(async (url:string,options:RequestInit)=>{
    const path=new URL(url,'http://localhost').pathname;
    if(path==='/api/workspace/state') { if(options.method==='PUT'){const body=JSON.parse(String(options.body));writes.push(body);return writeStatus===200 ? json({...body,revision:4,updatedAt:'2026-09-11T00:00:01Z'}) : json({error:'Conflict'},writeStatus);} return json(initial); }
    if(path.startsWith('/api/workspace/drafts')) return new Response(null,{status:204});
    if(path===`/api/tickets/${ticket.id}/sla`) return json(unavailableSla);
    if(path===`/api/tickets/${ticket.id}/utility-actions`) return json({version:1,ticketId:ticket.id,actions:[
      {id:'copy-ticket-reference',label:'Copy ticket reference',description:'Copies the current ticket reference.',slot:'action-bar',capability:'tools.reference.read',kind:'application-command',command:'copy-ticket-reference',enabled:true},
      {id:'view-ticket-reference',label:'View ticket reference',description:'Shows the current ticket reference in this workspace.',slot:'more',capability:'tools.reference.read',kind:'internal-dialog',dialog:'ticket-reference',enabled:true},
      {id:'open-governed-action-guidance',label:'Open action safety guidance',description:'Opens the documented action security boundary in a new tab.',slot:'more',capability:'tools.reference.read',kind:'external-link',href:'https://github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md',enabled:true},
    ]});
    if(path.startsWith('/api/tickets/')) return json(ticket);
    if(path==='/api/groups'||path==='/api/users/agents'||path==='/api/ticket-fields') return json([]);
    if(path==='/api/settings') return json({});
    return json([]);
  }));
  useAuthStore.getState().setAuth('workspace-session',{id:'operator',tenant_id:'tenant-a',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
  const router=createMemoryRouter([{path:'/tickets/:id',element:<TicketDetailPage/>}],{initialEntries:['/tickets/workspace-ticket']});
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CollaborationProvider><RouterProvider router={router}/></CollaborationProvider></QueryClientProvider>);
  return writes;
}
afterEach(()=>{cleanup();useAuthStore.getState().logout();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('records an authorized selected ticket and persists context-panel preference with focus return',async()=>{
  const writes=show();
  const trigger=await screen.findByRole('button',{name:'Show ticket context'});
  expect(screen.queryByRole('heading',{name:'Ticket Details'})).not.toBeInTheDocument();
  await waitFor(()=>expect(writes.some((value:any)=>value.selectedTicketId==='workspace-ticket')).toBe(true));
  fireEvent.click(trigger);
  const heading=await screen.findByRole('heading',{name:'Ticket Details'});
  expect(heading).toHaveFocus();
  await waitFor(()=>expect(writes.some((value:any)=>value.panel==='details')).toBe(true));
  fireEvent.click(screen.getByRole('button',{name:'Hide ticket context'}));
  expect(trigger).toHaveFocus();
  await waitFor(()=>expect(writes.some((value:any)=>value.panel==='conversation')).toBe(true));
});

it('does not re-record a selected ticket after preference conflict and restores server preferences explicitly',async()=>{
  const writes=show(preference(3,'details','workspace-ticket'),409);
  const trigger=await screen.findByRole('button',{name:'Hide ticket context'});
  fireEvent.click(trigger);
  await screen.findByRole('button',{name:'Restore server preferences'});
  expect(writes).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Restore server preferences'}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/workspace/state').length).toBeGreaterThan(1));
  expect(writes).toHaveLength(1);
});
