import { TocynButton,TocynInput,TocynSelect } from '@luminatick/ui/primitives';
import { AlertCircle,ChevronLeft,ChevronRight,Clock,Filter,Inbox,Search } from 'lucide-react';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import { Link,useNavigate,useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { ConversationSlaStatus } from '../components/ConversationSlaStatus';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
import { useFilters } from '../hooks/useFilters';
import { OperatorWorkspaceProvider,useOperatorDraftIndicators,useOperatorWorkspaceState,type WorkspacePreference } from '../hooks/useOperatorWorkspaceState';
import { useSettings } from '../hooks/useSettings';
import { useTicketSlaBatch } from '../hooks/useTicketSla';
import { useTickets } from '../hooks/useTickets';
import { ticketReference } from '../utils/ticket-reference';
import { utcTimestamp } from '../utils/utcTimestamp';
import { TicketDetailPage } from './TicketDetailPage';

const statusStyle={open:'bg-emerald-50 text-emerald-800 border-emerald-200',pending:'bg-amber-50 text-amber-900 border-amber-200',
  resolved:'bg-slate-100 text-slate-700 border-slate-200',closed:'bg-slate-100 text-slate-700 border-slate-200'} as const;
const priorityStyle={low:'text-slate-500',normal:'text-blue-600',high:'text-orange-700',urgent:'text-red-700'} as const;
function pageFromAnchor(anchor:string){const match=/^page:([1-9]\d*)$/.exec(anchor);const page=match?Number(match[1]):1;return Number.isSafeInteger(page)?page:1;}
function pageAnchor(page:number){return `page:${Math.max(1,Math.floor(page))}`;}

export function InboxWorkspacePage(){
  return <OperatorWorkspaceProvider><InboxWorkspace /></OperatorWorkspaceProvider>;
}

function InboxWorkspace(){
  const {'*':inboxPath}=useParams<'*'>();
  const [viewId,conversationId]=inboxPath?.split('/')??[];
  const navigate=useNavigate();
  const workspace=useOperatorWorkspaceState();
  const {data:filters,isLoading:isLoadingFilters}=useFilters();
  const lastRouteView=useRef<string|null>(null);
  const routeFilter=useMemo(()=>viewId&&viewId!=='all'?filters?.find(filter=>filter.id===viewId):undefined,[filters,viewId]);
  const routeReady=!isLoadingFilters&&(viewId==='all'||Boolean(routeFilter));

  useEffect(()=>{
    if(workspace.status==='loading'||isLoadingFilters)return;
    const routeKey=viewId??'';
    if(lastRouteView.current===routeKey)return;
    lastRouteView.current=routeKey;
    if(!viewId){
      const savedView=workspace.view==='custom'&&workspace.filters.filterId&&filters?.some(filter=>filter.id===workspace.filters.filterId)
        ? workspace.filters.filterId:'all';
      const selected=workspace.selectedTicketId;
      navigate(`/inbox/${savedView}${selected?`/${selected}`:''}`,{replace:true});
      return;
    }
    const clearSelection=conversationId?{}:{selectedTicketId:null as null};
    if(viewId==='all'&&(workspace.view!=='all'||workspace.filters.filterId))workspace.update({view:'all',filters:{...workspace.filters,filterId:null},...clearSelection});
    else if(routeFilter&&(workspace.view!=='custom'||workspace.filters.filterId!==routeFilter.id))workspace.update({view:'custom',filters:{...workspace.filters,filterId:routeFilter.id},...clearSelection});
  },[conversationId,filters,isLoadingFilters,navigate,routeFilter,viewId,workspace]);

  if(viewId&&viewId!=='all'&&!isLoadingFilters&&!routeFilter)return <section className="p-6" aria-labelledby="inbox-view-unavailable">
    <h1 id="inbox-view-unavailable" tabIndex={-1} className="text-xl font-bold text-slate-900">Inbox view unavailable</h1>
    <p className="mt-2 text-slate-600">This saved view is unavailable for the current account.</p>
    <Link to="/inbox/all" replace className="mt-4 inline-flex rounded border border-slate-300 px-4 py-2 font-semibold">Open All tickets</Link>
  </section>;

  return <div className="h-full min-h-0 bg-slate-100 lg:grid lg:grid-cols-3">
    {!conversationId&&<DraftNavigationGuard pending={workspace.hasUnsavedChanges} flush={workspace.flushBeforeNavigation}
      failureMessage="Workspace preferences are not saved. Stay in this view, retry saving, then navigate again." />}
    <section aria-label="Conversations" className={clsx('h-full min-h-0 overflow-y-auto border-r border-slate-200 bg-white',conversationId&&'hidden lg:block')}>
      <ConversationList activeView={viewId??'all'} selectedTicketId={conversationId??null} routeReady={routeReady} />
    </section>
    <section aria-label="Active conversation" className={clsx('h-full min-h-0 overflow-y-auto bg-slate-50 p-4 lg:col-span-2 lg:p-8',!conversationId&&'hidden lg:block')}>
      {conversationId?<TicketDetailPage id={conversationId} workspaceBackHref={`/inbox/${viewId??'all'}`} />:<EmptyConversation />}
    </section>
  </div>;
}

function EmptyConversation(){return <div className="flex min-h-full items-center justify-center"><div className="max-w-sm text-center">
  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Inbox aria-hidden="true" /></span>
  <h1 className="mt-4 text-xl font-bold text-slate-900">Choose a conversation</h1>
  <p className="mt-2 text-sm leading-6 text-slate-600">The selected view and your place in the list stay here while you read and reply.</p>
  </div></div>;}

function ConversationList({activeView,selectedTicketId,routeReady}:{activeView:string;selectedTicketId:string|null;routeReady:boolean}){
  const navigate=useNavigate();
  const workspace=useOperatorWorkspaceState();
  const {data:filters,isLoading:isLoadingFilters}=useFilters();
  const drafts=useOperatorDraftIndicators();
  const {data:settings}=useSettings();
  const prefix=settings?.TICKET_PREFIX||'#';
  const filterId=activeView==='all'?'':activeView;
  const page=pageFromAnchor(workspace.listAnchor);
  const [filterInput,setFilterInput]=useState(workspace.listQuery);
  const [focusedIndex,setFocusedIndex]=useState(0);
  const rowRefs=useRef<Array<HTMLAnchorElement|null>>([]);
  const heading=useRef<HTMLHeadingElement>(null);
  const paging=useRef(false);
  const [status,setStatus]=useState('');
  const query=useTickets({page:String(page),sort:workspace.sort,...(filterId?{filter_id:filterId}:{}),...(workspace.listQuery?{search:workspace.listQuery}:{})});
  const tickets=query.data?.data??[];
  const meta=query.data?.meta??{page:1,limit:20,total:0,total_pages:1};
  const ticketSla=useTicketSlaBatch(tickets.map(ticket=>ticket.id),routeReady&&!query.isPlaceholderData&&!query.error&&Boolean(query.data));

  useEffect(()=>setFilterInput(workspace.listQuery),[workspace.listQuery]);
  useEffect(()=>{
    if(!query.isFetching&&paging.current){paging.current=false;if(!query.error)heading.current?.focus();}
  },[query.error,query.isFetching]);
  useEffect(()=>{
    const selected=tickets.findIndex(ticket=>ticket.id===selectedTicketId);
    setFocusedIndex(current=>selected>=0?selected:current>=tickets.length?Math.max(0,tickets.length-1):current);
  },[selectedTicketId,tickets]);

  const selectView=(id:string)=>{
    navigate(`/inbox/${id}`);
  };
  const moveFocus=(index:number)=>{const next=Math.max(0,Math.min(tickets.length-1,index));setFocusedIndex(next);rowRefs.current[next]?.focus();};

  return <div className="flex min-h-full flex-col">
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-brand-700">Workspace</p>
        <h1 ref={heading} tabIndex={-1} className="mt-1 text-2xl font-bold text-slate-900">Inbox</h1></div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{meta.total} conversations</span></div>
      <nav aria-label="Work views" className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <TocynButton type="button" aria-pressed={activeView==='all'} onClick={()=>selectView('all')}
          className={clsx('shrink-0 rounded-full border px-3 py-2 text-sm font-semibold',activeView==='all'?'border-brand-600 bg-brand-50 text-brand-800':'border-slate-300 text-slate-700')}>All tickets</TocynButton>
        {isLoadingFilters?<span role="status" className="px-2 py-2 text-sm text-slate-500">Loading saved views…</span>:filters?.map(filter=><TocynButton key={filter.id} type="button"
          aria-pressed={activeView===filter.id} onClick={()=>selectView(filter.id)} className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold',
            activeView===filter.id?'border-brand-600 bg-brand-50 text-brand-800':'border-slate-300 text-slate-700')}><Filter className="h-3.5 w-3.5" aria-hidden="true" />{filter.name}</TocynButton>)}</nav>
      <p className="mt-3 text-xs text-slate-600">Current view: <span className="font-semibold text-slate-800">{activeView==='all'?'All tickets':(filters?.find(filter=>filter.id===activeView)?.name??'Saved view')}</span>. Filtering stays within this view.</p>
      <form className="relative mt-4" onSubmit={event=>{event.preventDefault();workspace.update({listQuery:filterInput.trim(),listAnchor:'page:1'});setStatus(filterInput.trim()?'Current-view filter applied.':'Current-view filter cleared.');}}>
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" aria-hidden="true" />
        <TocynInput aria-label="Filter this view" placeholder="Filter this view" value={filterInput} maxLength={256}
          onChange={event=>setFilterInput(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&filterInput){event.preventDefault();setFilterInput('');workspace.update({listQuery:'',listAnchor:'page:1'});setStatus('Current-view filter cleared.');}}}
          className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-24 text-sm focus:ring-2 focus:ring-brand-600" />
        <TocynButton type="button" aria-label="Clear current-view filter" disabled={!filterInput} onClick={()=>{setFilterInput('');workspace.update({listQuery:'',listAnchor:'page:1'});setStatus('Current-view filter cleared.');}}
          className="absolute right-2 top-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 underline disabled:no-underline disabled:opacity-50">Clear</TocynButton>
      </form>
      <div className="mt-3 flex items-center justify-between gap-3"><label className="text-xs font-semibold text-slate-600">Sort
        <TocynSelect aria-label="Sort conversations" value={workspace.sort} onChange={event=>workspace.update({sort:event.target.value as WorkspacePreference['sort'],listAnchor:'page:1'})}
          className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"><option value="updated_desc">Recently updated</option><option value="updated_asc">Least recently updated</option>
          <option value="created_desc">Newest</option><option value="created_asc">Oldest</option><option value="priority_desc">Highest priority</option><option value="priority_asc">Lowest priority</option></TocynSelect></label>
        <p role="status" aria-label="Inbox status" className="text-xs text-slate-600">{query.isPlaceholderData?'Refreshing…':workspace.status==='saving'?'Saving view…':status}</p></div>
    </header>
    {query.error&&<div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{tickets.length?'Could not refresh conversations. The last confirmed list remains visible.':'Could not load conversations.'}</p>
      <TocynButton type="button" disabled={query.isFetching} onClick={()=>void query.refetch()} className="mt-2 font-semibold underline">Retry conversations</TocynButton></div>}
    {workspace.status==='error'||workspace.status==='conflict'?<div role="alert" className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{workspace.error}
      <TocynButton type="button" onClick={workspace.status==='conflict'?workspace.restoreServerState:workspace.retrySave} className="ml-2 font-semibold underline">{workspace.status==='conflict'?'Restore saved view':'Retry saving view'}</TocynButton></div>:null}
    {drafts.status==='partial'&&<p role="status" className="mx-4 mt-3 text-xs text-amber-900">Some draft indicators are still loading.</p>}
    <div role="listbox" aria-label="Conversation list" aria-activedescendant={tickets[focusedIndex]?`conversation-${tickets[focusedIndex].id}`:undefined} className="flex-1 divide-y divide-slate-200">
      {query.isLoading?<p role="status" className="p-6 text-center text-sm text-slate-600">Loading conversations…</p>:tickets.length===0&&!query.error?<div className="p-8 text-center"><p className="font-semibold text-slate-800">No conversations in this view</p><p className="mt-1 text-sm text-slate-600">Clear the view filter or choose another saved view.</p></div>:tickets.map((ticket,index)=>{
        const selected=ticket.id===selectedTicketId;const reference=ticketReference(ticket,prefix);
        return <Link key={ticket.id} ref={node=>{rowRefs.current[index]=node;}} id={`conversation-${ticket.id}`} role="option" aria-selected={selected} tabIndex={index===focusedIndex?0:-1}
          to={`/inbox/${activeView}/${ticket.id}`} onClick={()=>{if(!workspace.hasUnsavedChanges)workspace.update({selectedTicketId:ticket.id});}} onFocus={()=>setFocusedIndex(index)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();moveFocus(index+1);}if(event.key==='ArrowUp'){event.preventDefault();moveFocus(index-1);}}}
          className={clsx('block border-l-4 px-4 py-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700',selected?'border-brand-600 bg-brand-50':'border-transparent bg-white hover:bg-slate-50')}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{ticket.subject}</p><p className="mt-0.5 truncate text-sm text-slate-600">{ticket.customer_email}</p></div>
            <time className="shrink-0 text-xs text-slate-500" dateTime={ticket.updated_at}>{utcTimestamp(ticket.updated_at).toLocaleDateString()}</time></div>
          {ticket.snippet&&<p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600">{ticket.snippet}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-mono font-semibold text-slate-600">{reference}</span>
            <span className={clsx('rounded-full border px-2 py-0.5 font-semibold capitalize',statusStyle[ticket.status as keyof typeof statusStyle]??statusStyle.open)}>{ticket.status}</span>
            <span className={clsx('inline-flex items-center gap-1 font-semibold capitalize',priorityStyle[ticket.priority as keyof typeof priorityStyle]??priorityStyle.normal)}><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{ticket.priority}</span>
            {drafts.ticketIds.has(ticket.id)&&<span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">Draft</span>}</div>
          <div className="mt-2">{ticketSla.isLoading?<span className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3 w-3" aria-hidden="true" />Loading service level…</span>
            :<ConversationSlaStatus sla={ticketSla.isError||query.isPlaceholderData?undefined:ticketSla.data?.[ticket.id]} />}</div>
        </Link>;
      })}
    </div>
    {meta.total_pages>1&&<footer className="sticky bottom-0 flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3"><span role="status" className="text-xs font-semibold text-slate-600">Page {meta.page} of {meta.total_pages}</span><div className="flex gap-2">
      <TocynButton type="button" aria-label="Previous conversation page" aria-disabled={query.isFetching||page<=1} onClick={()=>{if(!query.isFetching&&page>1){paging.current=true;workspace.update({listAnchor:pageAnchor(page-1)});}}} className="rounded-lg border border-slate-300 p-2"><ChevronLeft className="h-4 w-4" /></TocynButton>
      <TocynButton type="button" aria-label="Next conversation page" aria-disabled={query.isFetching||page>=meta.total_pages} onClick={()=>{if(!query.isFetching&&page<meta.total_pages){paging.current=true;workspace.update({listAnchor:pageAnchor(page+1)});}}} className="rounded-lg border border-slate-300 p-2"><ChevronRight className="h-4 w-4" /></TocynButton></div></footer>}
  </div>;
}
