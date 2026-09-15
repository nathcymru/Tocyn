import { useOptionalOperatorPreferencesContext } from '../components/theme/OperatorThemeProvider';
import { createListCollection } from '@ark-ui/react';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import { ParkButton, ParkEmptyState, ParkInput, ParkSelect, ParkSplitter } from '@luminatick/ui/park';
import { AlertCircle,ChevronLeft,ChevronRight,Clock,Filter,LayoutList,Search,Table2 } from '../components/icons';
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

const statusStyle={open:'tocyn-ticket-status-open',pending:'tocyn-ticket-status-pending',
  resolved:'tocyn-ticket-status-neutral',closed:'tocyn-ticket-status-neutral'} as const;
const priorityStyle={low:'tocyn-palette-neutral-text',normal:'tocyn-palette-blue-text',high:'tocyn-palette-orange-text',urgent:'tocyn-palette-red-text'} as const;
const sortOptions = createListCollection({ items: [
  { label: 'Recently updated', value: 'updated_desc' }, { label: 'Least recently updated', value: 'updated_asc' },
  { label: 'Newest', value: 'created_desc' }, { label: 'Oldest', value: 'created_asc' },
  { label: 'Highest priority', value: 'priority_desc' }, { label: 'Lowest priority', value: 'priority_asc' },
  { label: 'Earliest SLA deadline', value: 'sla_priority' },
] });
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
  const activeView = viewId || 'all';
  const navigate=useNavigate();
  const workspace=useOperatorWorkspaceState();
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

  if(viewId&&viewId!=='all'&&!isQueueView(viewId)&&!isLoadingFilters&&!routeFilter)return <ParkEmptyState
    id="inbox-view-unavailable" className="tocyn-inbox-view-unavailable" title="Inbox view unavailable" headingLevel={1}
    description="This saved view is unavailable for the current account."
    action={<ParkButton type="button" onClick={() => navigate('/inbox/all', { replace: true })} className="tocyn-inbox-view-unavailable-link">Open All tickets</ParkButton>}
  />;

  return <ParkSplitter.Root className="tocyn-inbox-workspace" orientation="horizontal"
    size={[workspace.splitterRatio, 100 - workspace.splitterRatio]} keyboardResizeBy={2}
    panels={[{ id: 'inbox-list', minSize: 24, maxSize: 50 }, { id: 'inbox-detail', minSize: 30, maxSize: 76 }]}
    onResizeEnd={({ size }) => {
      const ratio = Math.max(24, Math.min(50, Math.round(size[0] ?? workspace.splitterRatio)));
      workspace.update({ splitterRatio: ratio });
      // Resize events can arrive after the controller's debounce was cancelled by
      // navigation. Flush this user action on the next tick so a reload restores it.
      window.setTimeout(() => { void workspace.saveNow(); }, 0);
    }}>
    {!conversationId&&<DraftNavigationGuard pending={workspace.hasUnsavedChanges} flush={workspace.flushBeforeNavigation}
      failureMessage="Workspace preferences are not saved. Stay in this view, retry saving, then navigate again." />}
    <ParkSplitter.Panel id="inbox-list" role="region" aria-label="Conversations" className={clsx('tocyn-inbox-list-panel',conversationId&&'tocyn-inbox-mobile-hidden')}>
      <ConversationList activeView={activeView} selectedTicketId={conversationId??null} routeReady={routeReady} advanceRef={advance} onAdvanceNotice={setAdvanceNotice} />
    </ParkSplitter.Panel>
    <ParkSplitter.ResizeTrigger id="inbox-list:inbox-detail" aria-label="Resize conversation panes" />
    <ParkSplitter.Panel id="inbox-detail" role="region" aria-label="Active conversation" className={clsx('tocyn-inbox-detail-panel',!conversationId&&'tocyn-inbox-mobile-hidden')}>
      {advanceNotice && <p role="status" className="tocyn-inbox-status">{advanceNotice}</p>}
      {conversationId?<TicketDetailPage id={conversationId} workspaceBackHref={`/inbox/${activeView}`} onResolved={onResolved} />:<EmptyConversation />}
    </ParkSplitter.Panel>
  </ParkSplitter.Root>;
}

