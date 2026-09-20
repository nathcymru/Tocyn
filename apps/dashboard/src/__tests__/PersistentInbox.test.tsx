import { GlobalSearch } from '../components/layout/GlobalSearch';
import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter,Link,RouterProvider,useLocation } from 'react-router-dom';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { InboxWorkspacePage } from '../pages/InboxWorkspacePage';
import { useAuthStore } from '../store/authStore';


const presentation=vi.hoisted(()=>({enabled:true,listeners:new Set<()=>void>()}));
vi.mock('../components/theme/OperatorThemeProvider',async()=>{
  const {useSyncExternalStore}=await import('react');
  return {useOptionalOperatorPreferencesContext:()=>({advanceAfterResolve:useSyncExternalStore(listener=>{presentation.listeners.add(listener);return()=>presentation.listeners.delete(listener);},()=>presentation.enabled)})};
});
const detailNavigation=vi.hoisted(()=>({pending:false,flush:vi.fn<()=>Promise<boolean>>() }));
vi.mock('../pages/TicketDetailPage',async()=>{
  const {DraftNavigationGuard}=await vi.importActual<typeof import('../components/DraftNavigationGuard')>('../components/DraftNavigationGuard');
  const {useOperatorWorkspaceState}=await vi.importActual<typeof import('../hooks/useOperatorWorkspaceState')>('../hooks/useOperatorWorkspaceState');
  return {TicketDetailPage:({id,workspaceBackHref,onResolved}:{id:string;workspaceBackHref:string;onResolved?:(id:string)=>void})=>{const state=useOperatorWorkspaceState();return <article>
    <DraftNavigationGuard pending={detailNavigation.pending} flush={detailNavigation.flush}/>
    <button tabIndex={-1} onClick={()=>state.update({filters:{...state.filters,status:'pending'}})}>Synthetic change filter</button>
    <button tabIndex={-1} onClick={()=>onResolved?.(id)}>Synthetic confirmed resolve</button><h1>{`Conversation ${id}`}</h1><Link to={workspaceBackHref}>Back to conversations</Link>
  </article>;}};
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
function showInbox(entry='/inbox/all',globalSearch=false){
  const router=createMemoryRouter([{path:'/inbox/*',element:<>{globalSearch&&<GlobalSearch shortcutsEnabled />}<InboxWorkspacePage/><Location/></>}],{initialEntries:[entry]});
  const result=render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
  return {...result,router};
}
async function chooseSort(option:string){
  openFilters();
  await userEvent.click(screen.getByRole('button',{name:/^Sort:/}));
  await userEvent.click(await screen.findByRole('menuitem',{name:option}));
  fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
}
async function chooseView(label:string){
  await userEvent.click(screen.getByRole('button',{name:'Inbox views'}));
  await userEvent.click(within(await screen.findByRole('menu',{name:'Inbox views'})).getByRole('menuitem',{name:label}));
}
async function choosePresentation(label:'List view'|'Table view'){await chooseView(label);}
function openFilters(){
  const trigger=screen.getByRole('button',{name:'Filter tickets'});
  if(trigger.getAttribute('aria-expanded')!=='true')fireEvent.click(trigger);
}

beforeEach(()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false,refetchInterval:false},mutations:{retry:false}}});
  useAuthStore.setState({token:null,user:null,mfaRequired:false,sessionGeneration:0});
  useAuthStore.getState().setAuth('tenant-session',operator);
  savedSelection=null;presentation.enabled=true;
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
    if(url==='/api/tickets/queue-counts')return json({scope:'standard_queues',counts:{all:20,actionable:20,mine:0,unassigned:20,mentions:0,drafts:1,snoozed:0}});
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
  expect(screen.getByRole('separator',{name:'Resize conversation panes'})).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('link',{name:'Back to conversations'})).toHaveFocus();
  await userEvent.tab({shift:true});
  expect(screen.getByRole('separator',{name:'Resize conversation panes'})).toHaveFocus();
  await userEvent.tab({shift:true});
  expect(options[2]).toHaveFocus();

  fireEvent.click(screen.getByRole('option',{name:/Fixture conversation 20/}));
  await screen.findByRole('heading',{name:'Conversation ticket-20'});
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-20');
  expect(screen.getByRole('listbox',{name:'Conversation list'})).toBe(list);
  expect(listPane.scrollTop).toBe(480);
  expect(screen.getByRole('option',{name:/Fixture conversation 20/})).toHaveTextContent('Draft');
});

it('renders spaced ticket surfaces with a left SLA anchor, stable marker slots and an expandable preview',async()=>{
  showInbox();
  const row=await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  const surface=row.querySelector('[data-part="ticket-row-surface"]');
  const slaAnchor=row.querySelector('[data-part="ticket-sla-anchor"]');
  const preview=row.querySelector('[data-part="ticket-preview"]');
  expect(surface).toBeInTheDocument();
  expect(surface?.firstElementChild).toBe(slaAnchor);
  expect(slaAnchor).toHaveTextContent('H');
  expect(within(row).getByText('#1')).toBeInTheDocument();
  expect(within(row).getByRole('heading',{name:'Fixture conversation 1'})).toBeInTheDocument();
  expect(row.querySelectorAll('[data-part="ticket-pill-slot"]')).toHaveLength(2);
  expect(row.querySelector('[data-part="ticket-pill-slots"]')).toHaveTextContent('Unassigned');
  expect(preview).toHaveTextContent('Last confirmed message 1');
  expect(preview).toHaveAttribute('data-expanded','false');
  fireEvent.mouseEnter(row);
  expect(preview).toHaveAttribute('data-expanded','true');
  fireEvent.mouseLeave(row);
  expect(preview).toHaveAttribute('data-expanded','false');
  act(()=>row.focus());
  expect(preview).toHaveAttribute('data-expanded','true');
  fireEvent.mouseLeave(row);
  expect(preview).toHaveAttribute('data-expanded','true');
  fireEvent.keyDown(row,{key:' '});
  expect(preview).toHaveAttribute('data-expanded','false');
  fireEvent.keyDown(row,{key:' '});
  expect(preview).toHaveAttribute('data-expanded','true');
  fireEvent.blur(row,{relatedTarget:document.body});
  expect(preview).toHaveAttribute('data-expanded','false');
});

