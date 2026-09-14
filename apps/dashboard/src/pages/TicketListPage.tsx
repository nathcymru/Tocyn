import { SlaQueueNotice } from '../components/SlaQueueNotice';
import { useTicketSlaBatch } from '../hooks/useTicketSla';
import { ConversationSlaStatus } from '../components/ConversationSlaStatus';
import { Popover } from '@luminatick/ui/ark';
import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton as TocynButton, ParkInput as TocynInput, ParkTextarea as TocynTextarea, ParkSelect as TocynSelect } from '@luminatick/ui/park';
import { utcTimestamp } from '../utils/utcTimestamp';
import React, { useState } from 'react';
import { ticketReference } from '../utils/ticket-reference';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTickets, useCreateTicket } from '../hooks/useTickets';
import { useGroups, useAgents } from '../hooks/useGroups';
import { useFilters } from '../hooks/useFilters';
import { useSettings } from '../hooks/useSettings';
import { useOperatorDraftIndicators, useOperatorWorkspaceState, type WorkspacePreference } from '../hooks/useOperatorWorkspaceState';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
import {
  Plus,
  Filter,
  MoreVertical,
  Clock,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  LayoutList,
  Copy,
  Check
} from 'lucide-react';
import { clsx } from 'clsx';

function cn(...inputs: any[]) {
  return clsx(inputs);
}

const statusColors = {
  open: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  resolved: 'bg-slate-100 text-slate-700 border-slate-200',
  closed: 'bg-slate-100 text-slate-700 border-slate-200',
};

const priorityColors = {
  low: 'text-slate-500',
  normal: 'text-blue-500',
  high: 'text-orange-500',
  urgent: 'text-red-500',
};

function pageFromAnchor(anchor: string) {
  const match = /^page:([1-9]\d*)$/.exec(anchor);
  const page = match ? Number(match[1]) : 1;
  return Number.isSafeInteger(page) ? page : 1;
}
function pageAnchor(page: number) { return `page:${Math.max(1, Math.floor(page))}`; }

