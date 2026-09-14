import { useOptionalOperatorPreferencesContext } from '../components/theme/OperatorThemeProvider';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import { TocynButton,TocynInput,TocynSelect } from '@luminatick/ui/primitives';
import { TocynSplitter } from '../../../../packages/ui/src/splitter';
import { AlertCircle,ChevronLeft,ChevronRight,Clock,Filter,Inbox,LayoutList,Search,Table2 } from 'lucide-react';
import React,{useCallback,useLayoutEffect,useEffect,useMemo,useRef,useState} from 'react';
import { Link,useNavigate,useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { SlaQueueNotice } from '../components/SlaQueueNotice';
import { ConversationSlaStatus } from '../components/ConversationSlaStatus';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
import { useFilters } from '../hooks/useFilters';
import { OperatorWorkspaceProvider,useOperatorDraftIndicators,useOperatorWorkspaceState,type WorkspacePreference } from '../hooks/useOperatorWorkspaceState';
import { useSettings } from '../hooks/useSettings';
import { useTicketSlaBatch } from '../hooks/useTicketSla';
import { useStandardQueueCounts, useTickets } from '../hooks/useTickets';
import { ticketReference } from '../utils/ticket-reference';
import { utcTimestamp } from '../utils/utcTimestamp';
import { TicketDetailPage } from './TicketDetailPage';

const statusStyle={open:'bg-emerald-50 text-emerald-800 border-emerald-200',pending:'bg-amber-50 text-amber-900 border-amber-200',
  resolved:'bg-slate-100 text-slate-700 border-slate-200',closed:'bg-slate-100 text-slate-700 border-slate-200'} as const;
const priorityStyle={low:'text-slate-500',normal:'text-blue-600',high:'text-orange-700',urgent:'text-red-700'} as const;
const queueViews={mentions:{label:'Mentions',description:'Actionable conversations with a mention for you that has not been dismissed.'},mine:{label:'Mine',description:'Open and pending conversations assigned to you and ready for work.'},unassigned:{label:'Unassigned',description:'Open and pending conversations without an assignee and ready for work.'},drafts:{label:'Drafts',description:'Conversations with your saved drafts.'},actionable:{label:'Needs Action',description:'Open and pending conversations ready for work.'},snoozed:{label:'Snoozed',description:'Conversations paused until their authoritative resurface time.'}} as const;
type QueueView=keyof typeof queueViews;
function isQueueView(value:string|undefined):value is QueueView{return value==='actionable'||value==='snoozed'||value==='drafts'||value==='mine'||value==='unassigned'||value==='mentions';}
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
  const splitterRatio = Math.min(50, Math.max(24, Math.round(workspace.splitterRatio ?? 32)));
  const onSplitterResizeEnd = useCallback((details: { size: number[] }) => {
    const next = Math.min(50, Math.max(24, Math.round(details.size[0] ?? splitterRatio)));
    if (next !== splitterRatio) workspace.update({ splitterRatio: next });
  }, [splitterRatio, workspace]);
  const advance = useRef<((id:string)=>void)|null>(null);
  const [advanceNotice,setAdvanceNotice] = useState('');
  const {data:filters,isLoading:isLoadingFilters}=useFilters();
  const resolveScope = JSON.stringify([assignmentIdentity(), viewId, conversationId, workspace.listQuery, workspace.sort, workspace.filters, filters]);
  const committedResolveScope = useRef(resolveScope);
  useLayoutEffect(() => { committedResolveScope.current = resolveScope; return () => { committedResolveScope.current = ''; }; }, [resolveScope]);
  useEffect(() => { setAdvanceNotice(''); }, [resolveScope]);
  const onResolved = useCallback((id:string) => {
    if (committedResolveScope.current === resolveScope) advance.current?.(id);
  }, [resolveScope]);

  const lastRouteView=useRef<string|null>(null);
  const routeFilter=useMemo(()=>viewId&&viewId!=='all'&&!isQueueView(viewId)?filters?.find(filter=>filter.id===viewId):undefined,[filters,viewId]);
  const routeReady=!isLoadingFilters&&(viewId==='all'||isQueueView(viewId)||Boolean(routeFilter));

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

  if(viewId&&viewId!=='all'&&!isQueueView(viewId)&&!isLoadingFilters&&!routeFilter)return <section className="p-6" aria-labelledby="inbox-view-unavailable">
    <h1 id="inbox-view-unavailable" tabIndex={-1} className="text-xl font-bold text-slate-900">Inbox view unavailable</h1>
    <p className="mt-2 text-slate-600">This saved view is unavailable for the current account.</p>
    <Link to="/inbox/all" replace className="mt-4 inline-flex rounded border border-slate-300 px-4 py-2 font-semibold">Open All tickets</Link>
  </section>;

  return <div className="tocyn-inbox-layout h-full min-h-0 bg-slate-100">
    {!conversationId&&<DraftNavigationGuard pending={workspace.hasUnsavedChanges} flush={workspace.flushBeforeNavigation}
      failureMessage="Workspace preferences are not saved. Stay in this view, retry saving, then navigate again." />}
    <div className="hidden h-full min-h-0 lg:block">
      <TocynSplitter.Root orientation="horizontal" size={[splitterRatio, 100 - splitterRatio]} onResizeEnd={onSplitterResizeEnd} panels={[{ id: 'inbox', minSize: 24, maxSize: 50 }, { id: 'conversation', minSize: 50, maxSize: 76 }]}>
        <TocynSplitter.Panel id="inbox" className="tocyn-conversation-list border-r border-slate-200 bg-white">
          <ConversationList activeView={viewId??'all'} selectedTicketId={conversationId??null} routeReady={routeReady} advanceRef={advance} onAdvanceNotice={setAdvanceNotice} />
        </TocynSplitter.Panel>
        <TocynSplitter.ResizeTrigger id="inbox:conversation" aria-label="Resize inbox and conversation panes" />
        <TocynSplitter.Panel id="conversation" className="tocyn-active-conversation overflow-y-auto bg-slate-50 p-4">
          {advanceNotice && <p role="status" className="mb-3 text-sm text-slate-700">{advanceNotice}</p>}
          {conversationId?<TicketDetailPage id={conversationId} workspaceBackHref={`/inbox/${viewId??'all'}`} onResolved={onResolved} />:<EmptyConversation />}
        </TocynSplitter.Panel>
      </TocynSplitter.Root>
    </div>
    <div className="h-full min-h-0 lg:hidden">
      <section aria-label="Conversations" className={clsx('tocyn-conversation-list h-full min-h-0 overflow-y-auto border-r border-slate-200 bg-white',conversationId&&'hidden')}>
        <ConversationList activeView={viewId??'all'} selectedTicketId={conversationId??null} routeReady={routeReady} advanceRef={advance} onAdvanceNotice={setAdvanceNotice} />
      </section>
      <section aria-label="Active conversation" className={clsx('tocyn-active-conversation h-full min-h-0 overflow-y-auto bg-slate-50 p-4',!conversationId&&'hidden')}>
        {advanceNotice && <p role="status" className="mb-3 text-sm text-slate-700">{advanceNotice}</p>}
        {conversationId?<TicketDetailPage id={conversationId} workspaceBackHref={`/inbox/${viewId??'all'}`} onResolved={onResolved} />:<EmptyConversation />}
      </section>
    </div>
  </div>;
}