it('keeps the preset toolbar compact while showing honest current-page metrics and filter controls',async()=>{
  showInbox();
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  const toolbar=document.querySelector('[data-part="inbox-primary-toolbar"]') as HTMLElement;
  const metricBand=document.querySelector('[data-part="inbox-page-metrics"]') as HTMLElement;
  expect(within(toolbar).getByRole('button',{name:'Inbox views'}).querySelector('svg')).toHaveAttribute('aria-hidden','true');
  expect(within(toolbar).getByRole('button',{name:'Quick statistics'})).toBeInTheDocument();
  expect(within(toolbar).getByRole('button',{name:'Filter tickets'})).toBeInTheDocument();
  expect(within(toolbar).queryByRole('button',{name:'New Ticket'})).not.toBeInTheDocument();
  expect(within(metricBand).getByRole('button',{name:'New Ticket'})).toBeInTheDocument();
  const metrics=metricBand.querySelector('dl') as HTMLElement;
  expect(metrics).toHaveAttribute('aria-label','Tickets on the current page');
  await waitFor(()=>expect(within(metrics).getByText('Open / pending').parentElement).toHaveTextContent('20'));
  expect(within(metrics).getByText('Resolved / closed').parentElement).toHaveTextContent('0');
  await waitFor(()=>expect(within(metrics).getByText('Overdue').parentElement).toHaveTextContent('0'));
  openFilters();
  const drawer=screen.getByRole('region',{name:'Ticket filters'});
  expect(within(drawer).getByRole('button',{name:'Ticket owner: All tickets'})).toBeInTheDocument();
  expect(within(drawer).getByRole('button',{name:'Sort: recently updated'})).toBeInTheDocument();
});

it('uses the authoritative actionable and snoozed queue views without losing the inbox surface',async()=>{
  showInbox();
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});

  await chooseView('Snoozed');
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('queue=snoozed'))).toBe(true));
  expect(screen.getByRole('button',{name:'Inbox views'})).toHaveTextContent('Snoozed');
  await waitFor(()=>expect(screen.getByRole('option',{name:/Fixture conversation 1(?:\s|$)/})).toHaveTextContent('Snoozed'));

  await chooseView('Needs Attention');
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('queue=actionable'))).toBe(true));
  expect(screen.getByRole('button',{name:'Inbox views'})).toHaveTextContent('Needs Attention');
  expect(screen.getByRole('listbox',{name:'Conversation list'})).toBeInTheDocument();
});

