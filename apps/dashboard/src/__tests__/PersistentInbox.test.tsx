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

it('uses the authoritative actionable and snoozed queue views without losing the inbox surface',async()=>{
  showInbox();
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});

  fireEvent.click(screen.getByRole('button',{name:'Snoozed'}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('queue=snoozed'))).toBe(true));
  expect(screen.getByRole('button',{name:'Snoozed'})).toHaveAttribute('aria-pressed','true');
  await waitFor(()=>expect(screen.getByRole('option',{name:/Fixture conversation 1(?:\s|$)/})).toHaveTextContent('Snoozed'));

  fireEvent.click(screen.getByRole('button',{name:'Actionable'}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('queue=actionable'))).toBe(true));
  expect(screen.getByRole('button',{name:'Actionable'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('listbox',{name:'Conversation list'})).toBeInTheDocument();
});

it('labels filtering as current-view, clears it with a button or Escape, and resets to page one',async()=>{
  showInbox();
  const input=await screen.findByRole('textbox',{name:'Filter this view'});
  expect(input).toHaveAttribute('placeholder','Filter this view');
  fireEvent.change(input,{target:{value:'billing'}});
  fireEvent.submit(input.closest('form')!);
  await waitFor(()=>expect(input).toHaveValue('billing'));
  expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Current-view filter applied.');
  fireEvent.click(screen.getByRole('button',{name:'Clear current-view filter'}));
  await waitFor(()=>expect(input).toHaveValue(''));
  expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Current-view filter cleared.');
  fireEvent.change(input,{target:{value:'urgent'}});
  fireEvent.keyDown(input,{key:'Escape'});
  expect(input).toHaveValue('');
  expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Current-view filter cleared.');
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

function preserveCustomPage(selectedTicketId:string|null=null){
  const fallback=fetch;
  let confirmed={...workspace(selectedTicketId),view:'custom',filters:{filterId:'priority-follow-up'},sort:'created_asc',listQuery:'follow up',listAnchor:'page:3'};
  const writes:typeof confirmed[]=[];
  const queries:URLSearchParams[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url==='/api/workspace/state'){
      if(options.method==='PUT'){
        confirmed={...confirmed,...JSON.parse(String(options.body)),revision:confirmed.revision+1};
        writes.push(confirmed);
      }
      return json(confirmed);
    }
    if(url.startsWith('/api/tickets?')){
      queries.push(new URL(url,'http://localhost').searchParams);
      return json({data:tickets,meta:{page:3,limit:20,total:60,total_pages:3}});
    }
    return fallback(url,options);
  }));
  return {writes,queries};
}

it('switches all 20 fixture conversations and returns without losing the custom view, page, query or mounted list',async()=>{
  const {writes,queries}=preserveCustomPage();
  showInbox('/inbox/priority-follow-up');
  const list=screen.getByRole('listbox',{name:'Conversation list'});
  const options=await within(list).findAllByRole('option');
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Filter this view'})).toHaveValue('follow up'));
  const pane=screen.getByRole('region',{name:'Conversations'});
  pane.scrollTop=480;
  const queryInput=screen.getByRole('textbox',{name:'Filter this view'});
  const sortInput=screen.getByRole('combobox',{name:'Sort conversations'});
  const location=screen.getByTestId('location');

  for(const [index,ticket] of tickets.entries()){
    fireEvent.click(options[index]);
    await screen.findByRole('heading',{name:`Conversation ${ticket.id}`});
    expect(location).toHaveTextContent(`/inbox/priority-follow-up/${ticket.id}`);
    expect(list).toBeInTheDocument();
    expect(pane).toBeInTheDocument();
    expect(pane.scrollTop).toBe(480);
    expect(queryInput).toHaveValue('follow up');
    expect(sortInput).toHaveValue('created_asc');
  }
  fireEvent.click(screen.getByRole('link',{name:'Back to conversations'}));
  await screen.findByRole('heading',{name:'Choose a conversation'});
  expect(screen.getByTestId('location').textContent).toBe('/inbox/priority-follow-up');
  expect(list).toBeInTheDocument();
  expect(pane.scrollTop).toBe(480);
  expect(queryInput).toHaveValue('follow up');
  await waitFor(()=>expect(writes.length).toBeGreaterThan(0));
  for(const write of writes){
    expect(write).toMatchObject({view:'custom',filters:{filterId:'priority-follow-up'},sort:'created_asc',listQuery:'follow up',listAnchor:'page:3'});
  }
  expect(queries.some(query=>query.get('page')==='3'&&query.get('filter_id')==='priority-follow-up'&&query.get('sort')==='created_asc'&&query.get('search')==='follow up')).toBe(true);
},15_000);