function EmptyConversation(){return <div className="tocyn-inbox-empty-conversation"><ParkEmptyState className="tocyn-inbox-empty-conversation-state" title="Choose a conversation" description="The selected view and your place in the list stay here while you read and reply." /></div>;}

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

  return <div className="tocyn-inbox-list">
    <header className="tocyn-inbox-header">
      <div className="tocyn-inbox-title-row"><div><p className="tocyn-inbox-eyebrow">Workspace</p>
        <h1 ref={heading} tabIndex={-1} className="tocyn-inbox-title">Inbox</h1></div>
        <span className="tocyn-inbox-count">{meta.total} conversations</span></div>
      <nav aria-label="Work views" className="tocyn-inbox-view-nav">
        {(['mine','unassigned','mentions','drafts','snoozed','actionable','all'] as const).map(view=>{
          const label=view==='all'?'All tickets':queueViews[view].label;
          const total=!queueCounts.isFetching&&!queueCounts.error?queueCounts.data?.[view]:undefined;
          return <ParkButton key={view} type="button" aria-label={label} aria-pressed={activeView===view}
            aria-describedby={total===undefined?undefined:`queue-total-${view}`} onClick={()=>selectView(view)}
            className={clsx('tocyn-inbox-view-button',activeView===view?'tocyn-inbox-view-button-active':'tocyn-inbox-view-button-inactive')}>
            {label}{total!==undefined&&<><span aria-hidden="true" className="tocyn-inbox-queue-total">{total}</span><span id={`queue-total-${view}`} className="tocyn-visually-hidden">{total} conversations in this standard queue</span></>}
          </ParkButton>;
        })}
        {isLoadingFilters?<span role="status" className="tocyn-inbox-loading-label">Loading saved views…</span>:filters?.map(filter=><ParkButton key={filter.id} type="button"
          aria-pressed={activeView===filter.id} onClick={()=>selectView(filter.id)} className={clsx('tocyn-inbox-view-button tocyn-inbox-view-button-with-icon',
            activeView===filter.id?'tocyn-inbox-view-button-active':'tocyn-inbox-view-button-inactive')}><Filter className="tocyn-inbox-filter-icon" aria-hidden="true" />{filter.name}</ParkButton>)}</nav>
      <p className="tocyn-inbox-status">Queue totals cover standard views before search or custom filters.</p>
      {queueCounts.isFetching?<p role="status" className="tocyn-inbox-status">Refreshing queue totals…</p>:queueCounts.error?<p role="status" className="tocyn-inbox-status">Queue totals unavailable. <ParkButton type="button" onClick={()=>void queueCounts.refetch()} className="tocyn-inbox-inline-retry">Retry queue totals</ParkButton></p>:null}
      <div className="tocyn-inbox-metric-strip" aria-label="Queue metrics">
        {(['all', 'actionable', 'unassigned'] as const).map(metric => <div key={metric} className="tocyn-inbox-metric-card">
          <span className="tocyn-inbox-metric-label">{metric === 'all' ? 'All tickets' : queueViews[metric].label}</span>
          <strong className="tocyn-inbox-metric-value tocyn-tabular">{queueCounts.isFetching ? '—' : queueCounts.data?.[metric] ?? 0}</strong>
        </div>)}
        <span className="tocyn-visually-hidden">Current view: <span className="tocyn-inbox-current-view-name">{activeView==='all'?'All tickets':queue?queueViews[queue].label:(filters?.find(filter=>filter.id===activeView)?.name??'Saved view')}</span>. Filtering stays within this view.</span>
      </div>
      <form className="tocyn-inbox-search-shell" onSubmit={event=>{event.preventDefault();workspace.update({listQuery:filterInput.trim(),listAnchor:'page:1'});setStatus(filterInput.trim()?'Current-view filter applied.':'Current-view filter cleared.');}}>
        <Search className="tocyn-inbox-search-icon" aria-hidden="true" />
        <ParkInput aria-label="Filter this view" placeholder="Filter this view" value={filterInput} maxLength={256}
          onChange={event=>setFilterInput(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&filterInput){event.preventDefault();setFilterInput('');workspace.update({listQuery:'',listAnchor:'page:1'});setStatus('Current-view filter cleared.');}}}
          className="tocyn-inbox-search" />
        <ParkButton type="button" aria-label="Clear current-view filter" disabled={!filterInput} onClick={()=>{setFilterInput('');workspace.update({listQuery:'',listAnchor:'page:1'});setStatus('Current-view filter cleared.');}}
          className="tocyn-inbox-clear-button">Clear</ParkButton>
      </form>
      <div className="tocyn-inbox-toolbar"><div className="tocyn-inbox-toolbar-group"><span className="tocyn-inbox-control-label" id="inbox-sort-label">Sort</span>
        <ParkSelect.Root collection={sortOptions as never} value={[workspace.sort]} onValueChange={({ value })=>{const next=value[0] as WorkspacePreference['sort']|undefined;if(!next)return;if(next==='sla_priority')query.restartSla();workspace.update({sort:next,listAnchor:'page:1'});}} positioning={{placement:'bottom-start'}}>
          <ParkSelect.Label className="tocyn-visually-hidden">Sort conversations</ParkSelect.Label><ParkSelect.Control><ParkSelect.Trigger aria-labelledby="inbox-sort-label"><ParkSelect.ValueText placeholder="Recently updated" /></ParkSelect.Trigger><ParkSelect.Indicator aria-hidden="true">⌄</ParkSelect.Indicator></ParkSelect.Control><ParkSelect.HiddenSelect />
          <ParkSelect.Positioner><ParkSelect.Content><ParkSelect.List>{sortOptions.items.map(item=>{const option=item as {label:string;value:string};return <ParkSelect.Item key={option.value} item={option}><ParkSelect.ItemText>{option.label}</ParkSelect.ItemText><ParkSelect.ItemIndicator>✓</ParkSelect.ItemIndicator></ParkSelect.Item>;})}</ParkSelect.List></ParkSelect.Content></ParkSelect.Positioner>
        </ParkSelect.Root>
        <div role="group" aria-label="Conversation presentation" className="tocyn-inbox-presentation-toggle">
          <ParkButton type="button" aria-pressed={presentation==='list'} aria-label="List view" onClick={()=>setPresentation('list')} className={clsx('tocyn-inbox-presentation-button',presentation==='list'?'tocyn-inbox-presentation-active':'tocyn-inbox-presentation-inactive')}><LayoutList className="tocyn-inbox-presentation-icon" aria-hidden="true" /></ParkButton>
          <ParkButton type="button" aria-pressed={presentation==='table'} aria-label="Table view" onClick={()=>setPresentation('table')} className={clsx('tocyn-inbox-presentation-button',presentation==='table'?'tocyn-inbox-presentation-active':'tocyn-inbox-presentation-inactive')}><Table2 className="tocyn-inbox-presentation-icon" aria-hidden="true" /></ParkButton>
        </div></div>
        <p role="status" aria-label="Inbox status" className="tocyn-inbox-status">{recoveringPage?'Loading the first page after the conversation list changed…':query.isPlaceholderData?'Refreshing…':workspace.status==='saving'?'Saving view…':status}</p></div>
    </header>
    {slaSort&&<SlaQueueNotice asOf={query.data?.asOf} error={query.error} busy={query.isFetching} restart={restartSla} />}
    {query.error&&<div role="alert" className="tocyn-inbox-error"><p>{tickets.length?'Could not refresh conversations. The last confirmed list remains visible.':'Could not load conversations.'}</p>
      <ParkButton type="button" disabled={query.isFetching} onClick={()=>slaSort?restartSla():void query.refetch()} className="tocyn-inbox-retry">Retry conversations</ParkButton></div>}
    {workspace.status==='error'||workspace.status==='conflict'?<div role="alert" className="tocyn-inbox-preference-error">{workspace.error}
      <ParkButton type="button" onClick={workspace.status==='conflict'?workspace.restoreServerState:workspace.retrySave} className="tocyn-inbox-inline-retry">{workspace.status==='conflict'?'Restore saved view':'Retry saving view'}</ParkButton></div>:null}
    {drafts.status==='partial'&&<p role="status" className="tocyn-inbox-draft-loading">Some draft indicators are still loading.</p>}
    {presentation==='table'&&<p role="status" className="tocyn-inbox-mobile-note">Table view uses the compact conversation list on small screens.</p>}
    <div role="listbox" aria-label="Conversation list" aria-activedescendant={tickets[focusedIndex]?`conversation-${tickets[focusedIndex].id}`:undefined} className={clsx('tocyn-inbox-list-rows',presentation==='table'&&'tocyn-inbox-list-mobile-hidden')}>
      {query.isLoading?<p role="status" className="tocyn-inbox-loading-state">Loading conversations…</p>:emptyPage?<ParkEmptyState className="tocyn-inbox-empty-state" title={emptyMessage} description={queue?queueViews[queue].description:'Clear the view filter or choose another saved view.'} />:tickets.map((ticket,index)=>{
        const selected=ticket.id===selectedTicketId;const reference=ticketReference(ticket,prefix);
        return <Link key={ticket.id} ref={node=>{rowRefs.current[index]=node;}} id={`conversation-${ticket.id}`} role="option" aria-selected={selected} tabIndex={index===focusedIndex?0:-1}
          to={`/inbox/${activeView}/${ticket.id}`} onClick={()=>{if(!workspace.hasUnsavedChanges)workspace.update({selectedTicketId:ticket.id});}} onFocus={()=>setFocusedIndex(index)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();moveFocus(index+1);}if(event.key==='ArrowUp'){event.preventDefault();moveFocus(index-1);}}}
          className={clsx('tocyn-inbox-row',selected&&'tocyn-inbox-row--selected')}>
          <div className="tocyn-inbox-title-row"><div className="tocyn-inbox-row-copy"><p className="tocyn-inbox-row-subject">{ticket.subject}</p><p className="tocyn-inbox-row-customer">{ticket.customer_email}</p></div>
            <time className="tocyn-inbox-row-date" dateTime={ticket.updated_at}>{utcTimestamp(ticket.updated_at).toLocaleDateString()}</time></div>
          {ticket.snippet&&<p className="tocyn-inbox-row-preview">{ticket.snippet}</p>}
          <div className="tocyn-inbox-row-meta"><span className="tocyn-inbox-row-reference">{reference}</span>
            <span className={clsx('tocyn-inbox-row-status',statusStyle[ticket.status as keyof typeof statusStyle]??statusStyle.open)}>{ticket.status}</span>
            {queue&&!query.isPlaceholderData&&<span className="tocyn-inbox-row-queue" aria-label={`Inclusion reason: ${queue}`}>{queueViews[queue].label}</span>}
            <span className={clsx('tocyn-inbox-row-priority',priorityStyle[ticket.priority as keyof typeof priorityStyle]??priorityStyle.normal)}><AlertCircle className="tocyn-inbox-priority-icon" aria-hidden="true" />{ticket.priority}</span>
            {drafts.ticketIds.has(ticket.id)&&<span className="tocyn-inbox-row-draft">Draft</span>}</div>
          <div className="tocyn-inbox-row-sla">{ticketSla.isLoading?<span className="tocyn-inbox-row-sla-loading"><Clock className="tocyn-inbox-sla-icon" aria-hidden="true" />Loading service level…</span>
            :<ConversationSlaStatus sla={ticketSla.isError||query.isPlaceholderData?undefined:ticketSla.data?.[ticket.id]} />}</div>
        </Link>;
      })}
    </div>
      {presentation==='table'&&<div className="tocyn-inbox-table-wrap tocyn-inbox-table-responsive" aria-label="Conversation table">
        <table className="tocyn-inbox-table"><caption className="tocyn-visually-hidden">Tickets in the current view</caption><thead className="tocyn-inbox-table-head"><tr>
          <th scope="col" className="tocyn-inbox-table-cell-nowrap">Reference</th><th scope="col" className="tocyn-inbox-table-cell">Subject</th><th scope="col" className="tocyn-inbox-table-cell-nowrap">Status</th><th scope="col" className="tocyn-inbox-table-cell-nowrap">Priority</th><th scope="col" className="tocyn-inbox-table-cell">Customer</th><th scope="col" className="tocyn-inbox-table-cell-nowrap">Updated</th>
        </tr></thead><tbody className="tocyn-inbox-table-body">
        {query.isLoading?<tr><td colSpan={6} className="tocyn-inbox-table-loading"><ParkEmptyState role="status" aria-busy="true" headingLevel={false} title="Loading conversations…" className="tocyn-inbox-table-state" /></td></tr>:emptyPage?<tr><td colSpan={6} className="tocyn-inbox-table-empty"><ParkEmptyState headingLevel={false} title={emptyMessage} description={queue?queueViews[queue].description:'Clear the view filter or choose another saved view.'} className="tocyn-inbox-table-state" /></td></tr>:tickets.map(ticket=>{
          const reference=ticketReference(ticket,prefix);const selected=ticket.id===selectedTicketId;
          return <tr key={ticket.id} aria-selected={selected} className={clsx('tocyn-inbox-table-row',selected&&'tocyn-inbox-table-row-selected')}>
            <td className="tocyn-inbox-table-reference">{reference}</td>
            <td className="tocyn-inbox-table-subject"><Link to={`/inbox/${activeView}/${ticket.id}`} onClick={()=>{if(!workspace.hasUnsavedChanges)workspace.update({selectedTicketId:ticket.id});}} className="tocyn-inbox-table-link">{ticket.subject}</Link>{ticket.snippet&&<p className="tocyn-inbox-table-preview">{ticket.snippet}</p>}</td>
            <td className="tocyn-inbox-table-cell-nowrap"><span className={clsx('tocyn-inbox-row-status',statusStyle[ticket.status as keyof typeof statusStyle]??statusStyle.open)}>{ticket.status}</span></td>
            <td className="tocyn-inbox-table-cell-nowrap"><span className={clsx('tocyn-inbox-row-priority',priorityStyle[ticket.priority as keyof typeof priorityStyle]??priorityStyle.normal)}><AlertCircle className="tocyn-inbox-priority-icon" aria-hidden="true" />{ticket.priority}</span></td>
            <td className="tocyn-inbox-table-customer" title={ticket.customer_email}>{ticket.customer_email}</td><td className="tocyn-inbox-table-date"><time dateTime={ticket.updated_at}>{utcTimestamp(ticket.updated_at).toLocaleDateString()}</time></td>
          </tr>;
        })}
      </tbody></table>
    </div>}
    {meta.total_pages>1&&<footer className="tocyn-inbox-pagination"><span role="status" className="tocyn-inbox-status">Page {meta.page} of {meta.total_pages}</span><div className="tocyn-inbox-pagination-actions">
      <ParkButton type="button" aria-label="Previous conversation page" aria-disabled={query.isFetching||page<=1} onClick={()=>{manualPageGeneration.current++;setAdvanceRequest(null);onAdvanceNotice('');if(!query.isFetching&&page>1){paging.current=true;workspace.update({listAnchor:pageAnchor(page-1)});}}} className="tocyn-inbox-pagination-button"><ChevronLeft className="tocyn-inbox-pagination-icon" /></ParkButton>
      <ParkButton type="button" aria-label="Next conversation page" aria-disabled={query.isFetching||page>=meta.total_pages} onClick={()=>{manualPageGeneration.current++;setAdvanceRequest(null);onAdvanceNotice('');if(!query.isFetching&&page<meta.total_pages){paging.current=true;workspace.update({listAnchor:pageAnchor(page+1)});}}} className="tocyn-inbox-pagination-button"><ChevronRight className="tocyn-inbox-pagination-icon" /></ParkButton></div></footer>}
  </div>;
}