it('stages ticket filters until Apply, clears them, and closes on Escape',async()=>{
  showInbox();
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  openFilters();
  const input=screen.getByRole('textbox',{name:'Search ticket text'});
  expect(input).toHaveAttribute('placeholder','Search ticket text');
  fireEvent.change(input,{target:{value:'billing'}});
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('search=billing'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('search=billing'))).toBe(true));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Ticket filters applied.'));
  openFilters();
  expect(screen.getByRole('textbox',{name:'Search ticket text'})).toHaveValue('billing');
  fireEvent.click(screen.getByRole('button',{name:'Clear all'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Ticket filters cleared.'));
  await waitFor(()=>{
    const latest=vi.mocked(fetch).mock.calls.filter(([url])=>String(url).startsWith('/api/tickets?')).at(-1);
    expect(latest).toBeDefined();
    expect(new URL(String(latest![0]),'http://localhost').searchParams.has('search')).toBe(false);
  });
  openFilters();
  fireEvent.change(screen.getByRole('textbox',{name:'Search ticket text'}),{target:{value:'urgent'}});
  fireEvent.keyDown(screen.getByRole('textbox',{name:'Search ticket text'}),{key:'Escape'});
  expect(screen.queryByRole('region',{name:'Ticket filters'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Filter tickets'})).toHaveFocus();
});

it('returns focus to the statistics trigger when its panel closes with Escape',async()=>{
  showInbox();
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  const trigger=screen.getByRole('button',{name:'Quick statistics'});
  fireEvent.click(trigger);
  const region=screen.getByRole('region',{name:'Quick statistics'});
  expect(region).toBeInTheDocument();
  act(()=>trigger.focus());
  fireEvent.keyDown(trigger,{key:'Escape'});
  expect(screen.queryByRole('region',{name:'Quick statistics'})).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('applies owner, date and customer choices together after the queue route changes',async()=>{
  showInbox('/inbox/all');
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  openFilters();
  await userEvent.click(screen.getByRole('button',{name:'Ticket owner: All tickets'}));
  await userEvent.click(await screen.findByRole('menuitem',{name:'My tickets'}));
  await userEvent.click(screen.getByRole('button',{name:'Created: anytime'}));
  await userEvent.click(await screen.findByRole('menuitem',{name:'day'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Filter by exact customer email'}),{target:{value:'customer-1@example.invalid'}});
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all');
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('queue=mine'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/inbox/mine'));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>{
    if(!String(url).startsWith('/api/tickets?'))return false;
    const query=new URL(String(url),'http://localhost').searchParams;
    return query.get('queue')==='mine'&&query.get('customer_email')==='customer-1@example.invalid'&&Boolean(query.get('created_after'));
  })).toBe(true));
  openFilters();
  expect(screen.getByRole('button',{name:'Ticket owner: My tickets'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Created: day'})).toBeInTheDocument();
  expect(screen.getByRole('textbox',{name:'Filter by exact customer email'})).toHaveValue('customer-1@example.invalid');
});

it('keeps applied date, customer and text filters when changing the three reference view rankings',async()=>{
  showInbox('/inbox/all');
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  expect(screen.queryByText('Current view')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Filter'})).not.toBeInTheDocument();
  openFilters();
  await userEvent.click(screen.getByRole('button',{name:'Created: anytime'}));
  await userEvent.click(await screen.findByRole('menuitem',{name:'day'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Filter by exact customer email'}),{target:{value:'customer-1@example.invalid'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Search ticket text'}),{target:{value:'billing'}});
  fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
  const matchingQuery=(queue:string|null,sort:string)=>vi.mocked(fetch).mock.calls.some(([url])=>{
    if(!String(url).startsWith('/api/tickets?'))return false;
    const params=new URL(String(url),'http://localhost').searchParams;
    return params.get('queue')===queue&&params.get('sort')===sort&&params.get('customer_email')==='customer-1@example.invalid'
      &&params.get('search')==='billing'&&Boolean(params.get('created_after'));
  });
  await waitFor(()=>expect(matchingQuery(null,'updated_desc')).toBe(true));

  await chooseView('Highest Impact');
  await waitFor(()=>expect(matchingQuery(null,'priority_desc')).toBe(true));
  await chooseView('Contract SLAs');
  await waitFor(()=>expect(matchingQuery(null,'sla_priority')).toBe(true));
  await chooseView('Needs Attention');
  await waitFor(()=>expect(matchingQuery('actionable','updated_desc')).toBe(true));
  openFilters();
  expect(screen.getByRole('button',{name:'Created: day'})).toBeInTheDocument();
  expect(screen.getByRole('textbox',{name:'Filter by exact customer email'})).toHaveValue('customer-1@example.invalid');
  expect(screen.getByRole('textbox',{name:'Search ticket text'})).toHaveValue('billing');
});

it('uses clamped calendar dates for the month and quarter filter choices',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(Date.UTC(2026,2,31,10,15));
  showInbox('/inbox/all');
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  openFilters();
  await userEvent.click(screen.getByRole('button',{name:'Created: anytime'}));
  await userEvent.click(await screen.findByRole('menuitem',{name:'month'}));
  fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
  const requestedDate=(expected:string)=>vi.mocked(fetch).mock.calls.some(([url])=>String(url).startsWith('/api/tickets?')
    &&new URL(String(url),'http://localhost').searchParams.get('created_after')===expected);
  await waitFor(()=>expect(requestedDate('2026-02-28T10:15:00.000Z')).toBe(true));

  openFilters();
  await userEvent.click(screen.getByRole('button',{name:'Created: month'}));
  await userEvent.click(await screen.findByRole('menuitem',{name:'quarter'}));
  fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
  await waitFor(()=>expect(requestedDate('2025-12-31T10:15:00.000Z')).toBe(true));
});

it('saves only filter combinations the server can reproduce as a quick view',async()=>{
  const fallback=fetch;
  let saved: {id:string;name:string;conditions:unknown[]} | null=null;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url==='/api/settings/filters'&&options.method==='POST'){
      const body=JSON.parse(String(options.body));
      saved={id:'customer-quick-view',name:body.name,conditions:body.conditions};
      return json(saved);
    }
    if(url==='/api/settings/filters'&&saved)return json([{...saved,is_system:false,created_at:'2026-09-11T00:00:00Z',updated_at:'2026-09-11T00:00:00Z'}]);
    return fallback(url,options);
  }));
  showInbox('/inbox/all');
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  openFilters();
  await userEvent.click(screen.getByRole('button',{name:'Created: anytime'}));
  await userEvent.click(await screen.findByRole('menuitem',{name:'day'}));
  fireEvent.click(screen.getByRole('button',{name:'Add to quick view'}));
  expect(screen.getByRole('button',{name:'Save quick view'})).toBeDisabled();
  expect(screen.getByText(/Quick views can currently save All tickets/)).toBeInTheDocument();
  expect(saved).toBeNull();

  fireEvent.click(screen.getByRole('button',{name:'Clear all'}));
  openFilters();
  fireEvent.change(screen.getByRole('textbox',{name:'Filter by exact customer email'}),{target:{value:'customer-1@example.invalid'}});
  fireEvent.click(screen.getByRole('button',{name:'Add to quick view'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Quick view name'}),{target:{value:'Customer follow-up'}});
  fireEvent.click(screen.getByRole('button',{name:'Save quick view'}));
  await waitFor(()=>expect(saved).toEqual({id:'customer-quick-view',name:'Customer follow-up',conditions:[{field:'customer_email',operator:'equals',value:'customer-1@example.invalid'}]}));
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/inbox/customer-quick-view'));
});

it('keeps quick-view input available with a Park recovery alert after a failed save',async()=>{
  const fallback=fetch;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url==='/api/settings/filters'&&options.method==='POST')return json({error:'Temporary failure'},503);
    return fallback(url,options);
  }));
  showInbox('/inbox/all');
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  openFilters();
  fireEvent.click(screen.getByRole('button',{name:'Add to quick view'}));
  const name=screen.getByRole('textbox',{name:'Quick view name'});
  fireEvent.change(name,{target:{value:'Follow up'}});
  fireEvent.click(screen.getByRole('button',{name:'Save quick view'}));
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveClass('alert__root');
  expect(alert).toHaveTextContent('Could not save the quick view. Your filter choices are still here; try again.');
  expect(name).toHaveValue('Follow up');
  expect(screen.getByRole('button',{name:'Save quick view'})).toBeEnabled();
});

it('switches to an accessible factual table with row navigation and a mobile list fallback',async()=>{
  showInbox();
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  await choosePresentation('Table view');
  expect(screen.getByRole('table',{name:'Tickets in the current view'})).toBeInTheDocument();
  expect(screen.getByRole('columnheader',{name:'Reference'})).toBeInTheDocument();
  expect(screen.getByRole('columnheader',{name:'Customer'})).toBeInTheDocument();
  const subjectLink=screen.getByRole('link',{name:'Fixture conversation 1'});
  expect(subjectLink).toHaveAttribute('href','/inbox/all/ticket-1');
  expect(subjectLink).toHaveClass('link');
  subjectLink.focus();expect(subjectLink).toHaveFocus();
  expect(screen.getByText('Table view uses the compact conversation list on small screens.')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Actions for/})).not.toBeInTheDocument();
});

it('does not persist a view switch before an unsaved conversation draft permits navigation',async()=>{
  savedSelection='ticket-1';
  detailNavigation.pending=true;
  detailNavigation.flush.mockResolvedValue(false);
  showInbox('/inbox/all/ticket-1');
  await screen.findByRole('heading',{name:'Conversation ticket-1'});

  await chooseView('Priority follow-up');
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

  await chooseSort('oldest first');
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
    if(url==='/api/tickets/queue-counts')return json({scope:'standard_queues',counts:{all:20,actionable:20,mine:0,unassigned:20,mentions:0,drafts:1,snoozed:0}});
    if(url.startsWith('/api/tickets?'))return json({error:'Forbidden'},403);
    return json({});
  }));
  showInbox();
  const failedLoad=await screen.findByRole('alert');
  expect(failedLoad).toHaveClass('alert__root');
  expect(failedLoad).toHaveTextContent('Could not load conversations.');
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
  openFilters();
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Search ticket text'})).toHaveValue('follow up'));
  const pane=screen.getByRole('region',{name:'Conversations'});
  pane.scrollTop=480;
  const queryInput=screen.getByRole('textbox',{name:'Search ticket text'});
  const sortInput=screen.getByRole('button',{name:/^Sort:/});
  const location=screen.getByTestId('location');

  for(const [index,ticket] of tickets.entries()){
    fireEvent.click(options[index]);
    await screen.findByRole('heading',{name:`Conversation ${ticket.id}`});
    expect(location).toHaveTextContent(`/inbox/priority-follow-up/${ticket.id}`);
    expect(list).toBeInTheDocument();
    expect(pane).toBeInTheDocument();
    expect(pane.scrollTop).toBe(480);
    expect(queryInput).toHaveValue('follow up');
    expect(sortInput).toHaveTextContent('oldest first');
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
  fireEvent.click(screen.getByRole('button',{name:'Retry saving'}));
  await screen.findByRole('heading',{name:'Choose a conversation'});
  expect(detailNavigation.flush).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('location').textContent).toBe('/inbox/priority-follow-up');
  expect(screen.getByRole('listbox',{name:'Conversation list'})).toBe(list);
  expect(pane.scrollTop).toBe(640);
  openFilters();
  expect(screen.getByRole('textbox',{name:'Search ticket text'})).toHaveValue('follow up');
  expect(screen.getByRole('button',{name:/^Sort:/})).toHaveTextContent('oldest first');
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
  await chooseView('Drafts');
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Refreshing…'));
  expect(screen.getByRole('option',{name:/Fixture conversation 1(?:\s|$)/})).toBeInTheDocument();
  expect(screen.queryByLabelText('Inclusion reason: drafts')).not.toBeInTheDocument();
  release();
  await waitFor(()=>expect(within(screen.getByRole('listbox',{name:'Conversation list'})).getAllByRole('option')).toHaveLength(1));
  expect(screen.getByRole('button',{name:'Inbox views'})).toHaveTextContent('Drafts');
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
  await chooseView('Snoozed');
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Refreshing…'));
  expect(screen.queryByText('No snoozed conversations')).not.toBeInTheDocument();
  await choosePresentation('Table view');
  expect(screen.queryByText('No snoozed conversations')).not.toBeInTheDocument();
  await choosePresentation('List view');
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
  expect(screen.getByRole('button',{name:'Inbox views'})).toHaveTextContent('Mine');
  expect(screen.queryByText(/Current view:/)).not.toBeInTheDocument();
  await chooseView('Unassigned');
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Refreshing…'));
  expect(screen.getByRole('option',{name:/Fixture conversation 1(?:\s|$)/})).toBeInTheDocument();
  expect(screen.queryByLabelText('Inclusion reason: unassigned')).not.toBeInTheDocument();
  expect(screen.queryByText('No unassigned conversations')).not.toBeInTheDocument();
  release();
  await screen.findByText('No unassigned conversations');
  expect(screen.getByRole('button',{name:'Inbox views'})).toHaveTextContent('Unassigned');
  expect(screen.getByText('Open and pending conversations without an assignee and ready for work.')).toBeInTheDocument();
  await choosePresentation('Table view');
  expect(within(screen.getByRole('table')).getByText('No unassigned conversations')).toBeInTheDocument();
});

