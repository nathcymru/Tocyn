import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter,Link,RouterProvider,useLocation } from 'react-router-dom';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { InboxWorkspacePage } from '../pages/InboxWorkspacePage';
import { useAuthStore } from '../store/authStore';


const detailNavigation=vi.hoisted(()=>({pending:false,flush:vi.fn<()=>Promise<boolean>>() }));
vi.mock('../pages/TicketDetailPage',async()=>{
  const {DraftNavigationGuard}=await vi.importActual<typeof import('../components/DraftNavigationGuard')>('../components/DraftNavigationGuard');
  return {TicketDetailPage:({id,workspaceBackHref}:{id:string;workspaceBackHref:string})=><article>
    <DraftNavigationGuard pending={detailNavigation.pending} flush={detailNavigation.flush}/>
    <h1>{`Conversation ${id}`}</h1><Link to={workspaceBackHref}>Back to conversations</Link>
  </article>};
});

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const operator={id:'operator',tenant_id:'tenant-a',email:'operator@example.invalid',full_name:'Operator',role:'admin',mfa_enabled:true};
const tickets=Array.from({length:20},(_,index)=>({
  id:`ticket-${index+1}`,ticket_no:index+1,subject:`Fixture conversation ${index+1}`,customer_email:`customer-${index+1}@example.invalid`,
  status:index%3===0?'pending':'open',priority:index%5===0?'high':'normal',snippet:`Last confirmed message ${index+1}`,
  created_at:'2026-09-11T00:00:00Z',updated_at:`2026-09-11T00:${String(index).padStart(2,'0')}:00Z`,
}));
const unavailableSla={response:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},resolution:{state:'unavailable',phase:'unavailable',completedAt:null,dueAt:null,remainingWorkingMilliseconds:null,targetWorkingMilliseconds:null},handlerName:null};
const workspace=(selectedTicketId:string|null=null)=>({revision:4,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'page:1',selectedTicketId,panel:'conversation',updatedAt:'2026-09-11T00:00:00Z'});
let client:QueryClient;
let savedSelection:string|null=null;

function Location(){const location=useLocation();return <output data-testid="location">{location.pathname}</output>;}
function showInbox(entry='/inbox/all'){
  const router=createMemoryRouter([{path:'/inbox/*',element:<><InboxWorkspacePage/><Location/></>}],{initialEntries:[entry]});
  const result=render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
  return {...result,router};
}

beforeEach(()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false,refetchInterval:false},mutations:{retry:false}}});
  useAuthStore.setState({token:null,user:null,mfaRequired:false,sessionGeneration:0});
  useAuthStore.getState().setAuth('tenant-session',operator);
  savedSelection=null;
  detailNavigation.pending=false;
  detailNavigation.flush.mockReset().mockResolvedValue(true);
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url==='/api/workspace/state'&&options.method==='PUT'){
      const input=JSON.parse(String(options.body));savedSelection=input.selectedTicketId??null;
      return json({...input,revision:5,updatedAt:'2026-09-11T00:01:00Z'});
    }
    if(url==='/api/workspace/state')return json(workspace(savedSelection));
    if(url==='/api/workspace/drafts?limit=50')return json({items:[{ticketId:'ticket-20',updatedAt:'2026-09-11T00:00:00Z'}],next:null});
    if(url==='/api/settings/filters')return json([{id:'priority-follow-up',name:'Priority follow-up'}]);
    if(url==='/api/settings')return json({TICKET_PREFIX:'#'});
    if(url.startsWith('/api/tickets?'))return json({data:tickets,meta:{page:1,limit:20,total:20,total_pages:1}});
    if(url==='/api/ticket-sla/projections')return json(Object.fromEntries(tickets.map(ticket=>[ticket.id,unavailableSla])));
    return json([]);
  }));
});
afterEach(()=>{cleanup();client.clear();useAuthStore.getState().logout();localStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('keeps the 20-result list node, scroll position and roving focus while conversations change',async()=>{
  showInbox();
  const list=screen.getByRole('listbox',{name:'Conversation list'});
  const options=await within(list).findAllByRole('option');
  expect(options).toHaveLength(20);
  const listPane=screen.getByRole('region',{name:'Conversations'});
  listPane.scrollTop=480;

  options[0].focus();fireEvent.keyDown(options[0],{key:'ArrowDown'});
  expect(options[1]).toHaveFocus();
  fireEvent.click(options[0]);
  await screen.findByRole('heading',{name:'Conversation ticket-1'});
  await waitFor(()=>expect(savedSelection).toBe('ticket-1'));
  expect(screen.getByRole('listbox',{name:'Conversation list'})).toBe(list);
  expect(screen.getByRole('region',{name:'Conversations'})).toBe(listPane);
  expect(listPane.scrollTop).toBe(480);

  options[0].focus();
  fireEvent.keyDown(options[0],{key:'ArrowDown'});
  fireEvent.keyDown(options[1],{key:'ArrowDown'});
  expect(options[2]).toHaveFocus();
  expect(options[2]).toHaveAttribute('tabindex','0');
  await userEvent.tab();
  expect(screen.getByRole('link',{name:'Back to conversations'})).toHaveFocus();
  await userEvent.tab({shift:true});
  expect(options[2]).toHaveFocus();

  fireEvent.click(screen.getByRole('option',{name:/Fixture conversation 20/}));
  await screen.findByRole('heading',{name:'Conversation ticket-20'});
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-20');
  expect(screen.getByRole('listbox',{name:'Conversation list'})).toBe(list);
  expect(listPane.scrollTop).toBe(480);
  expect(screen.getByRole('option',{name:/Fixture conversation 20/})).toHaveTextContent('Draft');
});

it('switches to an accessible factual table with row navigation and a mobile list fallback',async()=>{
  showInbox();
  await screen.findByRole('option',{name:/Fixture conversation 1 customer-1/});
  const tableView=screen.getByRole('button',{name:'Table view'});
  fireEvent.click(tableView);
  expect(tableView).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('table',{name:'Tickets in the current view'})).toBeInTheDocument();
  expect(screen.getByRole('columnheader',{name:'Reference'})).toBeInTheDocument();
  expect(screen.getByRole('columnheader',{name:'Customer'})).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Fixture conversation 1'})).toHaveAttribute('href','/inbox/all/ticket-1');
  expect(screen.getByText('Table view uses the compact conversation list on small screens.')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Actions for/})).not.toBeInTheDocument();
});