it('keeps the custom list position and selected conversation when its draft refuses Back navigation, then returns after acknowledgement',async()=>{
  const {writes}=preserveCustomPage('ticket-20');
  detailNavigation.pending=true;
  detailNavigation.flush.mockResolvedValue(false);
  showInbox('/inbox/priority-follow-up/ticket-20');
  await screen.findByRole('heading',{name:'Conversation ticket-20'});
  const pane=screen.getByRole('region',{name:'Conversations'});
  pane.scrollTop=640;
  const list=screen.getByRole('listbox',{name:'Conversation list'});
  fireEvent.click(screen.getByRole('link',{name:'Back to conversations'}));
  await screen.findByRole('alert');
  expect(detailNavigation.flush).toHaveBeenCalledOnce();
  expect(screen.getByTestId('location').textContent).toBe('/inbox/priority-follow-up/ticket-20');
  expect(screen.getByRole('heading',{name:'Conversation ticket-20'})).toBeInTheDocument();
  expect(screen.getByRole('option',{name:/Fixture conversation 20/})).toHaveAttribute('aria-selected','true');
  expect(writes).toHaveLength(0);
  expect(pane.scrollTop).toBe(640);

  detailNavigation.flush.mockResolvedValue(true);
  fireEvent.click(screen.getByRole('link',{name:'Back to conversations'}));
  await screen.findByRole('heading',{name:'Choose a conversation'});
  expect(detailNavigation.flush).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('location').textContent).toBe('/inbox/priority-follow-up');
  expect(screen.getByRole('listbox',{name:'Conversation list'})).toBe(list);
  expect(pane.scrollTop).toBe(640);
  expect(screen.getByRole('textbox',{name:'Filter this view'})).toHaveValue('follow up');
  expect(screen.getByRole('combobox',{name:'Sort conversations'})).toHaveValue('created_asc');
});

it('uses server Drafts queue results and reports an empty saved-draft view without implying all work is complete',async()=>{
  const fallback=fetch;
  let empty=false;
  let release!:()=>void;
  let firstRead=true;
  let pauseSnoozed=false;
  let releaseSnoozed!:()=>void;
  const pendingSnoozed=new Promise<void>(done=>{releaseSnoozed=done;});
  const pending=new Promise<void>(done=>{release=done;});
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url.startsWith('/api/tickets?')&&new URL(url,'http://localhost').searchParams.get('queue')==='drafts') {
      if(firstRead){firstRead=false;await pending;}
      return json({data:empty?[]:[{...tickets[19],inclusion_reason:'drafts'}],meta:{page:1,limit:20,total:empty?0:1,total_pages:empty?0:1}});
    }
    if(pauseSnoozed&&url.startsWith('/api/tickets?')&&new URL(url,'http://localhost').searchParams.get('queue')==='snoozed') await pendingSnoozed;
    return fallback(url,options);
  }));
  showInbox('/inbox/actionable');
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  fireEvent.click(screen.getByRole('button',{name:'Drafts'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Refreshing…'));
  expect(screen.getByRole('option',{name:/Fixture conversation 1(?:\s|$)/})).toBeInTheDocument();
  expect(screen.queryByLabelText('Inclusion reason: drafts')).not.toBeInTheDocument();
  release();
  await waitFor(()=>expect(within(screen.getByRole('listbox',{name:'Conversation list'})).getAllByRole('option')).toHaveLength(1));
  expect(screen.getByRole('button',{name:'Drafts'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('option',{name:/Fixture conversation 20/})).toHaveTextContent('Drafts');
  expect(screen.getByLabelText('Inclusion reason: drafts')).toBeInTheDocument();
  expect(screen.queryByRole('option',{name:/Fixture conversation 1(?:\s|$)/})).not.toBeInTheDocument();
  empty=true;
  await client.invalidateQueries({queryKey:['tickets']});
  await screen.findByText('No saved drafts');
  expect(screen.getByText('Conversations with your saved drafts.')).toBeInTheDocument();
  expect(screen.queryByText(/all work complete|inbox zero/i)).not.toBeInTheDocument();
  // An empty previous result cannot establish that the newly selected queue is empty.
  pauseSnoozed=true;
  fireEvent.click(screen.getByRole('button',{name:'Snoozed'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Refreshing…'));
  expect(screen.queryByText('No snoozed conversations')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Table view'}));
  expect(screen.queryByText('No snoozed conversations')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'List view'}));
  releaseSnoozed();
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
});

it('opens authoritative Mine and Unassigned views without claiming refreshed ownership prematurely',async()=>{
  const fallback=fetch;
  let release!:()=>void;
  const pending=new Promise<void>(done=>{release=done;});
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url.startsWith('/api/tickets?')){
      const queue=new URL(url,'http://localhost').searchParams.get('queue');
      if(queue==='mine')return json({data:[{...tickets[0],inclusion_reason:'mine'}],meta:{page:1,limit:20,total:1,total_pages:1}});
      if(queue==='unassigned'){await pending;return json({data:[],meta:{page:1,limit:20,total:0,total_pages:0}});}
    }
    return fallback(url,options);
  }));
  showInbox('/inbox/mine');
  await screen.findByLabelText('Inclusion reason: mine');
  expect(screen.getByRole('button',{name:'Mine'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByText(/Current view:/)).toHaveTextContent('Current view: Mine');
  fireEvent.click(screen.getByRole('button',{name:'Unassigned'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Refreshing…'));
  expect(screen.getByRole('option',{name:/Fixture conversation 1(?:\s|$)/})).toBeInTheDocument();
  expect(screen.queryByLabelText('Inclusion reason: unassigned')).not.toBeInTheDocument();
  expect(screen.queryByText('No unassigned conversations')).not.toBeInTheDocument();
  release();
  await screen.findByText('No unassigned conversations');
  expect(screen.getByRole('button',{name:'Unassigned'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByText('Open and pending conversations without an assignee and ready for work.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Table view'}));
  expect(within(screen.getByRole('table')).getByText('No unassigned conversations')).toBeInTheDocument();
});