it('shows server standard totals separately from filtered results and retries unavailable counts without inventing zero',async()=>{
  const fallback=fetch;let available=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url==='/api/tickets/queue-counts')return available?json({scope:'standard_queues',counts:{all:42,actionable:12,mine:4,unassigned:8,mentions:2,drafts:3,snoozed:5}}):json({error:'Unavailable'},503);
    if(url.startsWith('/api/tickets?')&&new URL(url,'http://localhost').searchParams.get('queue')==='mentions')return json({data:[{...tickets[0],inclusion_reason:'mentions'}],meta:{page:1,limit:20,total:1,total_pages:1}});
    return fallback(url,options);
  }));
  showInbox('/inbox/actionable');
  fireEvent.click(screen.getByRole('button',{name:'Quick statistics'}));
  await screen.findByRole('button',{name:'Retry queue totals'});
  available=true;fireEvent.click(screen.getByRole('button',{name:'Retry queue totals'}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/tickets/queue-counts').length).toBeGreaterThan(1));
  expect(screen.getByText('Statistics describe tickets on the current page and follow the applied filters.')).toBeInTheDocument();
  await chooseView('Mentions');
  await screen.findByLabelText('Inclusion reason: mentions');
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/mentions');
  expect(within(screen.getByRole('listbox',{name:'Conversation list'})).getAllByRole('option')).toHaveLength(1);
  expect(screen.getByRole('button',{name:'Inbox views'})).toHaveTextContent('Mentions');
});