export function TicketListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workspace = useOperatorWorkspaceState();
  const draftIndicators = useOperatorDraftIndicators();
  const globalSearch = searchParams.get('search')?.trim() || '';
  const [searchInput, setSearchInput] = useState(globalSearch);
  const activeFilterId = globalSearch ? '' : workspace.filters.filterId || '';
  const page = pageFromAnchor(workspace.listAnchor);

  React.useEffect(() => {
    setSearchInput(globalSearch);
  }, [globalSearch]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const createSubject = React.useRef<HTMLInputElement>(null);
  const createTrigger = React.useRef<HTMLButtonElement>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const retryButton = React.useRef<HTMLButtonElement>(null);
  const paging = React.useRef(false);
  const [feedStatus, setFeedStatus] = useState('');
  const [retryingFeed, setRetryingFeed] = useState(false);
  const [clipboardError, setClipboardError] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    subject: '',
    customer_email: '',
    body: '',
    priority: 'normal',
    status: 'open',
    group_id: '',
    assigned_to: '',
    custom_fields: {} as Record<string, any>,
  });

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const { data: filters, isLoading: isLoadingFilters } = useFilters();

  const { data: paginatedData, isLoading: isLoadingTickets, error: ticketsError, isFetching, isPlaceholderData, refetch, restartSla } = useTickets({
    page: page.toString(),
    sort: workspace.sort,
    ...(activeFilterId ? { filter_id: activeFilterId } : {}),
    ...(globalSearch ? { search: globalSearch } : {})
  });

  const tickets = paginatedData?.data || [];
  const slaSort = workspace.sort === 'sla_priority';
  const batchSla = useTicketSlaBatch(tickets.map(ticket => ticket.id), !slaSort && !isPlaceholderData && !ticketsError && Boolean(paginatedData));
  const ticketSla = slaSort ? { ...batchSla, isLoading: isLoadingTickets, isError: Boolean(ticketsError), isFetching, refetch, data: Object.fromEntries(Object.entries(paginatedData?.sla ?? {}).filter(([, value]) => value !== null)) } : batchSla;
  const restartSlaOrder = () => { restartSla(); workspace.update({ listAnchor: pageAnchor(1) }); setFeedStatus('SLA ordering restarted.'); };
  const meta = paginatedData?.meta || { page: 1, limit: 20, total: 0, total_pages: 1 };

  const { data: groups } = useGroups();
  const { data: agents } = useAgents();
  const { data: settings } = useSettings();
  const ticketPrefix = settings?.TICKET_PREFIX || '#';
  const createTicket = useCreateTicket();

  React.useEffect(() => {
    if (!isFetching && paging.current) {
      paging.current = false;
      if (ticketsError) retryButton.current?.focus();
    }
  }, [isFetching, ticketsError]);

  const retryFeed = async () => {
    if (slaSort) { restartSlaOrder(); return; }
    if (isFetching || retryingFeed) return;
    setRetryingFeed(true);
    setFeedStatus('Refreshing tickets…');
    try {
      const result = await refetch();
      setFeedStatus(result.isError ? '' : 'Tickets refreshed.');
      if (!result.isError) heading.current?.focus();
    } finally { setRetryingFeed(false); }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createTicket.isPending) return;
    setCreateError(null);
    try {
      await createTicket.mutateAsync({
        ...formData,
        group_id: formData.group_id || undefined,
        assigned_to: formData.assigned_to || undefined,
        custom_fields: Object.keys(formData.custom_fields).length > 0 ? formData.custom_fields : undefined,
      });
      setFeedStatus('Ticket created.');
      setIsModalOpen(false);
      setFormData({
        subject: '',
        customer_email: '',
        body: '',
        priority: 'normal',
        status: 'open',
        group_id: '',
        assigned_to: '',
        custom_fields: {},
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setCreateError(err instanceof Error ? err.message : 'Failed to create ticket. Please try again.');
    }
  };

  const handleFilterClick = (filterId: string) => {
    if (globalSearch) navigate('/tickets');
    workspace.update({
      view: filterId ? 'custom' : 'all',
      filters: { ...workspace.filters, filterId: filterId || null },
      listAnchor: pageAnchor(1),
    });
  };

  const handleSortChange = (sort: WorkspacePreference['sort']) => {
    if (sort === 'sla_priority') restartSla();
    workspace.update({ sort, listAnchor: pageAnchor(1) });
  };

  return (
    <div className="tocyn-ticket-list-layout">
      <DraftNavigationGuard pending={workspace.hasUnsavedChanges} flush={workspace.flushBeforeNavigation}
        failureMessage="Workspace preferences are not saved. Stay on this list, retry saving, then navigate again." />
      {/* Left Sidebar: Filters */}
      <div className="tocyn-ticket-list-filters">
        <h2 className="tocyn-ticket-list-filter-heading">Filters</h2>
        <TocynButton
          onClick={() => handleFilterClick('')}
          aria-pressed={activeFilterId === ''}
          className={cn(
            "tocyn-ticket-list-filter-button",
            activeFilterId === '' && "is-active"
          )}
        >
          <LayoutList className="tocyn-ticket-list-icon" />
          All Tickets
        </TocynButton>
        {isLoadingFilters ? (
          <div className="tocyn-ticket-list-filter-loading">Loading filters...</div>
        ) : (
          filters?.map(filter => (
            <TocynButton
              key={filter.id}
              onClick={() => handleFilterClick(filter.id)}
              aria-pressed={activeFilterId === filter.id}
              className={cn(
                "tocyn-ticket-list-filter-button",
                activeFilterId === filter.id && "is-active"
              )}
            >
              <Filter className="tocyn-ticket-list-icon" />
              {filter.name}
            </TocynButton>
          ))
        )}
      </div>

      {/* Right Content: Ticket List */}
      <div className="tocyn-ticket-list-content">
        <div className="tocyn-ticket-list-heading">
          <div>
            <h1 ref={heading} tabIndex={-1} className="tocyn-ticket-list-heading-title">{globalSearch ? 'Global ticket results' : 'Tickets'}</h1>
            <p className="tocyn-ticket-list-heading-subtitle">
              {globalSearch ? 'All authorised tickets' : activeFilterId
                ? filters?.find(f => f.id === activeFilterId)?.name
                : 'All Tickets'}
            </p>
          </div>
          <TocynButton
            type="button"
            ref={createTrigger}
            onClick={() => {setCreateError(null);setIsModalOpen(true);}}
            className="tocyn-ticket-list-create"
          >
            <Plus className="tocyn-ticket-list-icon" />
            New Ticket
          </TocynButton>
        </div>

        <p role="status" aria-label="Ticket list status" className="tocyn-ticket-list-status">{isPlaceholderData ? 'Loading tickets. Previous results remain visible.' : feedStatus}</p>
        <p role="status" aria-label="Workspace preference status" className="tocyn-ticket-list-status">
          {workspace.status === 'loading' ? 'Restoring workspace preferences…' : workspace.status === 'saving' ? 'Saving workspace preferences…' : workspace.status === 'saved' ? 'Workspace preferences saved.' : ''}
        </p>
        {slaSort && <SlaQueueNotice asOf={paginatedData?.asOf} error={ticketsError} busy={isFetching} restart={restartSlaOrder} />}
        {tickets.length > 0 && ticketSla.isLoading && <p role="status" className="tocyn-ticket-list-status">Loading service levels…</p>}
        {tickets.length > 0 && ticketSla.isError && <p role="status" className="tocyn-ticket-list-status">Service levels could not be refreshed. <TocynButton type="button" disabled={ticketSla.isFetching} onClick={() => void ticketSla.refetch()} className="tocyn-ticket-list-alert-action">Retry service levels</TocynButton></p>}
        {draftIndicators.status === 'partial' && <p role="status" aria-label="Draft indicator status" className="text-sm text-amber-800">Draft indicators are incomplete. Only the first 200 drafts were checked.</p>}
        {workspace.status === 'error' && (
          <div role="alert" className="tocyn-ticket-list-alert tocyn-ticket-list-alert--error">
            <p>{workspace.error}</p>
            <TocynButton type="button" onClick={workspace.retrySave} className="tocyn-ticket-list-alert-action">Retry workspace preferences</TocynButton>
          </div>
        )}
        {workspace.status === 'conflict' && (
          <div role="alert" className="tocyn-ticket-list-alert tocyn-ticket-list-alert--warning">
            <p>{workspace.error}</p>
            <TocynButton type="button" onClick={workspace.restoreServerState} className="tocyn-ticket-list-alert-action">Restore server preferences</TocynButton>
          </div>
        )}
        {clipboardError && <p role="alert" className="text-sm text-red-800">{clipboardError}</p>}
        {(ticketsError || retryingFeed) && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <p>{tickets.length ? 'Could not refresh tickets. Showing the last loaded results.' : 'Could not load tickets.'}</p>
            <TocynButton type="button" ref={retryButton} onClick={() => {void retryFeed();}} aria-disabled={isFetching || retryingFeed}
              className="mt-2 rounded border border-red-300 px-3 py-1 font-semibold focus-visible:outline focus-visible:outline-2">
              {isFetching ? 'Retrying…' : 'Retry loading tickets'}
            </TocynButton>
          </div>
        )}

        <div className="tocyn-ticket-table-shell">
          <div className="tocyn-ticket-table-toolbar">
            <div className="tocyn-global-search-shell">
              <Search className="tocyn-global-search-icon" aria-hidden="true" />
              <TocynInput
                type="text"
                placeholder="Search all authorised tickets..."
                aria-label="Search all tickets in this list view"
                aria-describedby="global-ticket-results-scope"
                className="tocyn-global-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const next = searchInput.trim();
                      navigate(next ? `/tickets?search=${encodeURIComponent(next)}` : '/tickets');
                      workspace.update({ listAnchor: pageAnchor(1) });
                    } else if (e.key === 'Escape' && searchInput) {
                      e.preventDefault();
                      navigate('/tickets');
                      workspace.update({ listAnchor: pageAnchor(1) });
                    }
                }}
              />
              <TocynButton type="button" aria-label="Clear list ticket search" disabled={!searchInput} onClick={()=>{navigate('/tickets');workspace.update({listAnchor:pageAnchor(1)});}}
                className="tocyn-search-clear">Clear</TocynButton>
              <p id="global-ticket-results-scope" className="sr-only">Search results include all tickets you are authorised to access. Current-view filters do not limit these results.</p>
            </div>
            <div className="tocyn-ticket-table-controls">
              <label className="tocyn-ticket-sort-label">
                <span>Sort tickets</span>
                <TocynSelect
                  aria-label="Sort tickets"
                  value={workspace.sort}
                  onChange={(event) => handleSortChange(event.target.value as WorkspacePreference['sort'])}
                  className="tocyn-form-control tocyn-ticket-sort-select"
                >
                  <option value="updated_desc">Recently updated</option>
                  <option value="updated_asc">Least recently updated</option>
                  <option value="created_desc">Newest created</option>
                  <option value="created_asc">Oldest created</option>
                  <option value="priority_desc">Highest priority</option>
                  <option value="priority_asc">Lowest priority</option>
                  <option value="sla_priority">Earliest SLA deadline</option>
                </TocynSelect>
              </label>
              <div className="tocyn-ticket-total">
                Total: {meta.total}
              </div>
            </div>
          </div>

          <div className="tocyn-ticket-table-scroll">
            <table className="tocyn-ticket-table">
              <thead>
                <tr className="tocyn-ticket-table-head">
                  <th>ID</th><th>Subject</th><th>Status</th><th>Priority</th><th>Customer</th><th>Last Update</th><th className="tocyn-ticket-table-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody className="tocyn-ticket-table-body">
                {isLoadingTickets ? (
                  <tr>
                    <td colSpan={7} className="tocyn-ticket-list-state">Loading tickets...</td>
                  </tr>
                ) : ticketsError && tickets.length === 0 ? (
                  <tr><td colSpan={7} className="tocyn-ticket-list-state">Tickets are currently unavailable.</td></tr>
                ) : tickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="tocyn-ticket-list-state">No tickets found.</td>
                  </tr>
                ) : (
                  tickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 group/copy">
                          <span className="font-mono text-xs font-bold text-slate-600 max-w-[12rem] truncate" title={ticketReference(ticket, ticketPrefix)}>
                            {ticketReference(ticket, ticketPrefix)}
                          </span>
                          <TocynButton
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setClipboardError('');
                              try {
                                await navigator.clipboard.writeText(ticketReference(ticket, ticketPrefix));
                                setCopiedId(ticket.id);
                                setFeedStatus('Ticket reference copied.');
                                setTimeout(() => setCopiedId(null), 2000);
                              } catch {
                                setClipboardError('Could not copy the ticket reference. Select and copy the visible reference instead.');
                              }
                            }}
                            className="p-1 rounded-md hover:bg-slate-100 text-slate-600 transition-colors opacity-0 group-hover/copy:opacity-100 focus:opacity-100"
                            title="Copy ticket reference"
                            aria-label="Copy ticket reference"
                          >
                            {copiedId === ticket.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </TocynButton>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Link to={`/tickets/${ticket.id}`} className="block font-medium text-slate-900 hover:text-brand-600">
                          {ticket.subject}
                        </Link>
                        {!ticketSla.isLoading && <ConversationSlaStatus sla={ticketSla.isError || isPlaceholderData ? undefined : ticketSla.data?.[ticket.id]} />}
                        {draftIndicators.ticketIds.has(ticket.id) && <span className="mt-1 inline-flex rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800" aria-label="Draft available">Draft</span>}
                        {ticket.snippet && (
                          <div className="text-xs text-slate-500 truncate max-w-sm mt-1" title={ticket.snippet}>
                            {ticket.snippet}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={clsx(
                          "px-2.5 py-0.5 rounded-full text-xs font-medium border",
                          statusColors[ticket.status as keyof typeof statusColors] || statusColors.open
                        )}>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-sm">
                          <AlertCircle className={clsx("w-4 h-4", priorityColors[ticket.priority as keyof typeof priorityColors] || priorityColors.normal)} />
                          <span className="capitalize">{ticket.priority}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm">
                          <p className="text-slate-900 truncate max-w-[150px]">{ticket.customer_email.split('@')[0]}</p>
                          <p className="text-slate-500 text-xs truncate max-w-[150px]" title={ticket.customer_email}>{ticket.customer_email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-slate-500 text-sm">
                          <Clock className="w-4 h-4" />
                          {utcTimestamp(ticket.updated_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right relative">
                        <Popover.Root open={openMenuId === ticket.id} onOpenChange={({open}) => setOpenMenuId(current => open ? ticket.id : current === ticket.id ? null : current)} positioning={{placement:'bottom-end',strategy:'fixed'}} lazyMount unmountOnExit>
                          <Popover.Trigger asChild>
                            <TocynButton type="button" aria-label={`Actions for ${ticketReference(ticket, ticketPrefix)}`} className="p-1 text-slate-600 hover:text-slate-900 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">
                              <MoreVertical className="w-5 h-5" />
                            </TocynButton>
                          </Popover.Trigger>
                          <Popover.Positioner className="z-20">
                            <Popover.Content aria-label={`Actions for ${ticketReference(ticket, ticketPrefix)}`} className="w-36 bg-white border border-slate-200 rounded-lg shadow-lg py-1 overflow-hidden">
                              <Link to={`/tickets/${ticket.id}`} onClick={() => setOpenMenuId(null)} className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-brand-600 text-left w-full">
                                View Ticket
                              </Link>
                            </Popover.Content>
                          </Popover.Positioner>
                        </Popover.Root>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {meta.total_pages > 1 && (
            <div className="tocyn-ticket-list-pagination">
              <span role="status" aria-label="Ticket pages" className="tocyn-ticket-list-status">
                Showing page {meta.page} of {meta.total_pages}
              </span>
              <div className="tocyn-ticket-table-controls">
                <TocynButton
                  onClick={() => { if (!isFetching && page > 1) { paging.current = true; workspace.update({ listAnchor: pageAnchor(page - 1) }); } }}
                  aria-disabled={isFetching || page === 1}
                  className="tocyn-ticket-pagination-button"
                >
                  <ChevronLeft className="tocyn-ticket-list-icon" />
                  Previous
                </TocynButton>
                <TocynButton
                  onClick={() => { if (!isFetching && page < meta.total_pages) { paging.current = true; workspace.update({ listAnchor: pageAnchor(page + 1) }); } }}
                  aria-disabled={isFetching || page >= meta.total_pages}
                  className="tocyn-ticket-pagination-button"
                >
                  Next
                  <ChevronRight className="tocyn-ticket-list-icon" />
                </TocynButton>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Ticket Modal */}
      <TocynDialog open={isModalOpen} onOpenChange={setIsModalOpen} busy={createTicket.isPending}
          labelledBy="create-ticket-heading" initialFocusEl={() => createSubject.current} finalFocusEl={() => createTrigger.current}
          className="w-full max-w-2xl">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 id="create-ticket-heading" className="text-xl font-bold text-slate-900">Create New Ticket</h2>
              <TocynButton type="button" aria-disabled={createTicket.isPending} aria-label="Close new ticket" onClick={() => { if (!createTicket.isPending) setIsModalOpen(false); }} className="rounded text-slate-600 hover:text-slate-900 focus-visible:outline focus-visible:outline-2">
                <X className="w-6 h-6" />
              </TocynButton>
            </div>
            <form aria-busy={createTicket.isPending} onSubmit={handleCreateTicket} className="p-6 space-y-4">
              <p role="status" aria-label="Ticket creation status" className="text-sm text-slate-700">{createTicket.isPending ? "Creating ticket…" : ""}</p>
              {createError && <p id="create-ticket-error" role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{createError}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label htmlFor="create-ticket-subject" className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                  <TocynInput
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                    id="create-ticket-subject"
                    ref={createSubject}
                    readOnly={createTicket.isPending}
                    aria-describedby={createError ? "create-ticket-error" : undefined}
                    value={formData.subject}
                    onChange={(e) => { if (!createTicket.isPending) setFormData({ ...formData, subject: e.target.value }); }}
                  />
                </div>
                <div>
                  <label htmlFor="create-ticket-customer_email" className="block text-sm font-medium text-slate-700 mb-1">Customer Email</label>
                  <TocynInput
                    type="email"
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                    id="create-ticket-customer_email"
                    readOnly={createTicket.isPending}
                    aria-describedby={createError ? "create-ticket-error" : undefined}
                    value={formData.customer_email}
                    onChange={(e) => { if (!createTicket.isPending) setFormData({ ...formData, customer_email: e.target.value }); }}
                  />
                </div>
                <div>
                  <label htmlFor="create-ticket-priority" className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <TocynSelect
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                    id="create-ticket-priority"
                    aria-disabled={createTicket.isPending}
                    value={formData.priority}
                    onChange={(e) => { if (!createTicket.isPending) setFormData({ ...formData, priority: e.target.value }); }}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </TocynSelect>
                </div>
                <div>
                  <label htmlFor="create-ticket-group_id" className="block text-sm font-medium text-slate-700 mb-1">Group</label>
                  <TocynSelect
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                    id="create-ticket-group_id"
                    aria-disabled={createTicket.isPending}
                    value={formData.group_id}
                    onChange={(e) => { if (!createTicket.isPending) setFormData({ ...formData, group_id: e.target.value }); }}
                  >
                    <option value="">No Group</option>
                    {groups?.map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </TocynSelect>
                </div>
                <div>
                  <label htmlFor="create-ticket-assigned_to" className="block text-sm font-medium text-slate-700 mb-1">Assignee</label>
                  <TocynSelect
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                    id="create-ticket-assigned_to"
                    aria-disabled={createTicket.isPending}
                    value={formData.assigned_to}
                    onChange={(e) => { if (!createTicket.isPending) setFormData({ ...formData, assigned_to: e.target.value }); }}
                  >
                    <option value="">Unassigned</option>
                    {agents?.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.full_name || agent.email}</option>
                    ))}
                  </TocynSelect>
                </div>
              </div>
              <div>
                <label htmlFor="create-ticket-body" className="block text-sm font-medium text-slate-700 mb-1">Initial Message</label>
                <TocynTextarea
                  required
                  rows={4}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                  id="create-ticket-body"
                    readOnly={createTicket.isPending}
                    aria-describedby={createError ? "create-ticket-error" : undefined}
                    value={formData.body}
                  onChange={(e) => { if (!createTicket.isPending) setFormData({ ...formData, body: e.target.value }); }}
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <TocynButton
                  type="button"
                  aria-disabled={createTicket.isPending}
                  onClick={() => { if (!createTicket.isPending) setIsModalOpen(false); }}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2"
                >
                  Cancel
                </TocynButton>
                <TocynButton
                  type="submit"
                  aria-disabled={createTicket.isPending}
                  className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors aria-disabled:bg-brand-700 aria-disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {createTicket.isPending ? 'Creating...' : 'Create Ticket'}
                </TocynButton>
              </div>
            </form>
          </div>
      </TocynDialog>
    </div>
  );
}