it('does not persist a view switch before an unsaved conversation draft permits navigation',async()=>{
  savedSelection='ticket-1';
  detailNavigation.pending=true;
  detailNavigation.flush.mockResolvedValue(false);
  showInbox('/inbox/all/ticket-1');
  await screen.findByRole('heading',{name:'Conversation ticket-1'});

  fireEvent.click(screen.getByRole('button',{name:'Priority follow-up'}));
  await waitFor(()=>expect(detailNavigation.flush).toHaveBeenCalledOnce());
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-1');
  await new Promise(resolve=>setTimeout(resolve,350));
  expect(savedSelection).toBe('ticket-1');
});

it('restores the selected conversation on reload without putting workspace state in the URL',async()=>{
  savedSelection='ticket-20';
  showInbox('/inbox');
  await screen.findByRole('heading',{name:'Conversation ticket-20'});
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-20'));
  expect(within(screen.getByRole('listbox',{name:'Conversation list'})).getAllByRole('option')).toHaveLength(20);
  expect(screen.getByRole('option',{name:/Fixture conversation 20/})).toHaveAttribute('aria-selected','true');
  expect(screen.getByTestId('location')).not.toHaveTextContent('customer');
});

it('keeps a confirmed conversation and draft/list visibility while workspace preferences are in conflict until explicit restore',async()=>{
  const restoredWorkspace=(selectedTicketId='ticket-20',listQuery='restored query')=>({
    revision: 8, view: 'all', sort: 'updated_desc', filters: {}, listQuery, listAnchor: 'page:1', selectedTicketId, panel: 'conversation', updatedAt: '2026-09-11T00:01:00Z',
  });
  let readState=true;
  let reads=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url==='/api/workspace/state'&&options.method==='PUT') return readState ? json({error:'Conflict'},409) : json({...JSON.parse(String(options.body)),revision:9});
    if(url==='/api/workspace/state') {
      const next=readState?{revision:4,view:'all',sort:'updated_desc',filters:{},listQuery:'saved query',listAnchor:'page:1',selectedTicketId:'ticket-20',panel:'conversation',updatedAt:'2026-09-11T00:00:00Z'}:restoredWorkspace('ticket-20','restored query');
      reads++;
      readState=reads<2;
      return json(next);
    }
    if(url==='/api/workspace/drafts?limit=50') return json({ items: [{ ticketId: 'ticket-20', updatedAt: '2026-09-11T00:00:00Z' }], next: null });
    if(url==='/api/settings/filters') return json([{ id: 'priority-follow-up', name: 'Priority follow-up' }]);
    if(url==='/api/settings') return json({TICKET_PREFIX:'#'});
    if(url.startsWith('/api/tickets?')) return json({data:tickets,meta:{page:1,limit:20,total:20,total_pages:1}});
    if(url==='/api/ticket-sla/projections') return json(Object.fromEntries(tickets.map(ticket=>[ticket.id,unavailableSla])));
    return json([]);
  }));
  showInbox('/inbox');
  await screen.findByRole('heading',{name:'Conversation ticket-20'});
  expect(screen.getByRole('option',{name:/Fixture conversation 20/})).toHaveAttribute('aria-selected','true');
  expect(screen.getByRole('option',{name:/Fixture conversation 20/})).toHaveTextContent('Draft');

  fireEvent.change(screen.getByRole('combobox',{name:'Sort conversations'}),{target:{value:'created_asc'}});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Workspace preferences changed in another session. Review before replacing them.'));
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-20');
  expect(screen.getByRole('heading',{name:'Conversation ticket-20'})).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button',{name:'Restore saved view'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Restore saved view'})).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('option',{name:/Fixture conversation 1(?:\s|$)/}));
  await screen.findByRole('heading',{name:'Conversation ticket-1'});
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-1');
});

it('shows recovery and no historical rows when the current tenant list read is denied',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url==='/api/workspace/state')return json(workspace());
    if(url==='/api/workspace/drafts?limit=50')return json({items:[],next:null});
    if(url==='/api/settings/filters')return json([]);
    if(url==='/api/settings')return json({TICKET_PREFIX:'#'});
    if(url.startsWith('/api/tickets?'))return json({error:'Forbidden'},403);
    return json({});
  }));
  showInbox();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load conversations.');
  expect(within(screen.getByRole('listbox',{name:'Conversation list'})).queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByRole('button',{name:'Retry conversations'})).toBeEnabled();
});