it('starts a different queue on page one after leaving page three without changing the query or sort',async()=>{
  const fallback=fetch;const requests:URLSearchParams[]=[];let deferOld=false;let releaseOld!:()=>void;
  const oldResponse=new Promise<void>(done=>{releaseOld=done;});
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url==='/api/workspace/state'&&options.method!=='PUT')return json({...workspace(null),listAnchor:'page:3',listQuery:'follow up',sort:'created_asc'});
    if(url.startsWith('/api/tickets?')){
      const params=new URL(url,'http://localhost').searchParams;requests.push(params);const page=Number(params.get('page'));
      const mine=params.get('queue')==='mine';
      if(!mine&&deferOld){await oldResponse;return json({data:[],meta:{page,limit:20,total:1,total_pages:1}});}
      return json({data:mine?(page===1?[tickets[0]]:[]):tickets,meta:{page,limit:20,total:mine?1:60,total_pages:mine?1:3}});
    }
    return fallback(url,options);
  }));
  showInbox('/inbox/all');
  await screen.findByText('Page 3 of 3');
  deferOld=true;const oldRefresh=client.invalidateQueries({queryKey:['tickets']});
  await chooseView('Mine');
  await waitFor(()=>expect(requests.some(params=>params.get('queue')==='mine')).toBe(true));
  expect(requests.filter(params=>params.get('queue')==='mine').every(params=>params.get('page')==='1')).toBe(true);
  await waitFor(()=>expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1));
  expect(screen.queryByText('No actionable conversations assigned to you')).not.toBeInTheDocument();
  openFilters();
  expect(screen.getByRole('textbox',{name:'Search ticket text'})).toHaveValue('follow up');
  expect(screen.getByRole('button',{name:/^Sort:/})).toHaveTextContent('oldest first');
  releaseOld();await oldRefresh;
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/mine');
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
  expect(screen.queryByRole('status',{name:'Inbox status'})?.textContent ?? '').not.toContain('Showing the first page');
});

it.each(['List view','Table view'] as const)('recovers a shrunken last page without a false queue-clear claim in %s',async presentation=>{
  const fallback=fetch;let shrunk=false;let recoveryStarted=false;let release!:()=>void;
  const pending=new Promise<void>(done=>{release=done;});
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>{
    if(url==='/api/workspace/state'&&options.method!=='PUT')return json({...workspace(null),listAnchor:'page:3'});
    if(url.startsWith('/api/tickets?')){
      const page=Number(new URL(url,'http://localhost').searchParams.get('page'));
      if(shrunk&&page===1){recoveryStarted=true;await pending;}
      return json({data:shrunk?(page===1?[tickets[0]]:[]):tickets,meta:{page,limit:20,total:shrunk?1:60,total_pages:shrunk?1:3}});
    }
    return fallback(url,options);
  }));
  showInbox('/inbox/mine');
  await screen.findByText('Page 3 of 3');
  await choosePresentation(presentation);
  shrunk=true;void client.invalidateQueries({queryKey:['tickets']});
  await waitFor(()=>expect(recoveryStarted).toBe(true));
  expect(screen.queryByText('No actionable conversations assigned to you')).not.toBeInTheDocument();
  expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Loading the first page');
  release();
  await waitFor(()=>expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Showing the first page'));
  expect(screen.queryByText('No actionable conversations assigned to you')).not.toBeInTheDocument();
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
  if(presentation==='Table view')expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
});

it('uses whole-view SLA ordering and same-snapshot projections, then restarts an expired queue without losing the conversation',async()=>{
  const base=vi.mocked(fetch).getMockImplementation()!;
  const slaRequests:string[]=[];
  vi.mocked(fetch).mockImplementation(async(url,options)=>{
    if(String(url).startsWith('/api/tickets?')&&String(url).includes('sort=sla_priority')){
      slaRequests.push(String(url));
      if(String(url).includes('cursor='))return json({code:'sla_sort_restart',error:'Queue changed or expired.'},409);
      return json({data:[...tickets].reverse(),meta:{page:1,limit:20,total:21,total_pages:2},
        sla:Object.fromEntries(tickets.map(ticket=>[ticket.id,unavailableSla])),asOf:new Date().toISOString(),next:'synthetic-next-cursor'});
    }
    return base(url,options);
  });
  showInbox('/inbox/all/ticket-1');
  await screen.findByRole('option',{name:/Fixture conversation 20/});
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>url==='/api/ticket-sla/projections')).toBe(true));
  const before=vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/ticket-sla/projections').length;
  await chooseSort('contract SLA');
  await waitFor(()=>expect(slaRequests).toHaveLength(1));
  const list=screen.getByRole('listbox',{name:'Conversation list'});
  await waitFor(()=>expect(within(list).getAllByRole('option')[0]).toHaveTextContent('Fixture conversation 20'));
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/ticket-sla/projections')).toHaveLength(before);
  fireEvent.click(screen.getByRole('button',{name:'Next conversation page'}));
  await screen.findByRole('button',{name:'Restart SLA ordering'});
  expect(screen.getByRole('heading',{name:'Conversation ticket-1'})).toBeInTheDocument();
  expect(within(list).queryAllByRole('option')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Restart SLA ordering'}));
  await within(list).findByRole('option',{name:/Fixture conversation 20/});
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-1');
  expect(slaRequests).toHaveLength(3);
});


