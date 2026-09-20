import { useOptionalOperatorPreferencesContext } from '../components/theme/OperatorThemeProvider';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import { ParkAlert, ParkButton, ParkCard, ParkEmptyState, ParkInput, ParkMenu, ParkPage, ParkSkeleton, ParkSplitter, ParkTable, ParkVisuallyHidden } from '@luminatick/ui/park';
import { Collapsible as ParkCollapsible, Link as ParkLink } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import { ChevronDown,ChevronLeft,ChevronRight,Filter,IconChartBar,IconCircleExclamation,IconClock,IconFilter,IconShieldHalved,IconTicket,Plus } from '../components/icons';
import React,{useCallback,useLayoutEffect,useEffect,useMemo,useRef,useState} from 'react';
import { Link,useNavigate,useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { SlaQueueNotice } from '../components/SlaQueueNotice';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
import { useInboxGlobalAlert } from '../components/InboxGlobalAlert';
import { useCreateFilter,useFilters } from '../hooks/useFilters';
import { OperatorWorkspaceProvider,useOperatorDraftIndicators,useOperatorWorkspaceState,type WorkspacePreference } from '../hooks/useOperatorWorkspaceState';
import { useSettings } from '../hooks/useSettings';
import { useTicketSlaBatch, type TicketSla } from '../hooks/useTicketSla';
import { useStandardQueueCounts, useTickets, useUpdateTicket } from '../hooks/useTickets';
import type { TicketQueryPage } from '../hooks/useSlaPriorityTickets';
import type { Ticket } from '@luminatick/shared';
import { ticketReference } from '../utils/ticket-reference';
import { utcTimestamp } from '../utils/utcTimestamp';
import { TicketDetailPage } from './TicketDetailPage';
import { NewTicketDialog } from './NewTicketDialog';

const queueViews={mentions:{label:'Mentions',description:'Actionable conversations with a mention for you that has not been dismissed.'},mine:{label:'Mine',description:'Open and pending conversations assigned to you and ready for work.'},unassigned:{label:'Unassigned',description:'Open and pending conversations without an assignee and ready for work.'},drafts:{label:'Drafts',description:'Conversations with your saved drafts.'},actionable:{label:'Needs Action',description:'Open and pending conversations ready for work.'},snoozed:{label:'Snoozed',description:'Conversations paused until their authoritative resurface time.'}} as const;
const queueOrder=['mentions','mine','unassigned','drafts','actionable','snoozed'] as const;
type NaturalFilters={owner:'All tickets'|'My tickets'|'Unassigned';created:'hour'|'day'|'week'|'month'|'quarter'|'anytime';customer:string;sort:WorkspacePreference['sort'];search:string};
const defaultNaturalFilters:NaturalFilters={owner:'All tickets',created:'anytime',customer:'anyone',sort:'updated_desc',search:''};
function ownerForView(view:string):NaturalFilters['owner']{return view==='mine'?'My tickets':view==='unassigned'?'Unassigned':'All tickets';}
const naturalSortOptions:Readonly<Record<NaturalFilters['sort'],string>>={updated_desc:'recently updated',updated_asc:'least recently updated',created_desc:'newest first',created_asc:'oldest first',priority_desc:'highest impact',priority_asc:'lowest impact',sla_priority:'contract SLA'};
function naturalSortLabel(sort:NaturalFilters['sort']){return naturalSortOptions[sort];}
function createdAfterFor(period:NaturalFilters['created']):string|undefined{
  if(period==='anytime')return undefined;
  const now=Date.now();
  if(period==='hour'||period==='day'||period==='week'){
    const duration={hour:3600000,day:86400000,week:604800000}[period];
    return new Date(now-duration).toISOString();
  }
  // A rolling calendar month must not turn February into an arbitrary 30-day period.
  const cutoff=new Date(now);
  const day=cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth()-(period==='quarter'?3:1));
  const lastDay=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day,lastDay));
  return cutoff.toISOString();
}
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

function EmptyConversation(){return <div className={css({ display: 'grid', minH: 'full', placeItems: 'center', p: '6' })}><div className={css({ w: 'full', maxW: 'lg' })}><ParkEmptyState title="Choose a conversation" description="The selected view and your place in the list stay here while you read and reply." /></div></div>;}

