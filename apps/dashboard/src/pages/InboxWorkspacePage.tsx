import { useOptionalOperatorPreferencesContext } from '../components/theme/OperatorThemeProvider';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import { ParkButton, ParkCard, ParkEmptyState, ParkInput, ParkMenu, ParkPage, ParkSplitter } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { ChevronDown,ChevronLeft,ChevronRight,Filter,IconChartBar } from '../components/icons';
import React,{useCallback,useLayoutEffect,useEffect,useMemo,useRef,useState} from 'react';
import { Link,useNavigate,useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { SlaQueueNotice } from '../components/SlaQueueNotice';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
import { useInboxGlobalAlert } from '../components/InboxGlobalAlert';
import { useFilters } from '../hooks/useFilters';
import { OperatorWorkspaceProvider,useOperatorDraftIndicators,useOperatorWorkspaceState } from '../hooks/useOperatorWorkspaceState';
import { useSettings } from '../hooks/useSettings';
import { useTicketSlaBatch, type TicketSla } from '../hooks/useTicketSla';
import { useStandardQueueCounts, useTickets, useUpdateTicket } from '../hooks/useTickets';
import type { Ticket } from '@luminatick/shared';
import { ticketReference } from '../utils/ticket-reference';
import { utcTimestamp } from '../utils/utcTimestamp';
import { TicketDetailPage } from './TicketDetailPage';

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
  const page = ParkPage('inbox');
  // A restored preference can be absent while an older fixture is migrating;
  // keep Ark's splitter state numeric so its separator never receives NaN.
  const splitterRatio = Number.isFinite(workspace.splitterRatio)
    ? Math.max(24, Math.min(50, Math.round(workspace.splitterRatio)))
    : 32;

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
    id="inbox-view-unavailable" title="Inbox view unavailable" headingLevel={1}
    description="This saved view is unavailable for the current account."
    action={<ParkButton type="button" onClick={() => navigate('/inbox/all', { replace: true })}>Open All tickets</ParkButton>}
  />;

  return <ParkSplitter.Root className={page.inboxWorkspace} orientation="horizontal"
    size={[splitterRatio, 100 - splitterRatio]} keyboardResizeBy={2}
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
    <ParkSplitter.Panel id="inbox-list" role="region" aria-label="Conversations" className={clsx(page.inboxList,conversationId&&page.inboxMobileHidden)}>
      <ConversationList activeView={activeView} selectedTicketId={conversationId??null} routeReady={routeReady} advanceRef={advance} onAdvanceNotice={setAdvanceNotice} />
    </ParkSplitter.Panel>
    <ParkSplitter.ResizeTrigger id="inbox-list:inbox-detail" aria-label="Resize conversation panes" />
    <ParkSplitter.Panel id="inbox-detail" role="region" aria-label="Active conversation" className={clsx(page.inboxDetail,!conversationId&&page.inboxMobileHidden)}>
      {advanceNotice && <p role="status">{advanceNotice}</p>}
      {conversationId?<TicketDetailPage id={conversationId} workspaceBackHref={`/inbox/${activeView}`} onResolved={onResolved} />:<EmptyConversation />}
    </ParkSplitter.Panel>
  </ParkSplitter.Root>;
}

function EmptyConversation(){return <div><ParkEmptyState title="Choose a conversation" description="The selected view and your place in the list stay here while you read and reply." /></div>;}

function FilterKeyword({ label, options, onSelect }: { label: string; options: readonly string[]; onSelect: (value: string) => void }) {
  return <ParkMenu.Root positioning={{ placement: 'bottom-start' }}><ParkMenu.Trigger asChild><ParkButton type="button" variant="plain" className={css({ display: 'inline-flex', minH: 'auto', borderBottomWidth: '2px', borderStyle: 'dashed', borderColor: 'border.default', px: '0.5', py: '0', fontWeight: 'bold' })}>{label}<ChevronDown aria-hidden="true" /></ParkButton></ParkMenu.Trigger><ParkMenu.Positioner><ParkMenu.Content className={css({ zIndex: 30, minW: '40', rounded: 'md', bg: 'bg.surface', p: '1', boxShadow: 'lg' })}>{options.map(option => <ParkMenu.Item key={option} value={option} onClick={() => onSelect(option)}>{option}</ParkMenu.Item>)}</ParkMenu.Content></ParkMenu.Positioner></ParkMenu.Root>;
}