it('advances only from a freshly read first page and keeps the navigation draft guard', async()=>{
  detailNavigation.pending=true;
  detailNavigation.flush.mockResolvedValue(false);
  showInbox('/inbox/all/ticket-01');
  await screen.findByRole('heading',{name:'Conversation ticket-01'});
  await waitFor(()=>expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
  const before=vi.mocked(fetch).mock.calls.filter(([url])=>String(url).startsWith('/api/tickets?')).length;
  fireEvent.click(screen.getByRole('button',{name:'Synthetic confirmed resolve'}));
  await waitFor(()=>expect(detailNavigation.flush).toHaveBeenCalled());
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-01');
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).startsWith('/api/tickets?')).length).toBeGreaterThan(before);
  expect(screen.getByRole('alert')).toHaveTextContent('not saved');
});


it.each(['filter','preference','pagination'] as const)('discards delayed advance after explicit %s change',async(change)=>{
  const original=vi.mocked(fetch).getMockImplementation()!;
  let delay=false;let finish!: (response:Response)=>void;
  vi.mocked(fetch).mockImplementation((url:any,options:any)=>{
    if(String(url).startsWith('/api/tickets?')){
      if(delay){delay=false;return new Promise<Response>(resolve=>{finish=resolve;});}
      return Promise.resolve(json({data:tickets,meta:{page:1,limit:20,total:40,total_pages:2}}));
    }
    return original(url,options);
  });
  showInbox('/inbox/all/ticket-01');
  await screen.findByRole('button',{name:'Next conversation page'});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Next conversation page'})).toHaveAttribute('aria-disabled','false'));
  delay=true;
  fireEvent.click(screen.getByRole('button',{name:'Synthetic confirmed resolve'}));
  await waitFor(()=>expect(finish).toBeDefined());
  if(change==='filter')fireEvent.click(screen.getByRole('button',{name:'Synthetic change filter'}));
  else if(change==='preference')act(()=>{presentation.enabled=false;presentation.listeners.forEach(listener=>listener());});
  else fireEvent.click(screen.getByRole('button',{name:'Next conversation page'}));
  await act(async()=>finish(json({data:tickets.slice(1),meta:{page:1,limit:20,total:19,total_pages:1}})));
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all/ticket-01');
});


it('global ticket search never enters the legacy redirect or rewrites the actual current-view filter',async()=>{
 const mounted=showInbox('/inbox/all',true);
 await screen.findAllByRole('option');
 openFilters();
 await userEvent.type(screen.getByRole('textbox',{name:'Search ticket text'}),'local-filter');
 fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url,options])=>url==='/api/workspace/state'&&options?.method==='PUT'&&JSON.parse(String(options.body)).listQuery==='local-filter')).toBe(true));
 openFilters();
 const filter=screen.getByRole('textbox',{name:'Search ticket text'});
 vi.mocked(fetch).mockClear();
 const global=screen.getByRole('textbox',{name:'Search all tickets (global shell)'});
 await userEvent.type(global,'Fixture{Enter}');
 expect(await screen.findByText('20 matching authorised tickets. Showing 20.')).toBeVisible();
 expect(mounted.router.state.location.pathname).toBe('/inbox/all');expect(filter).toHaveValue('local-filter');
 await userEvent.click(screen.getByRole('button',{name:'Clear global ticket search'}));
 expect(filter).toHaveValue('local-filter');expect(mounted.router.state.location.pathname).toBe('/inbox/all');
 expect(vi.mocked(fetch).mock.calls.some(([url,options])=>url==='/api/workspace/state'&&options?.method==='PUT')).toBe(false);
});

it('opens the active inbox New Ticket dialog with Park anatomy and restores trigger focus on cancellation',async()=>{
  // Zag checks geometry before choosing the initial focus target; JSDOM has none.
  vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){
    return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,30)]:[]) as unknown as DOMRectList;
  });
  showInbox();
  const trigger=screen.getByRole('button',{name:'New Ticket'});
  trigger.focus();
  fireEvent.click(trigger);
  const dialog=await screen.findByRole('dialog',{name:'Create New Ticket'});
  expect(dialog).toHaveAttribute('data-scope','dialog');
  expect(dialog).toHaveAttribute('data-part','content');
  await waitFor(()=>expect(within(dialog).getByRole('textbox',{name:'Subject'})).toHaveFocus());
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Create New Ticket'})).not.toBeInTheDocument());
  await waitFor(()=>expect(trigger).toHaveFocus());
});