function FilterKeyword({ label, name, options, onSelect }: { label: string; name:string; options: readonly string[]; onSelect: (value: string) => void }) {
  return <ParkMenu.Root positioning={{ placement: 'bottom-start' }}><ParkMenu.Trigger asChild><ParkButton type="button" variant="plain" aria-label={`${name}: ${label}`} className={css({ display: 'inline-flex', minH: '10', borderBottomWidth: '2px', borderStyle: 'dashed', borderColor: 'border.default', px: '1', fontWeight: 'semibold' })}>{label}<ChevronDown aria-hidden="true" /></ParkButton></ParkMenu.Trigger><ParkMenu.Positioner><ParkMenu.Content aria-label={`${name} choices`} className={css({ zIndex: 30, minW: '40' })}>{options.map(option => <ParkMenu.Item key={option} value={option} onClick={() => onSelect(option)}>{option}</ParkMenu.Item>)}</ParkMenu.Content></ParkMenu.Positioner></ParkMenu.Root>;
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
  const [statsOpen,setStatsOpen]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [createMounted,setCreateMounted]=useState(false);
  const createTrigger=useRef<HTMLButtonElement>(null);
  const filterTrigger=useRef<HTMLButtonElement>(null);
  const statsTrigger=useRef<HTMLButtonElement>(null);
  const [presentation,setPresentation]=useState<'list'|'table'>('list');
  const [semanticFilters,setSemanticFilters]=useState<NaturalFilters>({...defaultNaturalFilters,owner:ownerForView(activeView),sort:workspace.sort,search:workspace.listQuery});
  const [draftFilters,setDraftFilters]=useState<NaturalFilters>(semanticFilters);
  const [quickViewName,setQuickViewName]=useState('');
  const [namingQuickView,setNamingQuickView]=useState(false);
  const [quickViewError,setQuickViewError]=useState('');
  const createFilter=useCreateFilter();
  const semanticRoute=useRef(activeView);
  const preserveNextFilterRoute=useRef<string|null>(null);
  const rowRefs=useRef<Array<HTMLElement|null>>([]);
  const heading=useRef<HTMLHeadingElement>(null);
  const retryButton=useRef<HTMLButtonElement>(null);
  const paging=useRef(false);
  const [status,setStatus]=useState('');
  const [expandedTicketId,setExpandedTicketId]=useState<string|null>(null);
  const ticketMutation=useUpdateTicket();
  useEffect(()=>{
    if(!filterOpen){
      const routeChanged=semanticRoute.current!==activeView;
      const preserve=routeChanged&&preserveNextFilterRoute.current===activeView;
      semanticRoute.current=activeView;
      if(routeChanged)preserveNextFilterRoute.current=null;
      setSemanticFilters(current=>({...(routeChanged&&!preserve?defaultNaturalFilters:current),owner:ownerForView(activeView),sort:workspace.sort,search:workspace.listQuery}));
    }
  },[activeView,filterOpen,workspace.listQuery,workspace.sort]);
  const openFilter=()=>{
    if(!filterOpen){setDraftFilters({...semanticFilters,owner:ownerForView(activeView),sort:workspace.sort,search:workspace.listQuery});setStatsOpen(false);}
    setNamingQuickView(false);setQuickViewError('');setFilterOpen(open=>!open);
  };
  const applyFilters=(next:NaturalFilters)=>{
    setSemanticFilters(next);
    workspace.update({sort:next.sort,listQuery:next.search.trim(),listAnchor:'page:1'});
    const target=next.owner==='My tickets'?'mine':next.owner==='Unassigned'?'unassigned':'all';
    if(activeView!==target){preserveNextFilterRoute.current=target;navigate(`/inbox/${target}`);}
    setFilterOpen(false);setNamingQuickView(false);setStatus('Ticket filters applied.');
  };
  const clearFilters=()=>{
    setDraftFilters(defaultNaturalFilters);applyFilters(defaultNaturalFilters);
    setQuickViewError('');setStatus('Ticket filters cleared.');
  };
  const quickViewRepresentable=activeView==='all'&&draftFilters.owner==='All tickets'&&draftFilters.created==='anytime'&&draftFilters.sort==='updated_desc'&&!draftFilters.search.trim();
  const saveQuickView=async()=>{
    const name=quickViewName.trim();
    if(!name){setQuickViewError('Enter a name for this quick view.');return;}
    if(!quickViewRepresentable){setQuickViewError('This combination cannot be saved as a quick view yet. Apply it to use it now.');return;}
    try{
      const saved=await createFilter.mutateAsync({name,conditions:draftFilters.customer==='anyone'?[]:[{field:'customer_email',operator:'equals',value:draftFilters.customer}]});
      setSemanticFilters(defaultNaturalFilters);setDraftFilters(defaultNaturalFilters);setFilterOpen(false);setNamingQuickView(false);setQuickViewError('');
      workspace.update({sort:'updated_desc',listQuery:'',listAnchor:'page:1'});navigate(`/inbox/${saved.id}`);
      setStatus(`Quick view ${saved.name} saved.`);
    }catch{setQuickViewError('Could not save the quick view. Your filter choices are still here; try again.');}
  };
  const createdAfter = useMemo(() => createdAfterFor(semanticFilters.created), [semanticFilters.created]);
  const identity = assignmentIdentity();
  const listScope = JSON.stringify([identity,activeView,queue,filterId,workspace.listQuery,workspace.sort,semanticFilters.customer,createdAfter]);
  const query=useTickets({page:String(currentPage),sort:workspace.sort,...(queue?{queue}:{}),...(filterId?{filter_id:filterId}:{}),...(workspace.listQuery?{search:workspace.listQuery}:{}),...(semanticFilters.customer==='anyone'||filterId?{}:{customer_email:semanticFilters.customer}),...(createdAfter?{created_after:createdAfter}:{})});
  // A failed page read must not turn a confirmed list into an apparent empty queue.
  // Scope the fallback by authenticated operator and every list filter so a change
  // of tenant or view can never display rows from the previous identity/view.
  const confirmedPage=useRef<{scope:string;data:TicketQueryPage}|null>(null);
  if(query.data&&!query.error&&!query.isPlaceholderData)confirmedPage.current={scope:listScope,data:query.data};
  // SLA ordering is a whole-view snapshot; an expired snapshot must be restarted
  // and must never borrow rows from the previous snapshot.
  const displayPage=query.data??(workspace.sort!=='sla_priority'&&query.error&&confirmedPage.current?.scope===listScope?confirmedPage.current.data:undefined);
  const tickets=displayPage?.data??[];
  const meta=displayPage?.meta??{page:1,limit:20,total:0,total_pages:1};
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
    if(!query.isFetching&&paging.current){paging.current=false;if(query.error&&!slaSort)retryButton.current?.focus();else heading.current?.focus();}
  },[query.error,query.isFetching,slaSort]);
  useEffect(()=>{
    const selected=tickets.findIndex(ticket=>ticket.id===selectedTicketId);
    setFocusedIndex(current=>selected>=0?selected:current>=tickets.length?Math.max(0,tickets.length-1):current);
  },[selectedTicketId,tickets]);

  const pageStyles = ParkPage('inbox');
  const moveFocus=(index:number)=>{const next=Math.max(0,Math.min(tickets.length-1,index));setFocusedIndex(next);rowRefs.current[next]?.focus();};
  const changeView=(id:string,sort?:WorkspacePreference['sort'],preserveFilters=false)=>{
    setFilterOpen(false);setStatsOpen(false);setNamingQuickView(false);
    setSemanticFilters(current=>({...(preserveFilters?current:defaultNaturalFilters),owner:ownerForView(id),sort:sort??workspace.sort,search:workspace.listQuery}));
    if(preserveFilters&&activeView!==id)preserveNextFilterRoute.current=id;
    workspace.update({...(sort?{sort}:{}),listAnchor:'page:1'});
    navigate(`/inbox/${id}`);
  };
  const selectedViewLabel=activeView==='actionable'?'Needs Attention':activeView==='all'
    ? workspace.sort==='priority_desc'?'Highest Impact':workspace.sort==='sla_priority'?'Contract SLAs':'All tickets'
    : queue?queueViews[queue].label:filters?.find(filter=>filter.id===activeView)?.name??'Saved view';
  const pageOpen=tickets.filter(ticket=>ticket.status==='open'||ticket.status==='pending').length;
  const pageOverdue=tickets.filter(ticket=>{
    const sla=ticketSla.data?.[ticket.id];return sla?.response.state==='breached'||sla?.resolution.state==='breached';
  }).length;
  const pageClosed=tickets.filter(ticket=>ticket.status==='resolved'||ticket.status==='closed').length;
  const priorityCounts=(['urgent','high','normal','low'] as const).map(priority=>({priority,count:tickets.filter(ticket=>ticket.priority===priority).length}));
  const CurrentViewIcon=selectedViewLabel==='Highest Impact'?IconCircleExclamation:selectedViewLabel==='Contract SLAs'?IconShieldHalved:selectedViewLabel==='Needs Attention'?IconClock:selectedViewLabel==='All tickets'?IconTicket:IconFilter;
  const hasConfirmedPage=Boolean(displayPage)&&!query.isLoading&&!query.isPlaceholderData;
  const hasCompleteSla=hasConfirmedPage&&!ticketSla.isLoading&&!ticketSla.isError&&tickets.every(ticket=>Boolean(ticketSla.data?.[ticket.id]));
  const metricScope=query.error&&hasConfirmedPage?'last confirmed page':'current page';
  const pageMetrics=[
    {label:'Open / pending',count:pageOpen,known:hasConfirmedPage},
    {label:'Overdue',count:pageOverdue,known:hasCompleteSla},
    {label:'Resolved / closed',count:pageClosed,known:hasConfirmedPage},
  ];

  return <div className={[pageStyles.root, pageStyles.content, pageStyles.inboxList].join(' ')}>
    <header className={css({ flexShrink: 0, borderBottom: '1px solid', borderColor: 'border.default', bg: 'bg.surface' })}>
      <h1 ref={heading} tabIndex={-1} className={pageStyles.inboxHiddenHeading}>Support Inbox</h1>
      <div data-part="inbox-primary-toolbar" className={css({ display: 'flex', minH: '14', alignItems: 'center', justifyContent: 'space-between', gap: '2', px: '4' })}>
        <ParkMenu.Root positioning={{ placement: 'bottom-start' }}><ParkMenu.Trigger asChild><ParkButton type="button" variant="plain" aria-label="Inbox views" className={css({ gap: '1', fontWeight: 'semibold', minW: 0, maxW: 'full', flex: '1 1 auto', justifyContent: 'flex-start', px: '1' })}><CurrentViewIcon aria-hidden="true" className={css({ display: { base: 'none', '2xl': 'block' } })} /><span className={css({ minW: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{selectedViewLabel}</span><ChevronDown aria-hidden="true" className={css({ flexShrink: 0 })} /></ParkButton></ParkMenu.Trigger><ParkMenu.Positioner><ParkMenu.Content aria-label="Inbox views" className={css({ zIndex: 20, minW: '56', maxH: '80', overflowY: 'auto' })}>
          <ParkMenu.Item value="attention" onClick={()=>changeView('actionable','updated_desc',true)}><IconClock aria-hidden="true" />Needs Attention</ParkMenu.Item>
          <ParkMenu.Item value="impact" onClick={()=>changeView('all','priority_desc',true)}><IconCircleExclamation aria-hidden="true" />Highest Impact</ParkMenu.Item>
          <ParkMenu.Item value="sla" onClick={()=>changeView('all','sla_priority',true)}><IconShieldHalved aria-hidden="true" />Contract SLAs</ParkMenu.Item>
          <ParkMenu.Separator />
          <ParkMenu.Item value="all" onClick={()=>changeView('all')}>All tickets</ParkMenu.Item>
          {queueOrder.filter(id=>id!=='actionable').map(id=><ParkMenu.Item key={id} value={id} onClick={()=>changeView(id)}>{queueViews[id].label}{queueCounts.data?.[id]!==undefined&&<span aria-hidden="true" className={css({ ml: 'auto', color: 'fg.muted', fontSize: 'xs' })}>{queueCounts.data[id]}</span>}</ParkMenu.Item>)}
          {filters?.length ? <><ParkMenu.Separator />{filters.map(filter=><ParkMenu.Item key={filter.id} value={`saved-${filter.id}`} onClick={()=>changeView(filter.id)}>{filter.name}</ParkMenu.Item>)}</> : null}
          <ParkMenu.Separator />
          <ParkMenu.Item value="list-presentation" onClick={()=>setPresentation('list')}>List view</ParkMenu.Item>
          <ParkMenu.Item value="table-presentation" onClick={()=>setPresentation('table')}>Table view</ParkMenu.Item>
        </ParkMenu.Content></ParkMenu.Positioner></ParkMenu.Root>
        <div className={css({ display: 'flex', flexShrink: 0, gap: '1' })}>
          <ParkButton ref={statsTrigger} type="button" variant="plain" aria-label="Quick statistics" aria-expanded={statsOpen} aria-controls="inbox-quick-statistics" className={css({ w: '10', minW: '10', px: '0', flexShrink: 0 })} onClick={()=>{setStatsOpen(open=>!open);setFilterOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'&&statsOpen){event.stopPropagation();setStatsOpen(false);}}}><IconChartBar aria-hidden="true" /></ParkButton>
          <ParkButton ref={filterTrigger} type="button" variant="plain" aria-label="Filter tickets" aria-expanded={filterOpen} aria-controls="inbox-natural-filter" className={css({ w: '10', minW: '10', px: '0', flexShrink: 0 })} onClick={openFilter} onKeyDown={event=>{if(event.key==='Escape'&&filterOpen){event.stopPropagation();setFilterOpen(false);setNamingQuickView(false);}}}><Filter aria-hidden="true" /></ParkButton>
          <ParkButton ref={createTrigger} type="button" variant="plain" aria-label="New Ticket" title="New Ticket" className={css({ minW: '10', px: { base: '0', xl: '2' }, gap: '1', flexShrink: 0, whiteSpace: 'nowrap' })} onClick={()=>{setCreateMounted(true);setCreateOpen(true);}}><Plus aria-hidden="true" /><span data-part="new-ticket-label" className={css({ display: { base: 'none', xl: 'inline' } })}>New Ticket</span></ParkButton>
        </div>
      </div>
      {filterOpen && <section id="inbox-natural-filter" role="region" aria-label="Ticket filters" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();filterTrigger.current?.focus();setFilterOpen(false);setNamingQuickView(false);}}} className={css({ borderTop: '1px solid', borderColor: 'border.default', bg: 'bg.subtle', p: '4' })}>
        <div className={css({ color: 'fg.muted', lineHeight: 'relaxed' })}>Showing <FilterKeyword name="Ticket owner" label={draftFilters.owner} options={['All tickets','My tickets','Unassigned']} onSelect={owner=>setDraftFilters(current=>({...current,owner:owner as NaturalFilters['owner']}))} />, created <FilterKeyword name="Created" label={draftFilters.created} options={['hour','day','week','month','quarter','anytime']} onSelect={created=>setDraftFilters(current=>({...current,created:created as NaturalFilters['created']}))} />, for <FilterKeyword name="Customer" label={draftFilters.customer} options={['anyone',...Array.from(new Set(tickets.map(ticket=>ticket.customer_email))).slice(0,6)]} onSelect={customer=>setDraftFilters(current=>({...current,customer}))} />, sorted by <FilterKeyword name="Sort" label={naturalSortLabel(draftFilters.sort)} options={Object.values(naturalSortOptions)} onSelect={sort=>{const next=(Object.keys(naturalSortOptions) as NaturalFilters['sort'][]).find(key=>naturalSortOptions[key]===sort)??'updated_desc';setDraftFilters(current=>({...current,sort:next}));}} />.</div>
        <ParkCollapsible.Root defaultOpen={draftFilters.customer!=='anyone'||Boolean(draftFilters.search.trim())} className={css({ mt: '2' })}>
          <ParkCollapsible.Trigger asChild><ParkButton type="button" variant="plain" className={css({ minH: '10', gap: '1' })}>
            More filters{draftFilters.customer!=='anyone'||draftFilters.search.trim() ? ` (${Number(draftFilters.customer!=='anyone')+Number(Boolean(draftFilters.search.trim()))} set)` : ''}
            <ChevronDown aria-hidden="true" />
          </ParkButton></ParkCollapsible.Trigger>
          <ParkCollapsible.Content className={css({ pt: '2' })}>
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '2' })}><ParkInput aria-label="Filter by exact customer email" type="email" placeholder="Customer email" value={draftFilters.customer==='anyone'?'':draftFilters.customer} onChange={event=>setDraftFilters(current=>({...current,customer:event.target.value.trim()||'anyone'}))} className={css({ flex: '1 1 13rem', minW: 0 })} /><ParkInput aria-label="Search ticket text" placeholder="Search ticket text" value={draftFilters.search} onChange={event=>setDraftFilters(current=>({...current,search:event.target.value}))} className={css({ flex: '1 1 13rem', minW: 0 })} /></div>
          </ParkCollapsible.Content>
        </ParkCollapsible.Root>
        <div className={css({ mt: '3', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '2', borderTopWidth: '1px', borderColor: 'border.default', pt: '3' })}>
          <ParkButton type="button" variant="plain" onClick={()=>{setNamingQuickView(true);setQuickViewError('');}}><Plus aria-hidden="true" />Add to quick view</ParkButton>
          <div className={css({ display: 'flex', gap: '1' })}><ParkButton type="button" variant="plain" onClick={clearFilters}>Clear all</ParkButton><ParkButton type="button" onClick={()=>applyFilters(draftFilters)}>Apply filters</ParkButton></div>
        </div>
        {namingQuickView&&<div className={css({ mt: '3', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2' })}><ParkInput aria-label="Quick view name" placeholder="Name this quick view" maxLength={100} value={quickViewName} onChange={event=>setQuickViewName(event.target.value)} className={css({ flex: '1 1 12rem', minW: 0 })} /><ParkButton type="button" disabled={createFilter.isPending||!quickViewRepresentable} onClick={()=>void saveQuickView()}>Save quick view</ParkButton></div>}
        {namingQuickView&&!quickViewRepresentable&&<p role="status" className={css({ mt: '2', color: 'fg.muted', fontSize: 'sm' })}>Quick views can currently save All tickets with an optional exact customer email. Apply these filters to use the other choices now.</p>}
        {quickViewError&&<ParkAlert.Root role="alert" status="error" className={css({ mt: '2' })}><ParkAlert.Content><ParkAlert.Description>{quickViewError}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
      </section>}
      {statsOpen&&<section id="inbox-quick-statistics" role="region" aria-label="Quick statistics" tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();statsTrigger.current?.focus();setStatsOpen(false);}}} className={css({ borderTop: '1px solid', borderColor: 'border.default', bg: 'bg.subtle', p: '4' })}>
        <dl aria-label={`Tickets on the ${metricScope}`} className={css({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '2' })}>
          {pageMetrics.map(metric=><ParkCard.Root key={metric.label} variant="outline"><ParkCard.Body className={css({ p: '3' })}><dt className={css({ color: 'fg.muted', fontSize: 'xs' })}>{metric.label}</dt><dd className={css({ mt: '1', fontFamily: 'tabular', fontSize: 'lg', fontWeight: 'semibold' })}>{metric.known?metric.count:'—'}</dd></ParkCard.Body></ParkCard.Root>)}
        </dl>
        {query.error&&hasConfirmedPage&&<p className={css({ mt: '2', color: 'fg.muted', fontSize: 'xs' })}>Metrics show the last confirmed page while refresh is unavailable.</p>}
        <h2 className={css({ mt: '4', fontSize: 'sm', fontWeight: 'semibold' })}>Tickets by priority</h2>
        <ul className={css({ mt: '2', display: 'grid', gap: '1', listStyle: 'none', p: 0 })}>{priorityCounts.map(({priority,count})=><li key={priority} className={css({ display: 'flex', justifyContent: 'space-between', gap: '2', color: 'fg.muted', fontSize: 'sm', textTransform: 'capitalize' })}><span>{priority}</span><span className={css({ fontFamily: 'tabular' })}>{hasConfirmedPage?count:'—'}</span></li>)}</ul>
        <p className={css({ mt: '2', color: 'fg.muted', fontSize: 'xs' })}>Statistics describe tickets on the {metricScope} and follow the applied filters.</p>
        {queueCounts.isError&&<ParkButton type="button" variant="plain" onClick={()=>void queueCounts.refetch()}>Retry queue totals</ParkButton>}
      </section>}
      {(recoveringPage||query.isPlaceholderData||workspace.status==='saving'||status) && <p role="status" aria-label="Inbox status" className={css({ px: '4', pb: '2', color: 'text.muted', fontSize: 'xs' })}>{recoveringPage?'Loading the first page after the conversation list changed…':query.isPlaceholderData?'Refreshing…':workspace.status==='saving'?'Saving view…':status}</p>}
    </header>
    {createMounted&&<NewTicketDialog open={createOpen} onOpenChange={setCreateOpen} trigger={createTrigger} onCreated={()=>setStatus('Ticket created.')} />}
    {slaSort&&<SlaQueueNotice asOf={query.data?.asOf} error={query.error} busy={query.isFetching} restart={restartSla} />}
    {query.error&&<ParkAlert.Root role="alert" status="error"><ParkAlert.Content>
      <ParkAlert.Description>{tickets.length?'Could not refresh conversations. The last confirmed list remains visible.':'Could not load conversations.'}</ParkAlert.Description>
      <ParkButton ref={retryButton} type="button" disabled={query.isFetching} onClick={()=>slaSort?restartSla():void query.refetch()}>Retry conversations</ParkButton>
    </ParkAlert.Content></ParkAlert.Root>}
    {workspace.status==='error'||workspace.status==='conflict'?<ParkAlert.Root role="alert" status="error"><ParkAlert.Content>
      <ParkAlert.Description>{workspace.error}</ParkAlert.Description>
      <ParkButton type="button" onClick={workspace.status==='conflict'?workspace.restoreServerState:workspace.retrySave}>{workspace.status==='conflict'?'Restore saved view':'Retry saving view'}</ParkButton>
    </ParkAlert.Content></ParkAlert.Root>:null}
    {drafts.status==='partial'&&<p role="status">Some draft indicators are still loading.</p>}
    {presentation==='table'&&<>
      <p className={css({ m: '0', px: '4', py: '2', color: 'text.muted', fontSize: 'xs' })}>Table view uses the compact conversation list on small screens.</p>
      <div className={css({ display: { base: 'none', md: 'block' }, minH: '0', flex: '1', overflow: 'auto', bg: 'bg.subtle' })}>
        <ParkTable.Root aria-label="Tickets in the current view" className={pageStyles.inboxTable}>
          <ParkTable.Head><ParkTable.Row><ParkTable.Header scope="col">Reference</ParkTable.Header><ParkTable.Header scope="col">Conversation</ParkTable.Header><ParkTable.Header scope="col">Customer</ParkTable.Header><ParkTable.Header scope="col">Status</ParkTable.Header></ParkTable.Row></ParkTable.Head>
          <ParkTable.Body>
            {query.isLoading&&<ParkTable.Row><ParkTable.Cell colSpan={4}><div role="status" aria-label="Loading conversations"><ParkSkeleton height="10" width="100%" /></div></ParkTable.Cell></ParkTable.Row>}
            {emptyPage&&<ParkTable.Row><ParkTable.Cell colSpan={4}><ParkEmptyState title={emptyMessage} description={queue?queueViews[queue].description:'Choose another queue or saved view.'} /></ParkTable.Cell></ParkTable.Row>}
            {!emptyPage&&!query.isLoading&&tickets.map(ticket=><ParkTable.Row key={ticket.id} data-selected={ticket.id===selectedTicketId?'true':undefined} className={pageStyles.inboxTableRow}>
              <ParkTable.Cell>{ticketReference(ticket,prefix)}</ParkTable.Cell>
              <ParkTable.Cell><ParkLink asChild><Link to={`/inbox/${activeView}/${ticket.id}`} onClick={()=>{if(!workspace.hasUnsavedChanges)workspace.update({selectedTicketId:ticket.id});}} className={css({ minW: 0, minH: '6', maxW: 'full', overflowWrap: 'anywhere', whiteSpace: 'normal', textAlign: 'start' })}>{ticket.subject}</Link></ParkLink></ParkTable.Cell>
              <ParkTable.Cell>{ticket.customer_email}</ParkTable.Cell>
              <ParkTable.Cell>{ticket.status}</ParkTable.Cell>
            </ParkTable.Row>)}
          </ParkTable.Body>
        </ParkTable.Root>
      </div>
    </>}
    <div role="listbox" aria-label="Conversation list" aria-activedescendant={tickets[focusedIndex]?`conversation-${tickets[focusedIndex].id}`:undefined} className={css({ flex: '1', minW: 0, overflowY: 'auto', overflowX: 'hidden', bg: 'bg.subtle', display: presentation==='table'?{base:'flex',md:'none'}:'flex', flexDirection: 'column', gap: '2', p: '2' })}>
      {query.isLoading?<div role="status" aria-label="Loading conversations" className={css({ display: 'grid', gap: '3', p: '4' })}>
        <ParkVisuallyHidden>Loading conversations…</ParkVisuallyHidden>
        {[0,1,2,3].map(row=><div key={row} className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
          <ParkSkeleton width="10" height="10" />
          <div className={css({ display: 'grid', flex: '1', gap: '2' })}><ParkSkeleton height="4" width="70%" /><ParkSkeleton height="3" width="90%" /></div>
        </div>)}
      </div>:emptyPage?<ParkEmptyState title={emptyMessage} description={queue?queueViews[queue].description:'Choose another queue or saved view.'} />:tickets.map((ticket,index)=><InboxConversationCard
        key={ticket.id} ticket={ticket} reference={ticketReference(ticket,prefix)} index={index} activeView={activeView}
        selected={ticket.id===selectedTicketId} focused={index===focusedIndex} expanded={expandedTicketId===ticket.id}
        sla={ticketSla.isError||query.isPlaceholderData?undefined:ticketSla.data?.[ticket.id] ?? undefined} slaLoading={ticketSla.isLoading}
        hasDraft={drafts.ticketIds.has(ticket.id)} queueId={queue&&!query.isPlaceholderData?queue:undefined} queueLabel={queue&&!query.isPlaceholderData?queueViews[queue].label:undefined}
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

function InboxConversationCard({ ticket, reference, index, activeView, selected, focused, expanded, sla, slaLoading, hasDraft, queueId, queueLabel, rowRefs, onFocus, onMoveFocus, onExpanded, onOpen, onResolve, onUrgent }: {
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
  queueId: QueueView | undefined;
  queueLabel: string | undefined;
  rowRefs: React.MutableRefObject<Array<HTMLElement | null>>;
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
  const linkRef = useRef<HTMLAnchorElement>(null);
  const breached = sla?.response.state === 'breached' || sla?.resolution.state === 'breached';
  const pills = [
    !ticket.assigned_to ? 'Unassigned' : undefined,
    breached ? 'Overdue' : undefined,
    ticket.status === 'pending' ? 'In progress' : undefined,
    ticket.priority === 'urgent' ? 'Urgent' : undefined,
    hasDraft ? 'Draft' : undefined,
  ].filter((pill): pill is string => Boolean(pill));
  if (queueLabel) pills.push(queueLabel);
  const pillSlots = Array.from({ length: Math.max(2, pills.length) }, (_, slot) => pills[slot] ?? null);
  const pillClass = (pill: string) => css({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minH: '5', minW: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', rounded: 'sm', bg: pill === 'Overdue' || pill === 'Urgent' ? 'bg.subtle' : 'bg.canvas', color: pill === 'Overdue' || pill === 'Urgent' ? 'red.11' : 'fg.muted', px: '1', fontSize: 'xs', fontWeight: 'medium' });
  const finishSwipe = () => {
    if (dragX >= 88) { didSwipe.current = true; onResolve(); }
    if (dragX <= -88) { didSwipe.current = true; onUrgent(); }
    pointerStart.current = null;
    setDragX(0);
  };
  return <article ref={node => { rowRefs.current[index] = node; }} id={`conversation-${ticket.id}`} role="option" aria-label={`${reference}: ${ticket.subject} — ${ticket.customer_email}. ${ticket.assigned_to ? 'Assigned' : 'Unassigned'}${breached ? '. Service level overdue' : ''}`} aria-selected={selected} tabIndex={focused?0:-1} data-selected={selected ? 'true' : undefined} data-preview-expanded={expanded ? 'true' : 'false'}
    className={css({ position: 'relative', flexShrink: '0', overflow: 'hidden', bg: selected ? 'bg.subtle' : 'bg.surface', borderWidth: '1px', borderRadius: 'l2', borderColor: selected ? 'border.focus' : 'border.default', focusVisibleRing: 'outside', _hover: { bg: 'bg.subtle' } })}
    onMouseEnter={() => { if (window.matchMedia?.('(hover: hover)').matches ?? true) onExpanded(ticket.id); }} onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) onExpanded(null); }}
    onFocus={() => { onFocus(); onExpanded(ticket.id); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onExpanded(null); }}
    onClick={event => { if (!(event.target as Element).closest('a')) linkRef.current?.click(); }}
    onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); onMoveFocus(index + 1); } else if (event.key === 'ArrowUp') { event.preventDefault(); onMoveFocus(index - 1); } else if (event.key === 'Enter') { event.preventDefault(); linkRef.current?.click(); } else if (event.key === ' ' && event.target === event.currentTarget) { event.preventDefault(); onExpanded(expanded ? null : ticket.id); } else if (event.key === 'Escape' && expanded) { event.preventDefault(); onExpanded(null); } else if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); onResolve(); } else if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); onUrgent(); } }}>
    <div aria-hidden="true" style={{ visibility: dragX === 0 ? 'hidden' : 'visible' }} className={css({ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bg: 'critical', px: '4', color: 'white', fontSize: 'sm', fontWeight: 'bold' })}><span>Resolve</span><span>Mark urgent</span></div>
    <div data-part="ticket-row-surface" style={{ transform: `translateX(${dragX}px)` }} onPointerDown={event => { pointerStart.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (pointerStart.current !== null) setDragX(Math.max(-112, Math.min(112, event.clientX - pointerStart.current))); }} onPointerUp={finishSwipe} onPointerCancel={() => { pointerStart.current = null; setDragX(0); }} className={css({ position: 'relative', display: 'grid', gridTemplateColumns: '3rem minmax(0, 1fr)', alignItems: 'start', gap: '2', p: '2', touchAction: 'pan-y', bg: 'bg.surface', _hover: { bg: 'bg.subtle' }, ...(selected ? { borderInlineStartWidth: '3px', borderInlineStartColor: 'border.focus', bg: 'bg.subtle' } : {}) })}>
      <div data-part="ticket-sla-anchor" className={css({ display: 'flex', flexDirection: 'column', alignItems: 'center', minW: 0 })}>
        <InboxSlaRing sla={sla} loading={slaLoading} priority={ticket.priority} />
      </div>
      <Link ref={linkRef} tabIndex={-1} aria-label={`Open ${reference}: ${ticket.subject}`} to={`/inbox/${activeView}/${ticket.id}`} onClick={event => { if (didSwipe.current) { event.preventDefault(); didSwipe.current = false; return; } onOpen(); }} className={css({ display: 'block', minW: 0, color: 'inherit', textDecoration: 'none' })}>
        <div data-part="ticket-default" aria-hidden={expanded} className={css({ display: 'grid', gridTemplateRows: expanded ? '0fr' : '1fr', opacity: expanded ? 0 : 1, transition: 'grid-template-rows 180ms ease, opacity 180ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } })}>
          <div className={css({ minH: 0, overflow: 'hidden' })}>
            <div className={css({ display: 'flex', alignItems: 'baseline', gap: '2', minW: 0 })}><span className={css({ flexShrink: 0, color: 'fg.muted', fontFamily: 'tabular', fontSize: 'xs', fontWeight: 'semibold' })}>{reference}</span><h3 className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'sm', fontWeight: 'semibold' })}>{ticket.subject}</h3></div>
            <div className={css({ mt: '1', display: 'flex', alignItems: 'center', minW: 0, gap: '1', color: 'fg.muted', fontSize: 'xs' })}><span className={css({ flex: '1', minW: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{ticket.customer_email}</span><span aria-hidden="true">·</span><span className={css({ flexShrink: 0 })}>{ticket.assigned_to?'Assigned':'Unassigned'}</span><time dateTime={ticket.updated_at} aria-label={`Updated ${utcTimestamp(ticket.updated_at).toLocaleDateString()}`} className={css({ '@media screen and (max-width: 63.999rem)': { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } })}>· {utcTimestamp(ticket.updated_at).toLocaleDateString()}</time></div>
            <div data-part="ticket-pill-slots" className={css({ mt: '1', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1', maxW: '44' })}>{pillSlots.map((pill,slot) => pill
              ? <span key={`${pill}-${slot}`} data-part="ticket-pill-slot" aria-label={queueLabel===pill&&queueId?`Inclusion reason: ${queueId}`:undefined} className={pillClass(pill)}>{pill}</span>
              : <span key={`empty-${slot}`} data-part="ticket-pill-slot" aria-hidden="true" className={css({ minH: '5' })} />)}</div>
          </div>
        </div>
        <div data-part="ticket-preview-panel" aria-hidden={!expanded} className={css({ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0, transition: 'grid-template-rows 180ms ease, opacity 180ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } })}>
          <div className={css({ minH: 0, overflow: 'hidden' })}>
            <p data-part="ticket-preview" data-expanded={expanded ? 'true' : 'false'} className={css({ color: 'fg.muted', fontSize: 'sm', lineHeight: '1.5', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' })}>{ticket.snippet || 'No conversation preview is available.'}</p>
          </div>
        </div>
      </Link>
    </div>
  </article>;
}

function InboxSlaRing({ sla, loading, priority }: { sla: TicketSla | undefined; loading: boolean; priority: Ticket['priority'] }) {
  const targets = sla ? [sla.response, sla.resolution] : [];
  const activeBreach = targets.find(target => target.state === 'breached' && target.phase !== 'completed');
  const breachedTarget = activeBreach ?? targets.find(target => target.state === 'breached');
  const target = breachedTarget ?? (sla?.response.state !== 'unavailable' ? sla?.response : sla?.resolution);
  const elapsed = target?.remainingWorkingMilliseconds !== null && target?.remainingWorkingMilliseconds !== undefined && target.targetWorkingMilliseconds
    ? Math.max(0, Math.min(1, 1 - target.remainingWorkingMilliseconds / target.targetWorkingMilliseconds)) : 0;
  const breached = Boolean(breachedTarget);
  const circumference = 2 * Math.PI * 15;
  const label = loading ? 'Loading service level' : !target || target.state === 'unavailable' ? 'Service level unavailable' : `${breached ? 'Breached' : 'On-track'} service level`;
  return <span aria-label={label} data-sla-breached={breached ? 'true' : 'false'} data-sla-pulsing={activeBreach ? 'true' : 'false'}
    className={clsx(css({ position: 'relative', display: 'inline-grid', h: '12', w: '12', placeItems: 'center', borderRadius: 'full', fontSize: '2xs', fontWeight: 'bold', color: breached ? 'critical' : 'text.primary' }), activeBreach && css({ animation: 'overduePulse 1.5s infinite', '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }))}>
    <svg aria-hidden="true" viewBox="0 0 36 36" className={css({ position: 'absolute', inset: 0, h: 'full', w: 'full', transform: 'rotate(-90deg)' })}>
      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.18" />
      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${circumference}`} strokeDashoffset={`${circumference * (1 - (breached ? 1 : elapsed))}`} />
    </svg>
    <span>{loading ? '…' : priority.slice(0, 1).toUpperCase()}</span>
  </span>;
}
