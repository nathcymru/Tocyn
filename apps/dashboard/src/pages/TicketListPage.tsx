import { utcTimestamp } from '../utils/utcTimestamp';
import React, { useState } from 'react';
import { ticketReference } from '../utils/ticket-reference';
import { Link, useSearchParams } from 'react-router-dom';
import { useTickets, useCreateTicket } from '../hooks/useTickets';
import { useGroups, useAgents } from '../hooks/useGroups';
import { useFilters } from '../hooks/useFilters';
import { useSettings } from '../hooks/useSettings';
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
import { twMerge } from 'tailwind-merge';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
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

export function TicketListPage() {
  const [activeFilterId, setActiveFilterId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  React.useEffect(() => {
    const urlSearch = searchParams.get('search') || '';
    setSearchInput(urlSearch);
    setSearchQuery((prev) => {
      if (prev !== urlSearch) {
        setPage(1);
      }
      return urlSearch;
    });
  }, [searchParams]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const createDialog = React.useRef<HTMLDialogElement>(null);
  const createTrigger = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!isModalOpen) return;
    const previousFocus = createTrigger.current;
    const dialog = createDialog.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('#create-ticket-subject')?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isModalOpen]);
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
  
  const { data: paginatedData, isLoading: isLoadingTickets, error: ticketsError, isFetching, isPlaceholderData, refetch } = useTickets({
    page: page.toString(),
    ...(activeFilterId ? { filter_id: activeFilterId } : {}),
    ...(searchQuery ? { search: searchQuery } : {})
  });

  const tickets = paginatedData?.data || [];
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
    setActiveFilterId(filterId);
    setPage(1); // Reset page on filter change
  };

  return (
    <div className="flex h-full gap-6">
      {/* Left Sidebar: Filters */}
      <div className="w-64 flex flex-col gap-2 shrink-0">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Filters</h2>
        <button
          onClick={() => handleFilterClick('')}
          aria-pressed={activeFilterId === ''}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left",
            activeFilterId === ''
              ? "bg-brand-50 text-brand-700"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          )}
        >
          <LayoutList className="w-4 h-4" />
          All Tickets
        </button>
        {isLoadingFilters ? (
          <div className="px-3 py-2 text-sm text-slate-500">Loading filters...</div>
        ) : (
          filters?.map(filter => (
            <button
              key={filter.id}
              onClick={() => handleFilterClick(filter.id)}
              aria-pressed={activeFilterId === filter.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left",
                activeFilterId === filter.id
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Filter className="w-4 h-4" />
              {filter.name}
            </button>
          ))
        )}
      </div>

      {/* Right Content: Ticket List */}
      <div className="flex-1 flex flex-col min-w-0 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold text-slate-900">Tickets</h1>
            <p className="text-slate-500 text-sm">
              {activeFilterId 
                ? filters?.find(f => f.id === activeFilterId)?.name 
                : 'All Tickets'}
            </p>
          </div>
          <button 
            type="button"
            ref={createTrigger}
            onClick={() => {setCreateError(null);setIsModalOpen(true);}}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700 transition-colors shadow-sm text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Plus className="w-4 h-4" />
            New Ticket
          </button>
        </div>

        <p role="status" aria-label="Ticket list status" className="text-sm text-slate-700">{isPlaceholderData ? 'Loading tickets. Previous results remain visible.' : feedStatus}</p>
        {clipboardError && <p role="alert" className="text-sm text-red-800">{clipboardError}</p>}
        {(ticketsError || retryingFeed) && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <p>{tickets.length ? 'Could not refresh tickets. Showing the last loaded results.' : 'Could not load tickets.'}</p>
            <button type="button" ref={retryButton} onClick={() => {void retryFeed();}} aria-disabled={isFetching || retryingFeed}
              className="mt-2 rounded border border-red-300 px-3 py-1 font-semibold focus-visible:outline focus-visible:outline-2">
              {isFetching ? 'Retrying…' : 'Retry loading tickets'}
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="max-w-md w-full relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text"
                placeholder="Search tickets..."
                aria-label="Search tickets"
                className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setSearchQuery(searchInput);
                    setPage(1);
                    if (searchInput.trim()) {
                      setSearchParams({ search: searchInput.trim() });
                    } else {
                      setSearchParams({});
                    }
                  }
                }}
              />
            </div>
            <div className="text-sm text-slate-500 font-medium">
              Total: {meta.total}
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4 border-b border-slate-200">ID</th>
                  <th className="px-6 py-4 border-b border-slate-200">Subject</th>
                  <th className="px-6 py-4 border-b border-slate-200">Status</th>
                  <th className="px-6 py-4 border-b border-slate-200">Priority</th>
                  <th className="px-6 py-4 border-b border-slate-200">Customer</th>
                  <th className="px-6 py-4 border-b border-slate-200">Last Update</th>
                  <th className="px-6 py-4 border-b border-slate-200 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {isLoadingTickets ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">Loading tickets...</td>
                  </tr>
                ) : ticketsError && tickets.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-600">Tickets are currently unavailable.</td></tr>
                ) : tickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">No tickets found.</td>
                  </tr>
                ) : (
                  tickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 group/copy">
                          <span className="font-mono text-xs font-bold text-slate-600 max-w-[12rem] truncate" title={ticketReference(ticket, ticketPrefix)}>
                            {ticketReference(ticket, ticketPrefix)}
                          </span>
                          <button
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
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Link to={`/tickets/${ticket.id}`} className="block font-medium text-slate-900 hover:text-brand-600">
                          {ticket.subject}
                        </Link>
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
                      <td className="px-6 py-4 text-right relative" onKeyDown={(event) => {
                        if (event.key === 'Escape' && openMenuId === ticket.id) {
                          event.preventDefault();
                          setOpenMenuId(null);
                          event.currentTarget.querySelector<HTMLButtonElement>('button[data-row-action]')?.focus();
                        }
                      }}>
                        <button 
                          type="button"
                          data-row-action
                          aria-label={`Actions for ${ticketReference(ticket, ticketPrefix)}`}
                          aria-expanded={openMenuId === ticket.id}
                          aria-controls={`ticket-actions-${ticket.id}`}
                          onClick={() => setOpenMenuId(openMenuId === ticket.id ? null : ticket.id)}
                          className="p-1 text-slate-600 hover:text-slate-900 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700 relative z-10"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        {openMenuId === ticket.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                            <div id={`ticket-actions-${ticket.id}`} role="group" aria-label={`Actions for ${ticketReference(ticket, ticketPrefix)}`} className="absolute right-6 top-10 w-36 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 overflow-hidden">
                              <Link 
                                to={`/tickets/${ticket.id}`}
                                className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-brand-600 text-left w-full"
                              >
                                View Ticket
                              </Link>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {meta.total_pages > 1 && (
            <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
              <span role="status" aria-label="Ticket pages" className="text-sm text-slate-700 font-medium">
                Showing page {meta.page} of {meta.total_pages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => { if (!isFetching && page > 1) { paging.current = true; setPage(p => p - 1); } }}
                  aria-disabled={isFetching || page === 1}
                  className="px-3 py-1.5 border border-slate-200 rounded-md text-sm font-medium text-slate-600 hover:bg-white aria-disabled:bg-slate-100 aria-disabled:cursor-default focus-visible:outline focus-visible:outline-2 flex items-center gap-1 bg-white shadow-sm transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  onClick={() => { if (!isFetching && page < meta.total_pages) { paging.current = true; setPage(p => p + 1); } }}
                  aria-disabled={isFetching || page >= meta.total_pages}
                  className="px-3 py-1.5 border border-slate-200 rounded-md text-sm font-medium text-slate-600 hover:bg-white aria-disabled:bg-slate-100 aria-disabled:cursor-default focus-visible:outline focus-visible:outline-2 flex items-center gap-1 bg-white shadow-sm transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Ticket Modal */}
      {isModalOpen && (
        <dialog ref={createDialog} aria-labelledby="create-ticket-heading"
          onCancel={(event) => { event.preventDefault(); if (!createTicket.isPending) setIsModalOpen(false); }}
          className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none z-50 open:flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 id="create-ticket-heading" className="text-xl font-bold text-slate-900">Create New Ticket</h2>
              <button type="button" aria-disabled={createTicket.isPending} aria-label="Close new ticket" onClick={() => { if (!createTicket.isPending) setIsModalOpen(false); }} className="rounded text-slate-600 hover:text-slate-900 focus-visible:outline focus-visible:outline-2">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form aria-busy={createTicket.isPending} onSubmit={handleCreateTicket} className="p-6 space-y-4">
              <p role="status" aria-label="Ticket creation status" className="text-sm text-slate-700">{createTicket.isPending ? "Creating ticket…" : ""}</p>
              {createError && <p id="create-ticket-error" role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{createError}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label htmlFor="create-ticket-subject" className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                    id="create-ticket-subject"
                    readOnly={createTicket.isPending}
                    aria-describedby={createError ? "create-ticket-error" : undefined}
                    value={formData.subject}
                    onChange={(e) => { if (!createTicket.isPending) setFormData({ ...formData, subject: e.target.value }); }}
                  />
                </div>
                <div>
                  <label htmlFor="create-ticket-customer_email" className="block text-sm font-medium text-slate-700 mb-1">Customer Email</label>
                  <input
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
                  <select
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
                  </select>
                </div>
                <div>
                  <label htmlFor="create-ticket-group_id" className="block text-sm font-medium text-slate-700 mb-1">Group</label>
                  <select
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
                  </select>
                </div>
                <div>
                  <label htmlFor="create-ticket-assigned_to" className="block text-sm font-medium text-slate-700 mb-1">Assignee</label>
                  <select
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
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="create-ticket-body" className="block text-sm font-medium text-slate-700 mb-1">Initial Message</label>
                <textarea
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
                <button
                  type="button"
                  aria-disabled={createTicket.isPending}
                  onClick={() => { if (!createTicket.isPending) setIsModalOpen(false); }}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  aria-disabled={createTicket.isPending}
                  className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors aria-disabled:bg-brand-700 aria-disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {createTicket.isPending ? 'Creating...' : 'Create Ticket'}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </div>
  );
}