it('keeps a failed New Ticket draft and retries the same validated payload in the active inbox',async()=>{
  const original=vi.mocked(fetch).getMockImplementation()!;
  let posts=0;
  let created=false;
  const createdTicket={...tickets[0],id:'created-ticket',subject:'Operator-created follow-up'};
  vi.mocked(fetch).mockImplementation((url:any,options:any)=>{
    if(String(url)==='/api/tickets'&&options?.method==='POST'){
      posts++;
      expect(JSON.parse(String(options.body))).toEqual({
        subject:'Operator-created follow-up',customer_email:'customer@example.invalid',body:'Synthetic operator message',
        priority:'normal',status:'open',
      });
      return Promise.resolve(posts===1?json({error:'Creation is temporarily unavailable'},503):json(createdTicket,201));
    }
    if(created&&String(url).startsWith('/api/tickets?'))return Promise.resolve(json({data:[createdTicket,...tickets],meta:{page:1,limit:20,total:21,total_pages:2}}));
    return original(url,options);
  });
  showInbox();
  fireEvent.click(screen.getByRole('button',{name:'New Ticket'}));
  const dialog=await screen.findByRole('dialog',{name:'Create New Ticket'});
  const subject=within(dialog).getByRole('textbox',{name:'Subject'});
  for(const label of ['Subject','Customer Email','Initial Message']){
    const input=within(dialog).getByRole('textbox',{name:label});
    const field=input.closest('[data-scope="field"][data-part="root"]');
    expect(field).toHaveClass('field__root');
    expect(field?.querySelector('[data-scope="field"][data-part="label"]')).toHaveTextContent(label);
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveClass('field__helperText');
  }
  fireEvent.change(subject,{target:{value:'Operator-created follow-up'}});
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Customer Email'}),{target:{value:'customer@example.invalid'}});
  const message=within(dialog).getByRole('textbox',{name:'Initial Message'});
  fireEvent.change(message,{target:{value:'Synthetic operator message'}});
  const submit=within(dialog).getByRole('button',{name:'Create Ticket'});
  fireEvent.click(submit);
  const alert=await within(dialog).findByRole('alert');
  expect(alert).toHaveAttribute('id','create-ticket-error');
  expect(alert).toHaveClass('alert__root');
  expect(alert.querySelector('.alert__description')).toHaveTextContent('Creation is temporarily unavailable');
  expect(subject).toHaveAttribute('aria-describedby','create-ticket-subject-help create-ticket-error');
  expect(message).toHaveAttribute('aria-describedby','create-ticket-body-help create-ticket-error');
  expect(subject).toHaveValue('Operator-created follow-up');
  expect(message).toHaveValue('Synthetic operator message');
  created=true;
  fireEvent.click(submit);
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Create New Ticket'})).not.toBeInTheDocument());
  expect(posts).toBe(2);
  expect(await screen.findByRole('option',{name:/Operator-created follow-up/})).toBeInTheDocument();
  expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Ticket created.');
});

it('holds the New Ticket draft, focus and dialog while creation is pending',async()=>{
  const original=vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response:Response)=>void;
  let posts=0;
  vi.mocked(fetch).mockImplementation((url:any,options:any)=>{
    if(String(url)==='/api/tickets'&&options?.method==='POST'){
      posts++;
      return new Promise<Response>(resolve=>{finish=resolve;});
    }
    return original(url,options);
  });
  showInbox();
  fireEvent.click(screen.getByRole('button',{name:'New Ticket'}));
  const dialog=await screen.findByRole('dialog',{name:'Create New Ticket'});
  const subject=within(dialog).getByRole('textbox',{name:'Subject'});
  fireEvent.change(subject,{target:{value:'Submitted subject'}});
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Customer Email'}),{target:{value:'customer@example.invalid'}});
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Initial Message'}),{target:{value:'Submitted message'}});
  const submit=within(dialog).getByRole('button',{name:'Create Ticket'});
  submit.focus();fireEvent.click(submit);
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Creating…'})).toHaveAttribute('aria-disabled','true'));
  expect(submit).toHaveFocus();
  fireEvent.change(subject,{target:{value:'Changed while pending'}});
  expect(subject).toHaveValue('Submitted subject');
  expect(within(dialog).getByRole('combobox',{name:'Priority'})).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
  fireEvent.keyDown(submit,{key:'Escape'});
  expect(screen.getByRole('dialog',{name:'Create New Ticket'})).toBeInTheDocument();
  fireEvent.click(submit);
  expect(posts).toBe(1);
  await act(async()=>finish(json({error:'Intake stopped'},503)));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Intake stopped');
  expect(within(dialog).getByRole('button',{name:'Create Ticket'})).toHaveFocus();
});

it('distinguishes a failed inbox read from an empty view and retries the authoritative list',async()=>{
  const original=vi.mocked(fetch).getMockImplementation()!;
  let reads=0;
  vi.mocked(fetch).mockImplementation((url:any,options:any)=>{
    if(String(url).startsWith('/api/tickets?'))return Promise.resolve(++reads===1
      ?json({error:'Temporarily unavailable'},503)
      :json({data:[tickets[0]],meta:{page:1,limit:20,total:1,total_pages:1}}));
    return original(url,options);
  });
  showInbox();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load conversations.');
  expect(screen.queryByText('No conversations in this view')).not.toBeInTheDocument();
  const metrics=document.querySelector('[data-part="inbox-page-metrics"]') as HTMLElement;
  for(const label of ['Open / pending','Overdue','Resolved / closed'])expect(within(metrics).getByText(label).parentElement).toHaveTextContent('—');
  fireEvent.click(screen.getByRole('button',{name:'Quick statistics'}));
  const drawer=screen.getByRole('region',{name:'Quick statistics'});
  for(const label of ['Open / pending','Overdue','Resolved / closed'])expect(within(drawer).getByText(label).parentElement).toHaveTextContent('—');
  const retry=screen.getByRole('button',{name:'Retry conversations'});
  fireEvent.click(retry);
  expect(await screen.findByRole('option',{name:/Fixture conversation 1/})).toBeInTheDocument();
  await waitFor(()=>expect(screen.queryByText('Could not load conversations.')).not.toBeInTheDocument());
  expect(reads).toBe(2);
});