function EmptyConversation(){return <div className="flex min-h-full items-center justify-center"><div className="max-w-sm text-center">
  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Inbox aria-hidden="true" /></span>
  <h1 className="mt-4 text-xl font-bold text-slate-900">Choose a conversation</h1>
  <p className="mt-2 text-sm leading-6 text-slate-600">The selected view and your place in the list stay here while you read and reply.</p>
  </div></div>;}

function ConversationList({activeView,selectedTicketId,routeReady,advanceRef,onAdvanceNotice}:{activeView:string;selectedTicketId:string|null;routeReady:boolean;advanceRef:React.MutableRefObject<((id:string)=>void)|null>;onAdvanceNotice:(message:string)=>void}){
  const navigate=useNavigate();
  const workspace=useOperatorWorkspaceState();
  const {data:filters,isLoading:isLoadingFilters}=useFilters();
  const drafts=useOperatorDraftIndicators();
  const queueCounts=useStandardQueueCounts();
  const {data:settings}=useSettings();
  const prefix=settings?.TICKET_PREFIX||'#';
  const queue=isQueueView(activeView)?activeView:undefined;
  const filterId=activeView==='all'||queue?'':activeView;
  const confirmedView=useRef<string|null>(null);
  // A successful route change starts a different view at page one; blocked navigation
  // leaves the current workspace untouched, and initial restoration keeps its page.
  const viewChanged=confirmedView.current!==null&&confirmedView.current!==activeView;
  const page=viewChanged?1:pageFromAnchor(workspace.listAnchor);
  const [recoveringView,setRecoveringView]=useState<string|null>(null);
  const [filterInput,setFilterInput]=useState(workspace.listQuery);
  const [focusedIndex,setFocusedIndex]=useState(0);
  const [presentation,setPresentation]=useState<'list'|'table'>('list');
  const rowRefs=useRef<Array<HTMLAnchorElement|null>>([]);
  const heading=useRef<HTMLHeadingElement>(null);
  const paging=useRef(false);
  const [status,setStatus]=useState('');
  const query=useTickets({page:String(page),sort:workspace.sort,...(queue?{queue}:{}),...(filterId?{filter_id:filterId}:{}),...(workspace.listQuery?{search:workspace.listQuery}:{})});
  const tickets=query.data?.data??[];
  const meta=query.data?.meta??{page:1,limit:20,total:0,total_pages:1};
  const slaSort=workspace.sort==='sla_priority';
  const batchSla=useTicketSlaBatch(tickets.map(ticket=>ticket.id),!slaSort&&routeReady&&!query.isPlaceholderData&&!query.error&&Boolean(query.data));
  const ticketSla=slaSort?{...query,data:Object.fromEntries(Object.entries(query.data?.sla??{}).filter(([,value])=>value!==null))}:batchSla;
  const restartSla=()=>{query.restartSla();workspace.update({listAnchor:'page:1'});setStatus('SLA ordering restarted. The selected conversation stays open.');};
  const advanceEnabled = useOptionalOperatorPreferencesContext()?.advanceAfterResolve ?? false;
  const tableColumns = useOptionalOperatorPreferencesContext()?.tableColumns ?? ['reference','subject','status','priority','customer','updated'] as const;
  const identity = assignmentIdentity();
  const advanceScope = JSON.stringify([identity, activeView, filterId, workspace.listQuery, workspace.sort, workspace.filters, filters, selectedTicketId, advanceEnabled]);
  const committedAdvanceScope = useRef(advanceScope);
  const manualPageGeneration = useRef(0);
  useLayoutEffect(() => {
    committedAdvanceScope.current = advanceScope;
    return () => { committedAdvanceScope.current = ''; };
  }, [advanceScope]);
  const [advanceRequest, setAdvanceRequest] = useState<{id:string;scope:string;pageGeneration:number}|null>(null);
  useLayoutEffect(() => {
    const begin = (id:string) => {
      if (!advanceEnabled || !routeReady || selectedTicketId !== id || assignmentIdentity() !== identity) return;
      workspace.update({listAnchor:'page:1'});
      if (slaSort) query.restartSla();
      onAdvanceNotice('Conversation resolved. Refreshing this view for the next available work…');
      setAdvanceRequest({id,scope:advanceScope,pageGeneration:manualPageGeneration.current});
    };
    advanceRef.current = begin;
    return () => { if (advanceRef.current === begin) advanceRef.current = null; };
  }, [advanceEnabled, advanceRef, advanceScope, onAdvanceNotice, identity, query.restartSla, routeReady, selectedTicketId, slaSort, workspace]);
  useEffect(() => {
    if (!advanceRequest || page !== 1) return;
    if (advanceRequest.scope !== advanceScope) { setAdvanceRequest(null); onAdvanceNotice('Automatic advance stopped. The current conversation stays open.'); return; }
    let active = true;
    void query.refetch({throwOnError:true}).then(result => {
      if (!active || assignmentIdentity() !== identity || committedAdvanceScope.current !== advanceRequest.scope || manualPageGeneration.current !== advanceRequest.pageGeneration) return;
      const next = result.data?.meta.page === 1 ? result.data.data.find(row => row.id !== advanceRequest.id && (row.status === 'open' || row.status === 'pending')) : undefined;
      setAdvanceRequest(null);
      if (!next) { onAdvanceNotice('Conversation resolved. No next open or pending conversation was found on the refreshed first page. The current conversation stays open.'); return; }
      onAdvanceNotice('Conversation resolved. Opening the next available conversation.');
      navigate(`/inbox/${activeView}/${next.id}`);
    }).catch(() => {
      if (active && assignmentIdentity() === identity && committedAdvanceScope.current === advanceRequest.scope && manualPageGeneration.current === advanceRequest.pageGeneration) {
        setAdvanceRequest(null);
        onAdvanceNotice('Conversation resolved. The next conversation could not be loaded. The current conversation stays open; refresh the view to continue.');
      }
    });
    return () => { active = false; };
  }, [advanceRequest, advanceScope, activeView, identity, navigate, onAdvanceNotice, page, query.refetch]);


  const outOfRange=Boolean(query.data&&!query.isFetching&&!query.isPlaceholderData&&!query.error
    &&meta.page===page&&page>1&&tickets.length===0&&meta.total>0);
  const recoveringPage=recoveringView===activeView;
  const emptyPage=tickets.length===0&&!query.error&&!query.isPlaceholderData&&!outOfRange&&!recoveringPage;
  const emptyMessage=meta.total>0?'No conversations on this page':queue==='drafts'?'No saved drafts'
    :queue==='mine'?'No actionable conversations assigned to you':queue?`No ${queueViews[queue].label.toLowerCase()} conversations`:'No conversations in this view';
  useEffect(()=>{
    if(!routeReady||workspace.status==='loading')return;
    if(confirmedView.current===null){confirmedView.current=activeView;return;}
    if(confirmedView.current!==activeView){confirmedView.current=activeView;workspace.update({listAnchor:'page:1'});}
  },[activeView,routeReady,workspace]);
  useEffect(()=>{
    if(!routeReady||workspace.status==='loading'||!outOfRange)return;
    setRecoveringView(activeView);workspace.update({listAnchor:'page:1'});
  },[activeView,outOfRange,routeReady,workspace]);
  useEffect(()=>{
    if(recoveringView===null)return;
    if(recoveringView!==activeView){setRecoveringView(null);return;}
    if(!query.isFetching&&(query.error||!query.isPlaceholderData&&meta.page===1&&page===1)){
      setRecoveringView(null);
      if(!query.error)setStatus('Showing the first page after the conversation list changed.');
    }
  },[activeView,meta.page,page,query.error,query.isFetching,query.isPlaceholderData,recoveringView]);
  useEffect(()=>setFilterInput(workspace.listQuery),[workspace.listQuery]);
  useEffect(()=>{
    if(!query.isFetching&&paging.current){paging.current=false;if(!query.error||slaSort)heading.current?.focus();}
  },[query.error,query.isFetching,slaSort]);
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
        {(['mine','unassigned','mentions','drafts','snoozed','actionable','all'] as const).map(view=>{
          const label=view==='all'?'All tickets':queueViews[view].label;
          const total=!queueCounts.isFetching&&!queueCounts.error?queueCounts.data?.[view]:undefined;
          return <TocynButton key={view} type="button" aria-label={label} aria-pressed={activeView===view}
            aria-describedby={total===undefined?undefined:`queue-total-${view}`} onClick={()=>selectView(view)}
            className={clsx('shrink-0 rounded-full border px-3 py-2 text-sm font-semibold',activeView===view?'border-brand-600 bg-brand-50 text-brand-800':'border-slate-300 text-slate-700')}>
            {label}{total!==undefined&&<><span aria-hidden="true" className="ml-1.5">{total}</span><span id={`queue-total-${view}`} className="sr-only">{total} conversations in this standard queue</span></>}
          </TocynButton>;
        })}
        {isLoadingFilters?<span role="status" className="px-2 py-2 text-sm text-slate-500">Loading saved views…</span>:filters?.map(filter=><TocynButton key={filter.id} type="button"
          aria-pressed={activeView===filter.id} onClick={()=>selectView(filter.id)} className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold',
            activeView===filter.id?'border-brand-600 bg-brand-50 text-brand-800':'border-slate-300 text-slate-700')}><Filter className="h-3.5 w-3.5" aria-hidden="true" />{filter.name}</TocynButton>)}</nav>
      <p className="mt-2 text-xs text-slate-500">Queue totals cover standard views before search or custom filters.</p>
      {queueCounts.isFetching?<p role="status" className="mt-1 text-xs text-slate-500">Refreshing queue totals…</p>:queueCounts.error?<p role="status" className="mt-1 text-xs text-slate-600">Queue totals unavailable. <TocynButton type="button" onClick={()=>void queueCounts.refetch()} className="underline">Retry queue totals</TocynButton></p>:null}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" aria-label="Inbox metrics">
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5"><span className="block text-slate-500">View</span><span className="font-semibold text-slate-800">{activeView==='all'?'All tickets':queue?queueViews[queue].label:(filters?.find(filter=>filter.id===activeView)?.name??'Saved view')}</span></div>
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5"><span className="block text-slate-500">Open</span><span className="font-semibold text-slate-800">{queueCounts.data?.all ?? meta.total}</span></div>
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5"><span className="block text-slate-500">Showing</span><span className="font-semibold text-slate-800">{tickets.length} of {meta.total}</span></div>
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5"><span className="block text-slate-500">Sort</span><span className="font-semibold text-slate-800">{workspace.sort.replaceAll('_',' ')}</span></div>
      </div>
      <form className="relative mt-4" onSubmit={event=>{event.preventDefault();workspace.update({listQuery:filterInput.trim(),listAnchor:'page:1'});setStatus(filterInput.trim()?'Current-view filter applied.':'Current-view filter cleared.');}}>
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" aria-hidden="true" />
        <TocynInput aria-label="Filter this view" placeholder="Filter this view" value={filterInput} maxLength={256}
          onChange={event=>setFilterInput(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&filterInput){event.preventDefault();setFilterInput('');workspace.update({listQuery:'',listAnchor:'page:1'});setStatus('Current-view filter cleared.');}}}
          className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-24 text-sm focus:ring-2 focus:ring-brand-600" />
        <TocynButton type="button" aria-label="Clear current-view filter" disabled={!filterInput} onClick={()=>{setFilterInput('');workspace.update({listQuery:'',listAnchor:'page:1'});setStatus('Current-view filter cleared.');}}
          className="absolute right-2 top-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 underline disabled:no-underline disabled:opacity-50">Clear</TocynButton>
      </form>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><label className="text-xs font-semibold text-slate-600">Sort
        <TocynSelect aria-label="Sort conversations" value={workspace.sort} onChange={event=>{if(event.target.value==='sla_priority')query.restartSla();workspace.update({sort:event.target.value as WorkspacePreference['sort'],listAnchor:'page:1'});}}
          className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"><option value="updated_desc">Recently updated</option><option value="updated_asc">Least recently updated</option>
          <option value="created_desc">Newest</option><option value="created_asc">Oldest</option><option value="priority_desc">Highest priority</option><option value="priority_asc">Lowest priority</option><option value="sla_priority">Earliest SLA deadline</option></TocynSelect></label>
        <div role="group" aria-label="Conversation presentation" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          <TocynButton type="button" aria-pressed={presentation==='list'} aria-label="List view" onClick={()=>setPresentation('list')} className={clsx('rounded-md p-1.5',presentation==='list'?'bg-brand-50 text-brand-800':'text-slate-600')}><LayoutList className="h-4 w-4" aria-hidden="true" /></TocynButton>
          <TocynButton type="button" aria-pressed={presentation==='table'} aria-label="Table view" onClick={()=>setPresentation('table')} className={clsx('rounded-md p-1.5',presentation==='table'?'bg-brand-50 text-brand-800':'text-slate-600')}><Table2 className="h-4 w-4" aria-hidden="true" /></TocynButton>
        </div></div>
        <p role="status" aria-label="Inbox status" className="text-xs text-slate-600">{recoveringPage?'Loading the first page after the conversation list changed…':query.isPlaceholderData?'Refreshing…':workspace.status==='saving'?'Saving view…':status}</p></div>
    </header>
    {slaSort&&<SlaQueueNotice asOf={query.data?.asOf} error={query.error} busy={query.isFetching} restart={restartSla} />}
    {query.error&&<div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{tickets.length?'Could not refresh conversations. The last confirmed list remains visible.':'Could not load conversations.'}</p>
      <TocynButton type="button" disabled={query.isFetching} onClick={()=>slaSort?restartSla():void query.refetch()} className="mt-2 font-semibold underline">Retry conversations</TocynButton></div>}
    {workspace.status==='error'||workspace.status==='conflict'?<div role="alert" className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{workspace.error}
      <TocynButton type="button" onClick={workspace.status==='conflict'?workspace.restoreServerState:workspace.retrySave} className="ml-2 font-semibold underline">{workspace.status==='conflict'?'Restore saved view':'Retry saving view'}</TocynButton></div>:null}
    {drafts.status==='partial'&&<p role="status" className="mx-4 mt-3 text-xs text-amber-900">Some draft indicators are still loading.</p>}
    {presentation==='table'&&<p role="status" className="mx-4 mt-3 text-xs text-slate-600 sm:hidden">Table view uses the compact conversation list on small screens.</p>}
    <div role="listbox" aria-label="Conversation list" aria-activedescendant={tickets[focusedIndex]?`conversation-${tickets[focusedIndex].id}`:undefined} className={clsx('flex-1 divide-y divide-slate-200',presentation==='table'&&'sm:hidden')}>
      {query.isLoading?<p role="status" className="p-6 text-center text-sm text-slate-600">Loading conversations…</p>:emptyPage?<div className="p-8 text-center"><p className="font-semibold text-slate-800">{emptyMessage}</p><p className="mt-1 text-sm text-slate-600">{queue?queueViews[queue].description:'Clear the view filter or choose another saved view.'}</p></div>:tickets.map((ticket,index)=>{
        const selected=ticket.id===selectedTicketId;const reference=ticketReference(ticket,prefix);
        return <Link key={ticket.id} ref={node=>{rowRefs.current[index]=node;}} id={`conversation-${ticket.id}`} role="option" aria-selected={selected} tabIndex={index===focusedIndex?0:-1}
          to={`/inbox/${activeView}/${ticket.id}`} onClick={()=>{if(!workspace.hasUnsavedChanges)workspace.update({selectedTicketId:ticket.id});}} onFocus={()=>setFocusedIndex(index)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();moveFocus(index+1);}if(event.key==='ArrowUp'){event.preventDefault();moveFocus(index-1);}}}
          className={clsx('block border-l-4 px-4 py-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700',selected?'border-brand-600 bg-brand-50':'border-transparent bg-white hover:bg-slate-50')}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{ticket.subject}</p><p className="mt-0.5 truncate text-sm text-slate-600">{ticket.customer_email}</p></div>
            <time className="shrink-0 text-xs text-slate-500" dateTime={ticket.updated_at}>{utcTimestamp(ticket.updated_at).toLocaleDateString()}</time></div>
          {ticket.snippet&&<p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600">{ticket.snippet}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-mono font-semibold text-slate-600">{reference}</span>
            <span className={clsx('rounded-full border px-2 py-0.5 font-semibold capitalize',statusStyle[ticket.status as keyof typeof statusStyle]??statusStyle.open)}>{ticket.status}</span>
            {queue&&!query.isPlaceholderData&&<span className="rounded bg-brand-50 px-2 py-0.5 font-semibold text-brand-800" aria-label={`Inclusion reason: ${queue}`}>{queueViews[queue].label}</span>}
            <span className={clsx('inline-flex items-center gap-1 font-semibold capitalize',priorityStyle[ticket.priority as keyof typeof priorityStyle]??priorityStyle.normal)}><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{ticket.priority}</span>
            {drafts.ticketIds.has(ticket.id)&&<span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">Draft</span>}</div>
          <div className="mt-2">{ticketSla.isLoading?<span className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3 w-3" aria-hidden="true" />Loading service level…</span>
            :<ConversationSlaStatus sla={ticketSla.isError||query.isPlaceholderData?undefined:ticketSla.data?.[ticket.id]} />}</div>
        </Link>;
      })}
    </div>
      {presentation==='table'&&<div className="hidden flex-1 overflow-x-auto sm:block" aria-label="Conversation table">
        <table className="min-w-[40rem] w-full text-left text-sm"><caption className="sr-only">Tickets in the current view</caption><thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600"><tr>{tableColumns.map(column=><th key={column} scope="col" className="px-4 py-3">{column[0].toUpperCase()+column.slice(1)}</th>)}</tr></thead><tbody className="divide-y divide-slate-200">
          {query.isLoading?<tr><td colSpan={tableColumns.length} className="px-4 py-10 text-center text-slate-600">Loading conversations…</td></tr>:emptyPage?<tr><td colSpan={tableColumns.length} className="px-4 py-10 text-center text-slate-600">{emptyMessage}</td></tr>:tickets.map(ticket=>{
          const reference=ticketReference(ticket,prefix);const selected=ticket.id===selectedTicketId;
          return <tr key={ticket.id} aria-selected={selected} className={clsx('hover:bg-slate-50',selected&&'bg-brand-50')}>
            {tableColumns.map(column=><td key={column} className="whitespace-nowrap px-4 py-3">{column==='reference'?<Link to={`/inbox/${activeView}/${ticket.id}`} onClick={()=>{if(!workspace.hasUnsavedChanges)workspace.update({selectedTicketId:ticket.id});}} className="font-mono font-semibold text-slate-600 underline focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-700">{reference}</Link>:column==='subject'?<><Link to={`/inbox/${activeView}/${ticket.id}`} onClick={()=>{if(!workspace.hasUnsavedChanges)workspace.update({selectedTicketId:ticket.id});}} className="font-semibold text-slate-900 underline focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-700">{ticket.subject}</Link>{ticket.snippet&&<p className="mt-1 truncate text-xs text-slate-600">{ticket.snippet}</p>}</>:column==='status'?<span className={clsx('rounded-full border px-2 py-0.5 text-xs font-semibold capitalize',statusStyle[ticket.status as keyof typeof statusStyle]??statusStyle.open)}>{ticket.status}</span>:column==='priority'?<span className={clsx('inline-flex items-center gap-1 font-semibold capitalize',priorityStyle[ticket.priority as keyof typeof priorityStyle]??priorityStyle.normal)}><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{ticket.priority}</span>:column==='customer'?<span className="block max-w-[15rem] truncate text-slate-700" title={ticket.customer_email}>{ticket.customer_email}</span>:<time dateTime={ticket.updated_at}>{utcTimestamp(ticket.updated_at).toLocaleDateString()}</time>}</td>)}
          </tr>;
        })}
      </tbody></table>
    </div>}
    {meta.total_pages>1&&<footer className="sticky bottom-0 flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3"><span role="status" className="text-xs font-semibold text-slate-600">Page {meta.page} of {meta.total_pages}</span><div className="flex gap-2">
      <TocynButton type="button" aria-label="Previous conversation page" aria-disabled={query.isFetching||page<=1} onClick={()=>{manualPageGeneration.current++;setAdvanceRequest(null);onAdvanceNotice('');if(!query.isFetching&&page>1){paging.current=true;workspace.update({listAnchor:pageAnchor(page-1)});}}} className="rounded-lg border border-slate-300 p-2"><ChevronLeft className="h-4 w-4" /></TocynButton>
      <TocynButton type="button" aria-label="Next conversation page" aria-disabled={query.isFetching||page>=meta.total_pages} onClick={()=>{manualPageGeneration.current++;setAdvanceRequest(null);onAdvanceNotice('');if(!query.isFetching&&page<meta.total_pages){paging.current=true;workspace.update({listAnchor:pageAnchor(page+1)});}}} className="rounded-lg border border-slate-300 p-2"><ChevronRight className="h-4 w-4" /></TocynButton></div></footer>}
  </div>;
}