function ConversationList({activeView,selectedTicketId,routeReady,advanceRef,onAdvanceNotice}:{activeView:string;selectedTicketId:string|null;routeReady:boolean;advanceRef:React.MutableRefObject<((id:string)=>void)|null>;onAdvanceNotice:(message:string)=>void}){
  const navigate=useNavigate();
  const workspace=useOperatorWorkspaceState();
  const {data:filters}=useFilters();
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
  const currentPage=viewChanged?1:pageFromAnchor(workspace.listAnchor);
  const [recoveringView,setRecoveringView]=useState<string|null>(null);
  const [focusedIndex,setFocusedIndex]=useState(0);
  const [filterOpen,setFilterOpen]=useState(false);
  const [semanticFilters,setSemanticFilters]=useState({ owner: 'All tickets', created: 'anytime', customer: 'anyone', sort: workspace.sort });
  const rowRefs=useRef<Array<HTMLAnchorElement|null>>([]);
  const heading=useRef<HTMLHeadingElement>(null);
  const paging=useRef(false);
  const [status,setStatus]=useState('');
  const [expandedTicketId,setExpandedTicketId]=useState<string|null>(null);
  const ticketMutation=useUpdateTicket();
  const applySemanticFilter = (patch: Partial<typeof semanticFilters>) => {
    setSemanticFilters(current => ({ ...current, ...patch }));
    workspace.update({ listAnchor: 'page:1' });
  };
  const createdAfter = useMemo(() => semanticFilters.created === 'anytime' ? undefined
    : new Date(Date.now() - ({ hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, quarter: 7776000000 } as Record<string, number>)[semanticFilters.created]).toISOString(), [semanticFilters.created]);
  const query=useTickets({page:String(currentPage),sort:workspace.sort,...(queue?{queue}:{}),...(filterId?{filter_id:filterId}:{}),...(workspace.listQuery?{search:workspace.listQuery}:{}),...(semanticFilters.customer==='anyone'?{}:{customer_email:semanticFilters.customer}),...(createdAfter?{created_after:createdAfter}:{})});
  const tickets=query.data?.data??[];
  const meta=query.data?.meta??{page:1,limit:20,total:0,total_pages:1};
  const slaSort=workspace.sort==='sla_priority';
  const batchSla=useTicketSlaBatch(tickets.map(ticket=>ticket.id),!slaSort&&routeReady&&!query.isPlaceholderData&&!query.error&&Boolean(query.data));
  const ticketSla=slaSort?{...query,data:Object.fromEntries(Object.entries(query.data?.sla??{}).filter(([,value])=>value!==null))}:batchSla;
  const setGlobalAlert = useInboxGlobalAlert();
  useEffect(() => {
    if (ticketSla.isLoading || ticketSla.isError || query.isPlaceholderData) return;
    const count = tickets.filter(ticket => !ticket.assigned_to && (() => {
      const sla = ticketSla.data?.[ticket.id];
      return sla?.response.state === 'breached' || sla?.resolution.state === 'breached';
    })()).length;
    const scope = activeView === 'all' ? 'this inbox view' : queueViews[activeView as QueueView]?.label ?? 'this saved view';
    setGlobalAlert({ count, scope });
    return () => setGlobalAlert(null);
  }, [activeView, query.isPlaceholderData, setGlobalAlert, ticketSla.data, ticketSla.isError, ticketSla.isLoading, tickets]);
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
    if (!advanceRequest || currentPage !== 1) return;
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
  }, [advanceRequest, advanceScope, activeView, identity, navigate, onAdvanceNotice, currentPage, query.refetch]);


  const outOfRange=Boolean(query.data&&!query.isFetching&&!query.isPlaceholderData&&!query.error
    &&meta.page===currentPage&&currentPage>1&&tickets.length===0&&meta.total>0);
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
    if(!query.isFetching&&(query.error||!query.isPlaceholderData&&meta.page===1&&currentPage===1)){
      setRecoveringView(null);
      if(!query.error)setStatus('Showing the first page after the conversation list changed.');
    }
  },[activeView,meta.page,currentPage,query.error,query.isFetching,query.isPlaceholderData,recoveringView]);
  useEffect(()=>{
    if(!query.isFetching&&paging.current){paging.current=false;if(!query.error||slaSort)heading.current?.focus();}
  },[query.error,query.isFetching,slaSort]);
  useEffect(()=>{
    const selected=tickets.findIndex(ticket=>ticket.id===selectedTicketId);
    setFocusedIndex(current=>selected>=0?selected:current>=tickets.length?Math.max(0,tickets.length-1):current);
  },[selectedTicketId,tickets]);

  const pageStyles = ParkPage('inbox');
  const moveFocus=(index:number)=>{const next=Math.max(0,Math.min(tickets.length-1,index));setFocusedIndex(next);rowRefs.current[next]?.focus();};

  return <div className={[pageStyles.root, pageStyles.content, pageStyles.inboxList].join(' ')}>
    <header className={css({ flexShrink: 0, borderBottom: '1px solid', borderColor: 'border.default', bg: 'bg.surface' })}>
      <h1 ref={heading} tabIndex={-1} className={pageStyles.inboxHiddenHeading}>Support Inbox</h1>
      <div className={css({ display: 'flex', minH: '14', alignItems: 'center', justifyContent: 'space-between', gap: '2', px: '4' })}>
        <ParkMenu.Root positioning={{ placement: 'bottom-start' }}><ParkMenu.Trigger asChild><ParkButton type="button" variant="plain" className={css({ gap: '1', fontWeight: 'bold' })}>{activeView==='actionable'?'Needs Attention':workspace.sort==='priority_desc'?'Highest Impact':workspace.sort==='sla_priority'?'Contract SLAs':'All tickets'}<ChevronDown aria-hidden="true" /></ParkButton></ParkMenu.Trigger><ParkMenu.Positioner><ParkMenu.Content aria-label="Inbox view" className={css({ zIndex: 20, minW: '56', rounded: 'md', bg: 'bg.surface', p: '1', boxShadow: 'lg' })}>
          <ParkMenu.Item value="attention" onClick={()=>navigate('/inbox/actionable')}>Needs Attention <span aria-hidden="true">[T→C→S]</span></ParkMenu.Item>
          <ParkMenu.Item value="impact" onClick={()=>{workspace.update({sort:'priority_desc',listAnchor:'page:1'});navigate('/inbox/all');}}>Highest Impact <span aria-hidden="true">[C→T]</span></ParkMenu.Item>
          <ParkMenu.Item value="sla" onClick={()=>{workspace.update({sort:'sla_priority',listAnchor:'page:1'});navigate('/inbox/all');}}>Contract SLAs <span aria-hidden="true">[S→C→T]</span></ParkMenu.Item>
          {filters?.length ? <><ParkMenu.Separator /><p className={css({ px: '2', py: '1', color: 'text.muted', fontSize: 'xs', fontWeight: 'bold' })}>Quick views</p>{filters.map(filter=><ParkMenu.Item key={filter.id} value={`saved-${filter.id}`} onClick={()=>navigate(`/inbox/${filter.id}`)}>{filter.name}</ParkMenu.Item>)}</> : null}
        </ParkMenu.Content></ParkMenu.Positioner></ParkMenu.Root>
        <div className={css({ display: 'flex', gap: '1' })}>
          <ParkMenu.Root positioning={{ placement: 'bottom-end' }}><ParkMenu.Trigger asChild><ParkButton type="button" variant="plain" aria-label="Quick statistics"><IconChartBar aria-hidden="true" /></ParkButton></ParkMenu.Trigger><ParkMenu.Positioner><ParkMenu.Content aria-label="Quick statistics" className={css({ zIndex: 20, minW: '64', rounded: 'md', bg: 'bg.surface', p: '3', boxShadow: 'lg' })}><p>All tickets: {queueCounts.data?.all ?? '—'}</p><p>Needs action: {queueCounts.data?.actionable ?? '—'}</p><p>Unassigned: {queueCounts.data?.unassigned ?? '—'}</p></ParkMenu.Content></ParkMenu.Positioner></ParkMenu.Root>
          <ParkButton type="button" variant="plain" aria-expanded={filterOpen} aria-controls="inbox-natural-filter" onClick={()=>setFilterOpen(open=>!open)}><Filter aria-hidden="true" /></ParkButton>
        </div>
      </div>
      {filterOpen && <div id="inbox-natural-filter" className={css({ borderTop: '1px solid', borderColor: 'border.default', bg: 'bg.subtle', p: '4' })}>
        <p className={css({ color: 'text.muted', lineHeight: 'tall' })}>Showing <FilterKeyword label={semanticFilters.owner} options={['All tickets','My tickets','Unassigned']} onSelect={owner=>{applySemanticFilter({owner});navigate(owner==='My tickets'?'/inbox/mine':owner==='Unassigned'?'/inbox/unassigned':'/inbox/all');}} />, created <FilterKeyword label={semanticFilters.created} options={['hour','day','week','month','quarter','anytime']} onSelect={created=>applySemanticFilter({created})} />, for <FilterKeyword label={semanticFilters.customer} options={['anyone',...Array.from(new Set(tickets.map(ticket=>ticket.customer_email))).slice(0,6)]} onSelect={customer=>applySemanticFilter({customer})} />, sorted by <FilterKeyword label={semanticFilters.sort==='created_desc'?'newest first':semanticFilters.sort==='created_asc'?'oldest first':'ticket number'} options={['ticket number','newest first','oldest first']} onSelect={sort=>{const next=sort==='newest first'?'created_desc':sort==='oldest first'?'created_asc':'updated_desc';workspace.update({sort:next,listAnchor:'page:1'});setSemanticFilters(current=>({...current,sort:next}));}} />.</p>
        <div className={css({ mt: '3', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2', borderTopWidth: '1px', borderColor: 'border.default', pt: '3' })}><ParkInput aria-label="Filter by exact customer email" placeholder="customer@example.test" value={semanticFilters.customer==='anyone'?'':semanticFilters.customer} onChange={event=>applySemanticFilter({customer:event.target.value.trim()||'anyone'})} className={css({ maxW: '64' })} /><div className={css({ display: 'flex', gap: '1' })}><ParkButton type="button" variant="plain" onClick={()=>{setSemanticFilters({owner:'All tickets',created:'anytime',customer:'anyone',sort:'updated_desc'});workspace.update({sort:'updated_desc',listAnchor:'page:1'});navigate('/inbox/all');}}>Clear all</ParkButton><ParkButton type="button" variant="plain" onClick={()=>setFilterOpen(false)}>Filter</ParkButton></div></div>
      </div>}
      {(recoveringPage||query.isPlaceholderData||workspace.status==='saving'||status) && <p role="status" aria-label="Inbox status" className={css({ px: '4', pb: '2', color: 'text.muted', fontSize: 'xs' })}>{recoveringPage?'Loading the first page after the conversation list changed…':query.isPlaceholderData?'Refreshing…':workspace.status==='saving'?'Saving view…':status}</p>}
    </header>
    {slaSort&&<SlaQueueNotice asOf={query.data?.asOf} error={query.error} busy={query.isFetching} restart={restartSla} />}
    {query.error&&<div role="alert"><p>{tickets.length?'Could not refresh conversations. The last confirmed list remains visible.':'Could not load conversations.'}</p>
      <ParkButton type="button" disabled={query.isFetching} onClick={()=>slaSort?restartSla():void query.refetch()}>Retry conversations</ParkButton></div>}
    {workspace.status==='error'||workspace.status==='conflict'?<div role="alert">{workspace.error}
      <ParkButton type="button" onClick={workspace.status==='conflict'?workspace.restoreServerState:workspace.retrySave}>{workspace.status==='conflict'?'Restore saved view':'Retry saving view'}</ParkButton></div>:null}
    {drafts.status==='partial'&&<p role="status">Some draft indicators are still loading.</p>}
    <div role="listbox" aria-label="Conversation list" aria-activedescendant={tickets[focusedIndex]?`conversation-${tickets[focusedIndex].id}`:undefined} className={css({ flex: '1', overflowY: 'auto', bg: 'bg.subtle', p: '3', display: 'flex', flexDirection: 'column', gap: '3' })}>
      {query.isLoading?<p role="status">Loading conversations…</p>:emptyPage?<ParkEmptyState title={emptyMessage} description={queue?queueViews[queue].description:'Choose another queue or saved view.'} />:tickets.map((ticket,index)=><InboxConversationCard
        key={ticket.id} ticket={ticket} reference={ticketReference(ticket,prefix)} index={index} activeView={activeView}
        selected={ticket.id===selectedTicketId} focused={index===focusedIndex} expanded={expandedTicketId===ticket.id}
        sla={ticketSla.isError||query.isPlaceholderData?undefined:ticketSla.data?.[ticket.id] ?? undefined} slaLoading={ticketSla.isLoading}
        hasDraft={drafts.ticketIds.has(ticket.id)} queueLabel={queue&&!query.isPlaceholderData?queueViews[queue].label:undefined}
        rowRefs={rowRefs}
        onFocus={()=>setFocusedIndex(index)} onMoveFocus={moveFocus} onExpanded={setExpandedTicketId}
        onOpen={()=>{if(!workspace.hasUnsavedChanges)workspace.update({selectedTicketId:ticket.id});}}
        onResolve={()=>ticketMutation.mutate({id:ticket.id,status:'resolved'},{onSuccess:()=>{setStatus(`Resolved ${ticketReference(ticket,prefix)}.`);if(ticket.id===selectedTicketId)advanceRef.current?.(ticket.id);}})}
        onUrgent={()=>ticketMutation.mutate({id:ticket.id,priority:'urgent'},{onSuccess:()=>setStatus(`Marked ${ticketReference(ticket,prefix)} urgent.`)})}
      />)}
    </div>
    {meta.total_pages>1&&<footer className={pageStyles.inboxPagination}><span role="status">Page {meta.page} of {meta.total_pages}</span><div>
      <ParkButton type="button" aria-label="Previous conversation page" aria-disabled={query.isFetching||currentPage<=1} onClick={()=>{manualPageGeneration.current++;setAdvanceRequest(null);onAdvanceNotice('');if(!query.isFetching&&currentPage>1){paging.current=true;workspace.update({listAnchor:pageAnchor(currentPage-1)});}}}><ChevronLeft /></ParkButton>
      <ParkButton type="button" aria-label="Next conversation page" aria-disabled={query.isFetching||currentPage>=meta.total_pages} onClick={()=>{manualPageGeneration.current++;setAdvanceRequest(null);onAdvanceNotice('');if(!query.isFetching&&currentPage<meta.total_pages){paging.current=true;workspace.update({listAnchor:pageAnchor(currentPage+1)});}}}><ChevronRight /></ParkButton></div></footer>}
  </div>;
}

function InboxConversationCard({ ticket, reference, index, activeView, selected, focused, expanded, sla, slaLoading, hasDraft, queueLabel, rowRefs, onFocus, onMoveFocus, onExpanded, onOpen, onResolve, onUrgent }: {
  ticket: Ticket;
  reference: string;
  index: number;
  activeView: string;
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  sla: TicketSla | undefined;
  slaLoading: boolean;
  hasDraft: boolean;
  queueLabel: string | undefined;
  rowRefs: React.MutableRefObject<Array<HTMLAnchorElement | null>>;
  onFocus: () => void;
  onMoveFocus: (index: number) => void;
  onExpanded: (id: string | null) => void;
  onOpen: () => void;
  onResolve: () => void;
  onUrgent: () => void;
}) {
  const [dragX, setDragX] = useState(0);
  const pointerStart = useRef<number | null>(null);
  const didSwipe = useRef(false);
  const breached = sla?.response.state === 'breached' || sla?.resolution.state === 'breached';
  const pills = [
    !ticket.assigned_to ? 'Unassigned' : undefined,
    breached ? 'Overdue' : undefined,
    ticket.status === 'pending' ? 'In progress' : undefined,
    ticket.priority === 'urgent' ? 'Urgent' : undefined,
    hasDraft ? 'Draft' : undefined,
  ].filter((pill): pill is string => Boolean(pill));
  const pillClass = (pill: string) => css({ w: '22', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', rounded: 'sm', bg: pill === 'Overdue' || pill === 'Urgent' ? 'critical' : pill === 'In progress' ? 'info' : 'bg.muted', color: pill === 'Overdue' || pill === 'Urgent' || pill === 'In progress' ? 'white' : 'text.default', px: '1', py: '0.5', textAlign: 'center', fontSize: '2xs', fontWeight: 'bold', textTransform: 'uppercase' });
  const finishSwipe = () => {
    if (dragX >= 88) { didSwipe.current = true; onResolve(); }
    if (dragX <= -88) { didSwipe.current = true; onUrgent(); }
    pointerStart.current = null;
    setDragX(0);
  };
  return <article role="option" aria-selected={selected} data-selected={selected ? 'true' : undefined} className={css({ position: 'relative', overflow: 'hidden', rounded: 'md', bg: 'critical' })}
    onMouseEnter={() => onExpanded(ticket.id)} onMouseLeave={() => onExpanded(null)}>
    <div aria-hidden="true" className={css({ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bg: 'critical', px: '4', color: 'white', fontSize: 'sm', fontWeight: 'bold' })}><span>Resolve</span><span>Mark urgent</span></div>
    <ParkCard.Root variant="outline" style={{ transform: `translateX(${dragX}px)` }} onPointerDown={event => { pointerStart.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (pointerStart.current !== null) setDragX(Math.max(-112, Math.min(112, event.clientX - pointerStart.current))); }} onPointerUp={finishSwipe} onPointerCancel={() => { pointerStart.current = null; setDragX(0); }} className={css({ position: 'relative', touchAction: 'pan-y', transition: 'transform 0.2s, box-shadow 0.2s', _hover: { bg: 'bg.hover', boxShadow: 'md' }, ...(selected ? { borderColor: 'border.focus' } : {}) })}>
      <ParkCard.Body className={css({ display: 'grid', gridTemplateColumns: '3.5rem minmax(0, 1fr) 5.5rem', gap: '3', p: '3', alignItems: 'start' })}>
        <div className={css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3' })}>
          <InboxSlaRing sla={sla} loading={slaLoading} priority={ticket.priority} />
          {expanded && <div className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>{pills.map(pill => <span key={pill} className={pillClass(pill)}>{pill}</span>)}</div>}
        </div>
        <Link ref={node => { rowRefs.current[index] = node; }} id={`conversation-${ticket.id}`} tabIndex={focused ? 0 : -1}
          to={`/inbox/${activeView}/${ticket.id}`} onClick={event => { if (didSwipe.current) { event.preventDefault(); didSwipe.current = false; return; } onOpen(); }} onFocus={() => { onFocus(); onExpanded(ticket.id); }}
          onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); onMoveFocus(index + 1); } else if (event.key === 'ArrowUp') { event.preventDefault(); onMoveFocus(index - 1); } else if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); onResolve(); } else if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); onUrgent(); } }}
          className={css({ minW: 0, color: 'inherit', textDecoration: 'none', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' } })}>
          <div className={css({ display: 'flex', alignItems: 'baseline', gap: '2' })}><span className={css({ flexShrink: 0, fontSize: 'xs', fontWeight: 'bold' })}>{reference}</span><ParkCard.Title className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'sm', fontWeight: 'normal' })}>{ticket.subject}</ParkCard.Title></div>
          <div className={css({ mt: '1', display: 'flex', minW: 0, gap: '2', color: 'text.muted', fontSize: 'xs' })}><span className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{ticket.customer_email}</span><span aria-hidden="true">•</span><time dateTime={ticket.updated_at}>{utcTimestamp(ticket.updated_at).toLocaleDateString()}</time></div>
          {expanded && <p className={css({ mt: '3', color: 'text.muted', fontSize: 'sm', lineClamp: 5 })}>{ticket.snippet || 'No conversation preview is available.'}</p>}
        </Link>
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '1', pt: '0.5' })}>{pills.map(pill => <span key={pill} className={pillClass(pill)}>{pill}</span>)}{queueLabel && <span className={css({ w: '22', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', rounded: 'sm', borderWidth: '1px', borderColor: 'border.default', px: '1', py: '0.5', textAlign: 'center', fontSize: '2xs', fontWeight: 'bold', textTransform: 'uppercase' })}>{queueLabel}</span>}</div>
      </ParkCard.Body>
    </ParkCard.Root>
  </article>;
}

function InboxSlaRing({ sla, loading, priority }: { sla: TicketSla | undefined; loading: boolean; priority: Ticket['priority'] }) {
  const target = sla?.response.state !== 'unavailable' ? sla?.response : sla?.resolution;
  const elapsed = target?.remainingWorkingMilliseconds !== null && target?.remainingWorkingMilliseconds !== undefined && target.targetWorkingMilliseconds
    ? Math.max(0, Math.min(1, 1 - target.remainingWorkingMilliseconds / target.targetWorkingMilliseconds)) : 0;
  const breached = target?.state === 'breached';
  const circumference = 2 * Math.PI * 15;
  const label = loading ? 'Loading service level' : !target || target.state === 'unavailable' ? 'Service level unavailable' : `${target.state === 'breached' ? 'Breached' : 'On-track'} service level`;
  return <span aria-label={label}
    className={css({ position: 'relative', display: 'inline-grid', h: '10', w: '10', placeItems: 'center', fontSize: '2xs', fontWeight: 'bold', color: breached ? 'critical' : 'text.default' })}>
    <svg aria-hidden="true" viewBox="0 0 36 36" className={css({ position: 'absolute', inset: 0, h: 'full', w: 'full', transform: 'rotate(-90deg)' })}>
      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.18" />
      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${circumference}`} strokeDashoffset={`${circumference * (1 - (breached ? 1 : elapsed))}`} />
    </svg>
    <span>{loading ? '…' : priority.slice(0, 1).toUpperCase()}</span>
  </span>;
}