it('retains confirmed inbox rows and a retry action after a background refresh fails',async()=>{
  const original=vi.mocked(fetch).getMockImplementation()!;
  let fail=false;
  vi.mocked(fetch).mockImplementation((url:any,options:any)=>{
    if(String(url).startsWith('/api/tickets?')&&fail)return Promise.resolve(json({error:'Temporary refresh failure'},503));
    return original(url,options);
  });
  showInbox();
  const list=screen.getByRole('listbox',{name:'Conversation list'});
  const first=await within(list).findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  fail=true;
  await act(async()=>{await client.invalidateQueries({queryKey:['tickets']});});
  const failedRefresh=await screen.findByRole('alert');
  expect(failedRefresh).toHaveClass('alert__root');
  expect(failedRefresh).toHaveTextContent('Could not refresh conversations. The last confirmed list remains visible.');
  expect(first).toBeInTheDocument();
  const metricBand=document.querySelector('[data-part="inbox-page-metrics"]') as HTMLElement;
  expect(metricBand.querySelector('dl')).toHaveAttribute('aria-label','Tickets on the last confirmed page');
  expect(within(metricBand).getByText('Open / pending').parentElement).toHaveTextContent('20');
  expect(within(metricBand).getByText('Metrics show the last confirmed page while refresh is unavailable.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Retry conversations'})).toBeEnabled();
  expect(screen.queryByText('No conversations in this view')).not.toBeInTheDocument();
});

it('does not invent an overdue zero when the SLA projection fails',async()=>{
  const fallback=fetch;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit={})=>url==='/api/ticket-sla/projections'
    ?json({error:'Projection unavailable'},503):fallback(url,options)));
  showInbox();
  await screen.findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>url==='/api/ticket-sla/projections')).toBe(true));
  await waitFor(()=>expect(client.getQueryCache().getAll().find(query=>query.queryKey[0]==='ticket-sla'&&Array.isArray(query.queryKey[1])&&query.queryKey[1].includes('ticket-1'))?.state.status).toBe('error'));
  const metricBand=document.querySelector('[data-part="inbox-page-metrics"]') as HTMLElement;
  expect(within(metricBand).getByText('Open / pending').parentElement).toHaveTextContent('20');
  expect(within(metricBand).getByText('Overdue').parentElement).toHaveTextContent('—');
  fireEvent.click(screen.getByRole('button',{name:'Quick statistics'}));
  const drawer=screen.getByRole('region',{name:'Quick statistics'});
  expect(within(drawer).getByText('Overdue').parentElement).toHaveTextContent('—');
});

it('keeps prior inbox results and pagination focus while the next page loads',async()=>{
  const original=vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response:Response)=>void;
  const queries:string[]=[];
  vi.mocked(fetch).mockImplementation((url:any,options:any)=>{
    if(String(url).startsWith('/api/tickets?')){
      const page=new URL(String(url),'http://localhost').searchParams.get('page')??'1';
      queries.push(page);
      if(page==='2')return new Promise<Response>(resolve=>{finish=resolve;});
      return Promise.resolve(json({data:[tickets[0]],meta:{page:1,limit:1,total:2,total_pages:2}}));
    }
    return original(url,options);
  });
  showInbox();
  const list=screen.getByRole('listbox',{name:'Conversation list'});
  const first=await within(list).findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  const next=screen.getByRole('button',{name:'Next conversation page'});
  next.focus();fireEvent.click(next);
  await waitFor(()=>expect(finish).toBeDefined());
  expect(next).toHaveFocus();
  expect(next).toHaveAttribute('aria-disabled','true');
  expect(first).toBeInTheDocument();
  expect(screen.getByRole('status',{name:'Inbox status'})).toHaveTextContent('Refreshing');
  fireEvent.click(next);
  expect(queries.filter(page=>page==='2')).toHaveLength(1);
  await act(async()=>finish(json({data:[tickets[1]],meta:{page:2,limit:1,total:2,total_pages:2}})));
  expect(await within(list).findByRole('option',{name:/Fixture conversation 2/})).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Support Inbox'})).toHaveFocus();
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
});

it('moves focus to explicit recovery when the next inbox page fails without hiding prior results',async()=>{
  const original=vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response:Response)=>void;
  vi.mocked(fetch).mockImplementation((url:any,options:any)=>{
    if(String(url).startsWith('/api/tickets?')){
      const page=new URL(String(url),'http://localhost').searchParams.get('page')??'1';
      if(page==='2')return new Promise<Response>(resolve=>{finish=resolve;});
      return Promise.resolve(json({data:[tickets[0]],meta:{page:1,limit:1,total:2,total_pages:2}}));
    }
    return original(url,options);
  });
  showInbox();
  const list=screen.getByRole('listbox',{name:'Conversation list'});
  const first=await within(list).findByRole('option',{name:/Fixture conversation 1(?:\s|$)/});
  const next=screen.getByRole('button',{name:'Next conversation page'});
  next.focus();fireEvent.click(next);
  await waitFor(()=>expect(finish).toBeDefined());
  await act(async()=>finish(json({error:'Page unavailable'},503)));
  const retry=await screen.findByRole('button',{name:'Retry conversations'});
  expect(screen.getByRole('alert')).toHaveTextContent('last confirmed list remains visible');
  expect(first).toBeInTheDocument();
  expect(retry).toHaveFocus();
});
