import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { CollaborationProvider } from '../components/CollaborationContext';
import { useAuthStore } from '../store/authStore';

class Socket { static OPEN=1; readyState=1; onopen:null|(()=>void)=null; onclose:null|(()=>void)=null; onmessage:null|((event:{data:string})=>void)=null; onerror:null|(()=>void)=null; send(){} close(){} }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const preference=(revision:number,panel:'conversation'|'details'='conversation',selectedTicketId:string|null=null)=>({revision,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId,panel,splitterRatio:32,updatedAt:'2026-09-11T00:00:00Z'});
const ticket={id:'workspace-ticket',subject:'Workspace ticket',customer_email:'customer@example.invalid',ticket_no:1,status:'open',priority:'normal',assigned_to:null,group_id:null,created_at:'2026-09-11T00:00:00Z',articles:[],pagination:{limit:20,next_cursor:null,has_more:false}};
const history={events:[{id:'event-1',kind:'ticket.intake',recordedAt:'2026-09-11T00:00:00Z',source:'dashboard',visibility:'public' as const,actor:{kind:'staff',id:'agent-a',provenance:'mfa-staff' as const},facts:{},articleId:null}],nextCursor:null};
const unavailableSla={response:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},resolution:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},handlerName:null};

function show(initial=preference(3), writeStatus=200, config: {
  historyPage?: (cursor: string | null, request: RequestInit) => Response | Promise<Response>;
  agents?: unknown[];
} = {}) {
  const writes:unknown[]=[];
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('fetch',vi.fn(async (url:string,options:RequestInit)=>{
    const address=new URL(url,'http://localhost');
    const path=address.pathname;
    if(path==='/api/workspace/state') { if(options.method==='PUT'){const body=JSON.parse(String(options.body));writes.push(body);return writeStatus===200 ? json({...body,revision:4,updatedAt:'2026-09-11T00:00:01Z'}) : json({error:'Conflict'},writeStatus);} return json(initial); }
    if(path==='/api/tickets/workspace-ticket/history') return config.historyPage
      ? config.historyPage(address.searchParams.get('cursor'),options) : json(history);
    if(path.startsWith('/api/workspace/drafts')) return new Response(null,{status:204});
    if(path===`/api/tickets/${ticket.id}/sla`) return json(unavailableSla);
    if(path===`/api/tickets/${ticket.id}/utility-actions`) return json({version:1,ticketId:ticket.id,actions:[
      {id:'copy-ticket-reference',label:'Copy ticket reference',description:'Copies the current ticket reference.',slot:'action-bar',capability:'tools.reference.read',kind:'application-command',command:'copy-ticket-reference',enabled:true},
      {id:'view-ticket-reference',label:'View ticket reference',description:'Shows the current ticket reference in this workspace.',slot:'more',capability:'tools.reference.read',kind:'internal-dialog',dialog:'ticket-reference',enabled:true},
      {id:'open-governed-action-guidance',label:'Open action safety guidance',description:'Opens the documented action security boundary in a new tab.',slot:'more',capability:'tools.reference.read',kind:'external-link',href:'https://github.com/nathcymru/Tocyn/blob/main/docs/security/capability-permissions.md',enabled:true},
    ]});
    if(path.startsWith('/api/tickets/')) return json(ticket);
    if(path==='/api/users/agents') return json(config.agents ?? []);
    if(path==='/api/groups'||path==='/api/ticket-fields') return json([]);
    if(path==='/api/settings') return json({});
    return json([]);
  }));
  useAuthStore.getState().setAuth('workspace-session',{id:'operator',tenant_id:'tenant-a',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true});
  const router=createMemoryRouter([{path:'/inbox/all/:id',element:<TicketDetailPage/>}],{initialEntries:['/inbox/all/workspace-ticket']});
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
  expect(screen.getByText('Customer')).toBeInTheDocument();
  await waitFor(()=> {
    expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/api/tickets/workspace-ticket/history'))).toBe(true);
  });
  const historyLoading = await screen.findByText('Loading ticket history…').catch(() => null);
  if (historyLoading) {
    await waitFor(() => expect(screen.queryByText('Loading ticket history…')).not.toBeInTheDocument());
  }
  expect(screen.queryByText(/Ticket history unavailable/)).not.toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Ticket history'})).toBeInTheDocument();
  await screen.findByText(/Ticket intake/);
  expect(screen.getByText(/agent-a/)).toBeInTheDocument();
  expect(screen.getByText('Operational context')).toBeInTheDocument();
  expect(screen.getByText(/No operational source is connected/)).toBeInTheDocument();
  expect(screen.getByText('Knowledge')).toBeInTheDocument();
  expect(screen.getByText('Collaboration')).toBeInTheDocument();
  expect(screen.getByText(/No collaborators are viewing/)).toBeInTheDocument();
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

it('shows actor and time for snooze changes on later ticket-history pages and retries a failed page',async()=>{
  const recordedAt='2026-09-11T01:00:00Z';
  const staff={kind:'staff',id:'agent-a',provenance:'mfa-staff'};
  const event=(id:string,kind:string,facts:Record<string,unknown>,actor:unknown=staff,source='dashboard')=>
    ({id,kind,recordedAt,source,visibility:'internal',actor,facts,articleId:null});
  const first={events:[
    event('event-1','ticket.intake',{}),event('event-2','ticket.state_changed',{before:{status:'open'},after:{status:'pending'}}),
    event('event-3','message.reply',{}),event('event-4','ticket.assignment_changed',{}),
    event('event-5','message.reply',{}),
  ],nextCursor:'11111111-1111-4111-8111-111111111111'};
  const second={events:[
    event('event-6','ticket.state_changed',{before:{snoozedUntil:null},after:{snoozedUntil:'2026-09-12T09:00:00Z'}}),
    event('event-7','ticket.state_changed',{before:{snoozedUntil:'2026-09-12T09:00:00Z'},after:{snoozedUntil:null}},
      {kind:'staff',id:'agent-missing',provenance:'mfa-staff'}),
    event('event-8','ticket.state_changed',{before:{snoozedUntil:'2026-09-12T09:00:00Z'},after:{snoozedUntil:'2026-09-13T09:00:00Z'}},
      {kind:'system',id:null,provenance:'api-key'},'system'),
  ],nextCursor:null};
  let nextAttempts=0;
  show(preference(3,'details','workspace-ticket'),200,{
    agents:[{id:'agent-a',full_name:'Ari Operator',email:'ari@example.invalid'}],
    historyPage:(cursor)=>{
      if(!cursor)return json(first);
      nextAttempts++;
      return nextAttempts===1?json({error:'Temporary page failure'},503):json(second);
    },
  });
  expect(await screen.findByText('Ticket intake — Ari Operator')).toBeInTheDocument();
  expect(screen.getByText('Ticket state changed — Ari Operator')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Load more history'}));
  expect(await screen.findByText('More ticket history could not be loaded')).toBeInTheDocument();
  expect(screen.getByText('Ticket intake — Ari Operator')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry more history'}));
  const snoozed=await screen.findByText('Snoozed ticket — Ari Operator');
  expect(snoozed.closest('li')?.querySelector('time')).toHaveAttribute('datetime','2026-09-11T01:00:00.000Z');
  expect(screen.getByText('Unsnoozed ticket — agent-missing')).toBeInTheDocument();
  expect(screen.getByText('Changed snooze time — System')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Load more history'})).not.toBeInTheDocument();
  expect(nextAttempts).toBe(2);
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('cursor=11111111-1111-4111-8111-111111111111'))).toHaveLength(2);
});

it('does not reuse ticket history from an earlier authenticated identity',async()=>{
  show(preference(3,'details','workspace-ticket'),200,{
    historyPage:(_cursor,request)=>{
      const token=new Headers(request.headers).get('Authorization');
      return json({events:[{
        id:token==='Bearer workspace-session'?'old-event':'new-event',kind:'ticket.state_changed',
        recordedAt:'2026-09-11T01:00:00Z',source:'dashboard',visibility:'internal',
        actor:{kind:'staff',id:token==='Bearer workspace-session'?'old-actor':'new-actor',provenance:'mfa-staff'},
        facts:{},articleId:null,
      }],nextCursor:null});
    },
  });
  expect(await screen.findByText('Ticket state changed — old-actor')).toBeInTheDocument();
  useAuthStore.getState().setAuth('second-session',{
    id:'operator-b',tenant_id:'tenant-b',email:'operator-b@example.invalid',full_name:'Other Operator',role:'admin',mfa_enabled:true,
  });
  expect(await screen.findByText('Ticket state changed — new-actor')).toBeInTheDocument();
  expect(screen.queryByText('Ticket state changed — old-actor')).not.toBeInTheDocument();
});
