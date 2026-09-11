import { TocynButton, TocynInput, TocynTextarea, TocynSelect } from '@luminatick/ui/primitives';
import { attachmentSize } from '../utils/attachment-size';
import { utcTimestamp } from '../utils/utcTimestamp';
import React, { useEffect, useState, useRef, useId } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTicket, useUpdateTicket, type TicketChanges } from '../hooks/useTickets';
import { useGroups, useAgents } from '../hooks/useGroups';
import { useSettings } from '../hooks/useSettings';
import { useRealtime } from '../hooks/useRealtime';
import { useTicketFields } from '../hooks/useTicketFields';
import { useSupportStates, useTicketSupportState, useTransitionSupportState } from '../hooks/useSupportStates';
import { useOperatorDraft, type OperatorDraftAttachment, type OperatorDraftValue, type OperatorDraftVersion } from '../hooks/useOperatorDraft';
import { useOperatorWorkspaceState } from '../hooks/useOperatorWorkspaceState';
import { useAuthStore } from '../store/authStore';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
import { ApiError, dashboardApi } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Send,
  User,
  ShieldCheck,
  Clock,
  MessageSquare,
  Eye,
  Info,
  Activity,
  X,
  Copy,
  Check
, Paperclip } from 'lucide-react';
import { clsx } from 'clsx';
import { ticketReference } from '../utils/ticket-reference';

type PendingAttachment = Readonly<{
  id: string;
  file: File;
  sessionGeneration: number;
  status: 'uploading' | 'error';
}>;

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const generation = useAuthStore(state => state.sessionGeneration);
  return <TicketDetail key={`${generation}:${id}`} id={id!} />;
}

function TicketDetail({ id }: { id: string }) {
  type TicketSelectControl = 'status' | 'priority' | 'assigned_to' | 'group_id';
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } = useTicket(id!);
  const { data: groups } = useGroups();
  const { data: agents } = useAgents();
  const { data: settings } = useSettings();
  const ticketPrefix = settings?.TICKET_PREFIX || '#';
  const { data: ticketFields } = useTicketFields();
  const customFieldPrefix = useId();
  const updateTicket = useUpdateTicket();
  const {
    data: supportStates = [],
    loadMore: loadMoreSupportStates,
    hasMore: hasMoreSupportStates,
    isLoading: isLoadingSupportStates,
    isLoadingMore: isLoadingMoreSupportStates,
    isLoadMoreError: isLoadMoreSupportStatesError,
  } = useSupportStates();
  const [showSupportState, setShowSupportState] = useState(false);
  const supportState = useTicketSupportState(id, showSupportState);
  const transitionSupportState = useTransitionSupportState();
  const { presence, updateLocation, lastMessage } = useRealtime();
  const draft = useOperatorDraft(id);
  const workspace = useOperatorWorkspaceState();
  const sessionGeneration = useAuthStore(state => state.sessionGeneration);
  const sessionGenerationRef = useRef(sessionGeneration);
  sessionGenerationRef.current = sessionGeneration;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [pendingAttachments, setPendingAttachments] = React.useState<readonly PendingAttachment[]>([]);
  const [sentDraftVersion, setSentDraftVersion] = useState<OperatorDraftVersion | null>(null);
  const pendingAttachmentIds = useRef(0);
  const activeUploads = useRef(new Set<string>());
  useEffect(() => () => { activeUploads.current.clear(); }, [sessionGeneration]);
  const visiblePendingAttachments = pendingAttachments.filter(attachment => attachment.sessionGeneration === sessionGeneration);
  const reply = draft.body;
  const isInternal = draft.mode === 'internal';
  const [suggestion, setSuggestion] = React.useState<string | null>(null);
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const qaChanging = useRef(false);
  const [qaPending, setQaPending] = useState(false);
  const submission = useRef(false);
  const changing = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const contextHeadingRef = useRef<HTMLHeadingElement>(null);
  const [focusContext, setFocusContext] = useState(false);
  const ticketSelectRefs = useRef<Record<TicketSelectControl, HTMLSelectElement | null>>({
    status: null,
    priority: null,
    assigned_to: null,
    group_id: null,
  });
  const [ticketSelectVersions, setTicketSelectVersions] = useState<Record<TicketSelectControl, number>>({
    status: 0,
    priority: 0,
    assigned_to: 0,
    group_id: 0,
  });
  const pendingTicketSelectFocus = useRef<TicketSelectControl | null>(null);
  const [pendingTicketSelectRefresh, setPendingTicketSelectRefresh] = useState<TicketSelectControl | null>(null);
  const [isConfirmingTicketSelect, setIsConfirmingTicketSelect] = useState(false);
  const [supportStateDraft, setSupportStateDraft] = useState({ definitionId: '', waitingReason: '', nextAction: '' });
  const [supportStateError, setSupportStateError] = useState<string | null>(null);
  const [supportStateNotice, setSupportStateNotice] = useState<string | null>(null);
  const supportStateSelect = useRef<HTMLSelectElement>(null);
  const supportStateDraftDirty = useRef(false);
  const supportStateFlight = useRef(false);
  const [isSupportStateSubmitting, setIsSupportStateSubmitting] = useState(false);
  const selectedSupportStateDefinition = supportStates.find(candidate => candidate.id === supportStateDraft.definitionId);
  const selectedSupportStateNeedsDetails = Boolean(supportState.data?.definition_id) && !selectedSupportStateDefinition;

  const restoreSupportStateDraft = (current = supportState.data) => {
    if (!current) return;
    supportStateDraftDirty.current = false;
    setSupportStateDraft({ definitionId: current.definition_id, waitingReason: current.waiting_reason ?? '', nextAction: current.next_action ?? '' });
  };

  const updateSupportStateDraft = (change: Partial<{ definitionId: string; waitingReason: string; nextAction: string }>) => {
    if (supportStateFlight.current) return;
    supportStateDraftDirty.current = true;
    setSupportStateDraft(current => ({ ...current, ...change }));
  };

  useEffect(() => {
    const current = supportState.data;
    // A refetch supplies a new concurrency revision, but it must never replace
    // an operator's local edit. The explicit discard action is the only route
    // that restores a dirty form from the server.
    if (!current || supportStateDraftDirty.current) return;
    restoreSupportStateDraft(current);
  }, [supportState.data?.definition_id, supportState.data?.revision]);

  React.useLayoutEffect(() => {
    const control = pendingTicketSelectFocus.current;
    if (!control) return;
    pendingTicketSelectFocus.current = null;
    ticketSelectRefs.current[control]?.focus();
  }, [ticketSelectVersions]);

  const refreshTicketSelect = (control: TicketSelectControl, restoreFocus = false) => {
    // WebKit can retain the prior accessibility value for a native select after
    // its value changes in place. Replace it only after the authoritative
    // mutation/refetch succeeds, and restore focus only when it still owns it.
    if (restoreFocus || document.activeElement === ticketSelectRefs.current[control]) {
      pendingTicketSelectFocus.current = control;
    }
    setTicketSelectVersions(previous => ({ ...previous, [control]: previous[control] + 1 }));
  };

  const retryTicketDetail = async (trigger?: HTMLElement) => {
    if (changing.current) return;
    changing.current = true;
    setIsConfirmingTicketSelect(true);
    const retryOwnedFocus = trigger !== undefined && document.activeElement === trigger;
    try {
      await refetch({ throwOnError: true });
      if (pendingTicketSelectRefresh) {
        const control = pendingTicketSelectRefresh;
        setPendingTicketSelectRefresh(null);
        // The recovery control is removed after a successful read. Return focus
        // to the refreshed select only if the retry still owned it.
        const restoreFocus = retryOwnedFocus && document.activeElement === trigger;
        refreshTicketSelect(control, restoreFocus);
        setNotice('Ticket details saved.');
      }
    } catch {
      // Keep recovery available even if a background read clears the query error.
    } finally {
      changing.current = false;
      setIsConfirmingTicketSelect(false);
    }
  };

  // Filter presence to find other agents viewing this ticket and deduplicate by userId
  const rawViewers = presence.filter(p => p.location === `ticket:${id}`);
  const viewers = Array.from(new Map(rawViewers.map(v => [v.userId, v])).values());

  useEffect(() => {
    if (!ticket || error || (workspace.status !== 'restored' && workspace.status !== 'saved') || workspace.selectedTicketId === id) return;
    workspace.update({ selectedTicketId: id });
  }, [id, ticket, error, workspace]);

  useEffect(() => {
    if (!focusContext || workspace.panel !== 'details') return;
    contextHeadingRef.current?.focus();
    setFocusContext(false);
  }, [focusContext, workspace.panel]);

  useEffect(() => {
    updateLocation(`ticket:${id}`);
    return () => updateLocation(null);
  }, [id, updateLocation]);

  useEffect(() => {
    if (lastMessage?.type === 'article.created' && String(lastMessage.payload?.ticket_id ?? lastMessage.payload?.ticketId) === String(id)) {
      void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    }
  }, [lastMessage, id, queryClient]);

  const handleTicketChange = async (changes: TicketChanges, control?: TicketSelectControl) => {
    if (changing.current || (control && pendingTicketSelectRefresh)) return;
    changing.current = true;
    setChangeError(null);
    setNotice('');
    try {
      await updateTicket.mutateAsync({ id, ...changes });
      if (control) {
        setIsConfirmingTicketSelect(true);
        try {
          await refetch({ throwOnError: true });
          refreshTicketSelect(control);
        } catch {
          setPendingTicketSelectRefresh(control);
          setNotice('Ticket details saved. Refresh the ticket before making another change.');
          return;
        } finally {
          setIsConfirmingTicketSelect(false);
        }
      }
      setNotice('Ticket details saved.');
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') setChangeError(error.message);
    } finally {
      changing.current = false;
    }
  };

  const handleToggleQa = async (articleId: string, type: 'sop' | 'answer' | null) => {
    if (qaChanging.current) return;
    qaChanging.current = true; setQaPending(true); setChangeError(null); setNotice('');
    try {
      await dashboardApi.post(`/knowledge/articles/${articleId}/qa`, { type });
      setNotice('QA marking saved.');
      await queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    } catch {
      setChangeError('QA marking could not be confirmed. Refresh the ticket before retrying.');
    } finally { qaChanging.current = false; setQaPending(false); }
  };

  const handleGetAiSuggestion = async () => {
    setIsGeneratingSuggestion(true);
    setSuggestion(null);
    try {
      const data = await dashboardApi.get<{ suggestion: string }>(`/knowledge/tickets/${id}/ai-suggest`);
      setSuggestion(data.suggestion);
    } catch (err: any) {
      alert('Failed to generate suggestion: ' + err.message);
    } finally {
      setIsGeneratingSuggestion(false);
    }
  };

  const submitSupportState = async (event: React.FormEvent) => {
    event.preventDefault();
    if (supportStateFlight.current) return;
    const current = supportState.data;
    const definition = selectedSupportStateDefinition;
    if (!current) return;
    if (!definition) { setSupportStateError('Load the current support-state definition before saving.'); return; }
    const waitingReason = supportStateDraft.waitingReason.trim();
    const nextAction = supportStateDraft.nextAction.trim();
    if (definition.waiting_reason_required && !waitingReason) { setSupportStateError('A waiting reason is required for this support state.'); return; }
    if (definition.next_action_required && !nextAction) { setSupportStateError('A next action is required for this support state.'); return; }
    setSupportStateError(null); setSupportStateNotice(null);
    supportStateFlight.current = true;
    setIsSupportStateSubmitting(true);
    try {
      const saved = await transitionSupportState.mutateAsync({ ticketId: id, definitionId: definition.id, waitingReason: waitingReason || null, nextAction: nextAction || null, expectedRevision: current.revision });
      restoreSupportStateDraft(saved);
      setSupportStateNotice('Support state saved.');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setSupportStateError('This support state changed elsewhere. Your input is retained. Refresh the current state, then review and retry.');
      } else setSupportStateError(cause instanceof Error ? `${cause.message}. Your input is retained.` : 'Support state could not be saved. Your input is retained.');
    } finally { supportStateFlight.current = false; setIsSupportStateSubmitting(false); }
  };

  const refreshSupportState = async () => {
    if (supportStateFlight.current) return;
    setSupportStateError(null);
    try { await supportState.refetch({ throwOnError: true }); setSupportStateNotice('Current support state refreshed. Your local input is retained; review it before saving.'); }
    catch { setSupportStateError('Could not refresh the current support state. Your input is retained.'); }
  };

  const discardSupportStateDraft = () => {
    restoreSupportStateDraft();
    setSupportStateError(null);
    setSupportStateNotice('Local support-state changes discarded.');
  };

  const updateDraft = (changes: Partial<OperatorDraftValue>) => {
    if (draft.currentSnapshot()?.status === 'loading') return;
    draft.update(current => ({
      mode: changes.mode ?? current.mode,
      body: changes.body ?? current.body,
      attachments: changes.attachments ?? current.attachments,
      baseConversationRevision: current.baseConversationRevision,
    }));
  };

  const uploadAttachment = async (pending: PendingAttachment) => {
    try {
      const formData = new FormData();
      formData.append('file', pending.file);
      const response = await dashboardApi.postForm<{ key: string }>('/attachments/upload', formData);
      if (sessionGenerationRef.current !== pending.sessionGeneration || !activeUploads.current.has(pending.id)) return;
      if (!response.key) throw new Error('Upload was not confirmed');
      const uploaded: OperatorDraftAttachment = {
        filename: pending.file.name,
        contentType: pending.file.type,
        size: pending.file.size,
        storageKey: response.key,
      };
      draft.update(current => ({ ...current, attachments: current.attachments.some(attachment => attachment.storageKey === uploaded.storageKey)
        ? current.attachments : [...current.attachments, uploaded] }));
      activeUploads.current.delete(pending.id);
      setPendingAttachments(currentAttachments => currentAttachments.filter(attachment => attachment.id !== pending.id));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (sessionGenerationRef.current !== pending.sessionGeneration || !activeUploads.current.has(pending.id)) return;
      setPendingAttachments(currentAttachments => currentAttachments.map(attachment =>
        attachment.id === pending.id ? { ...attachment, status: 'error' } : attachment));
    }
  };

  const addAttachments = (files: readonly File[]) => {
    if (draft.currentSnapshot()?.status === 'loading') return;
    const available = 10 - draftRef.current.attachments.length - visiblePendingAttachments.length;
    const selected = files.slice(0, Math.max(0, available));
    if (!selected.length) {
      setNotice('A draft can include at most ten attachments.');
      return;
    }
    const pending = selected.map(file => ({
      id: `pending-${++pendingAttachmentIds.current}`,
      file,
      sessionGeneration,
      status: 'uploading' as const,
    }));
    setPendingAttachments(current => [...current, ...pending]);
    pending.forEach(attachment => activeUploads.current.add(attachment.id));
    for (const attachment of pending) void uploadAttachment(attachment);
    setNotice(`${selected.length} attachment${selected.length === 1 ? '' : 's'} selected and uploading.`);
  };

  const retryAttachment = (attachment: PendingAttachment) => {
    if (attachment.sessionGeneration !== sessionGeneration || submission.current) return;
    const retrying = { ...attachment, status: 'uploading' as const };
    activeUploads.current.add(attachment.id);
    setPendingAttachments(current => current.map(candidate => candidate.id === attachment.id ? retrying : candidate));
    void uploadAttachment(retrying);
  };

  const discardDraft = async () => {
    if (submission.current) return;
    activeUploads.current.clear();
    setPendingAttachments(current => current.map(attachment => ({ ...attachment, status: 'error' })));
    const result = await draft.discard();
    if (result === 'cleared') {
      setSentDraftVersion(null);
      setPendingAttachments(current => current.filter(attachment => attachment.sessionGeneration !== sessionGeneration));
      setSuggestion(null);
      setNotice('Draft discarded.');
    }
  };

  const flushDraftBeforeNavigation = async () => {
    if (submission.current || visiblePendingAttachments.length > 0) return false;
    return (await draft.flushBeforeNavigation()) && workspace.flushBeforeNavigation();
  };
  const draftNavigationPending = isSubmitting || visiblePendingAttachments.length > 0 ||
    draft.status === 'unsaved' || draft.status === 'saving' || draft.status === 'error' || draft.status === 'conflict' || workspace.hasUnsavedChanges;

  const retrySentDraftCleanup = async () => {
    if (!sentDraftVersion || submission.current) return;
    submission.current = true;
    setIsSubmitting(true);
    try {
      if (await draft.cleanupAfterConfirmedSend(sentDraftVersion) === 'cleared') {
        setSentDraftVersion(null);
        setNotice('Sent draft cleared.');
      }
    } finally { submission.current = false; setIsSubmitting(false); }
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || submission.current || sentDraftVersion) return;
    if (visiblePendingAttachments.some(attachment => attachment.status === 'uploading')) return;
    const failedAttachments = visiblePendingAttachments.filter(attachment => attachment.status === 'error');
    if (failedAttachments.length) {
      failedAttachments.forEach(retryAttachment);
      setNotice('Retrying failed attachment uploads before sending.');
      return;
    }
    submission.current = true;
    setReplyError(null);
    setNotice('');

    setIsSubmitting(true);
    try {
      const acknowledged = await draft.flushBeforeNavigation();
      const sendingDraft = draft.currentSnapshot();
      if (!acknowledged || !sendingDraft?.version) {
        setReplyError('Draft needs a confirmed save before sending. Retry the draft save, then send again.');
        return;
      }
      const article = await dashboardApi.post<{ id?: string }>(`/tickets/${id}/articles`, {
        body: sendingDraft.body,
        is_internal: sendingDraft.mode === 'internal',
        attachments: sendingDraft.attachments
      });
      if (!article?.id) throw new Error('The reply was not confirmed.');
      setSentDraftVersion(sendingDraft.version);
      const cleanup = await draft.cleanupAfterConfirmedSend(sendingDraft.version);
      if (cleanup === 'cleared') setSentDraftVersion(null);
      setNotice(cleanup === 'cleared'
        ? isInternal ? 'Internal note added.' : 'Public reply added to the conversation.'
        : `${isInternal ? 'Internal note added.' : 'Public reply added to the conversation.'} Draft cleanup could not be confirmed; the draft is retained.`);
      setSuggestion(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ticket', id] }),
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      ]);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setReplyError(`${error.message}. Your draft is retained. Refresh the conversation before trying again if delivery is uncertain.`);
      }
    } finally {
      submission.current = false;
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <div className="p-8 text-center text-slate-500">Loading ticket...</div>;
  if (!ticket) return <div className="p-8 space-y-4 text-center text-slate-700">
    <p role="alert">{error instanceof ApiError && error.status === 404 ? 'Ticket not found.' : error instanceof ApiError && error.status === 403 ? 'You do not have access to this ticket.' : 'Could not load ticket. Please try again.'}</p>
    <TocynButton type="button" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect} onClick={(event) => void retryTicketDetail(event.currentTarget)} className="rounded border border-slate-400 px-4 py-2 focus-visible:outline focus-visible:outline-2">Retry loading ticket</TocynButton>
    <Link to="/tickets" className="block underline">Back to Tickets</Link>
  </div>;
  const reference = ticketReference(ticket, ticketPrefix);

  return (
    <>
      <DraftNavigationGuard pending={draftNavigationPending} flush={flushDraftBeforeNavigation}
        failureMessage="Your draft or workspace preferences are not saved. Stay on this ticket, retry or restore preferences, then navigate again." />
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      <div className="lg:col-span-3 xl:col-span-4 space-y-6">
        {((error && !isFetchNextPageError) || pendingTicketSelectRefresh) && <div role={error ? 'alert' : 'status'} className="rounded border border-red-300 bg-red-50 p-3 text-red-900">
          {error ? 'Could not refresh this ticket. Showing the last confirmed details. ' : 'Confirm the saved ticket details before making another change. '}
          <TocynButton type="button" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect} onClick={(event) => void retryTicketDetail(event.currentTarget)} className="underline">Retry loading ticket</TocynButton>
        </div>}
        {changeError && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-900">{changeError}</p>}
        {supportStateError && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-900">{supportStateError} <TocynButton type="button" onClick={() => void refreshSupportState()} className="underline">Refresh current support state</TocynButton></p>}
        {notice && <p role="status" className="text-slate-700">{notice}</p>}
        {supportStateNotice && <p role="status" className="text-slate-700">{supportStateNotice}</p>}
        {(workspace.status === 'saving' || workspace.status === 'saved' || workspace.status === 'error' || workspace.status === 'conflict') && <p role={workspace.status === 'error' || workspace.status === 'conflict' ? 'alert' : 'status'} className="text-sm text-slate-700">
          {workspace.status === 'saving' && 'Saving workspace preference…'}
          {workspace.status === 'saved' && 'Workspace preference saved.'}
          {workspace.status === 'error' && <>{workspace.error} <TocynButton type="button" onClick={() => workspace.retrySave()} className="underline">Retry workspace preference</TocynButton></>}
          {workspace.status === 'conflict' && <>{workspace.error} <TocynButton type="button" onClick={() => workspace.restoreServerState()} className="underline">Restore server preferences</TocynButton></>}
        </p>}
        <div className="flex items-center justify-between">
          <Link to="/tickets" className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Tickets
          </Link>
          <div className="flex items-center gap-2">
            <TocynButton type="button" ref={contextTriggerRef} aria-expanded={workspace.panel === 'details'} aria-controls="ticket-context-panel"
              onClick={() => {
                const opening = workspace.panel !== 'details';
                if (opening) setFocusContext(true);
                else contextTriggerRef.current?.focus();
                workspace.update({ panel: opening ? 'details' : 'conversation' });
              }} className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium">
              {workspace.panel === 'details' ? 'Hide ticket context' : 'Show ticket context'}
            </TocynButton>
            <TocynSelect
              key={`ticket-status-${ticketSelectVersions.status}`}
              ref={node => { ticketSelectRefs.current.status = node; }}
              aria-label="Status" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
              value={ticket.status}
              onChange={(e) => {
                if (changing.current || pendingTicketSelectRefresh) { e.currentTarget.value = ticket.status; return; }
                void handleTicketChange({ status: e.target.value as TicketChanges['status'] }, 'status');
              }}
              className="bg-white border border-slate-200 rounded-md px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-brand-500 outline-none shadow-sm"
            >
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </TocynSelect>
          </div>
        </div>

        {!showSupportState && <TocynButton type="button" onClick={() => setShowSupportState(true)} className="rounded border border-slate-300 px-3 py-2 text-sm">Manage support state</TocynButton>}
        {showSupportState && supportState.isLoading && <p role="status">Loading current support state…</p>}
        {showSupportState && supportState.data && typeof supportState.data.definition_id === 'string' && <form onSubmit={submitSupportState} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Support state">
          <div><h2 className="font-semibold text-slate-900">Support state</h2><p className="text-sm text-slate-600">Internal state and waiting facts are visible to staff only. Customer-facing label: {supportState.data.public_label}</p></div>
          <label className="block text-sm font-medium text-slate-700">State
            <TocynSelect ref={supportStateSelect} aria-label="Support state" value={supportStateDraft.definitionId} disabled={isSupportStateSubmitting || isLoadingSupportStates} aria-disabled={isSupportStateSubmitting || isLoadingSupportStates} onChange={event => updateSupportStateDraft({ definitionId: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2">
              {!selectedSupportStateDefinition && supportState.data?.definition_id === supportStateDraft.definitionId && <option value={supportStateDraft.definitionId}>{supportState.data.internal_label} ({supportState.data.lifecycle}) — state details loading</option>}
              {supportStates.map(state => <option key={state.id} value={state.id}>{state.internal_label} ({state.legacy_status})</option>)}
            </TocynSelect>
          </label>
          {isLoadingSupportStates && <p role="status" className="text-sm text-slate-700">Loading support-state definitions…</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Waiting reason{selectedSupportStateDefinition ? selectedSupportStateDefinition.waiting_reason_required ? ' (required)' : ' (optional)' : ' (state details loading)'}<TocynInput aria-label="Waiting reason" aria-required={Boolean(selectedSupportStateDefinition?.waiting_reason_required)} disabled={isSupportStateSubmitting} value={supportStateDraft.waitingReason} onChange={event => updateSupportStateDraft({ waitingReason: event.target.value })} maxLength={512} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-slate-700">Next action{selectedSupportStateDefinition ? selectedSupportStateDefinition.next_action_required ? ' (required)' : ' (optional)' : ' (state details loading)'}<TocynInput aria-label="Next action" aria-required={Boolean(selectedSupportStateDefinition?.next_action_required)} disabled={isSupportStateSubmitting} value={supportStateDraft.nextAction} onChange={event => updateSupportStateDraft({ nextAction: event.target.value })} maxLength={512} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
          </div>
          {selectedSupportStateNeedsDetails && <p role="status" className="text-sm text-slate-700">Load the current support-state definition before saving.</p>}
          <div className="flex flex-wrap gap-3"><TocynButton type="submit" disabled={isSupportStateSubmitting || !selectedSupportStateDefinition} aria-disabled={isSupportStateSubmitting || !selectedSupportStateDefinition} className="rounded bg-brand-600 px-4 py-2 text-white">Save support state</TocynButton><TocynButton type="button" disabled={isSupportStateSubmitting} onClick={() => void refreshSupportState()} className="underline">Refresh current state</TocynButton>{supportStateDraftDirty.current && <TocynButton type="button" disabled={isSupportStateSubmitting} onClick={discardSupportStateDraft} className="underline">Discard local changes</TocynButton>}</div>
          {hasMoreSupportStates && <TocynButton type="button" aria-disabled={isLoadingMoreSupportStates} onClick={() => void loadMoreSupportStates()} className="underline">{isLoadingMoreSupportStates ? 'Loading more support states…' : 'Load more support states'}</TocynButton>}
          {isLoadMoreSupportStatesError && <p role="alert" className="text-sm text-red-800">Could not load more support states. Try again.</p>}
        </form>}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <TocynButton type="button" aria-label="Copy ticket reference"
                    onClick={() => {
                      navigator.clipboard.writeText(reference);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="group/copy flex items-center gap-1.5 px-3 py-1 bg-slate-900 text-white rounded-lg text-sm font-mono font-bold shadow-sm cursor-pointer hover:bg-slate-800 transition-colors"
                    title={reference}
                  >
                    {reference}
                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400 group-hover/copy:text-white transition-colors" />}
                  </TocynButton>
                  <h1 className="text-2xl font-bold text-slate-900 leading-tight">{ticket.subject}</h1>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-md border border-slate-100">
                    <User className="w-3.5 h-3.5" />
                    {ticket.customer_email}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Opened {utcTimestamp(ticket.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Presence Indicator */}
              <div className="flex flex-col items-end gap-2">
                {viewers.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div aria-hidden="true" className="flex items-center -space-x-2">
                      {viewers.slice(0, 3).map((viewer, i) => (
                        <div
                          key={i}
                          className="w-8 h-8 rounded-full bg-brand-500 border-2 border-white flex items-center justify-center text-white text-[10px] font-bold shadow-sm"
                          title={`${viewer.name} is viewing this ticket`}
                        >
                          {viewer.name[0]}
                        </div>
                      ))}
                      {viewers.length > 3 && (
                        <div className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-slate-600 text-[10px] font-bold shadow-sm">
                          +{viewers.length - 3}
                        </div>
                      )}
                    </div>
                    <span className="sr-only">Viewing this ticket: {viewers.map(viewer => viewer.name).join(', ')}</span>
                    <span className="text-[10px] font-bold text-brand-600 uppercase tracking-tighter flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-brand-500 rounded-full" />
                      Live Viewers
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div id="conversation-messages" className="p-6 space-y-8 bg-slate-50/50 max-h-[600px] min-h-[400px] overflow-y-auto">
            {ticket.articles.map((article) => (
              <div
                key={article.id}
                className={clsx(
                  "flex gap-4 group",
                  article.sender_type === 'agent' ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div className={clsx(
                  "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold shadow-sm transition-transform group-hover:scale-105",
                  article.sender_type === 'agent' ? "bg-brand-600 text-white" : "bg-white text-slate-600 border border-slate-200",
                  article.is_internal && "bg-amber-100 text-amber-700 ring-2 ring-amber-200"
                )}>
                  {article.sender_type === 'agent' ? 'A' : article.sender_type === 'system' ? 'S' : 'C'}
                </div>
                <div className={clsx(
                  "max-w-[80%] rounded-2xl p-4 shadow-sm border transition-all",
                  article.sender_type === 'agent'
                    ? "bg-brand-600 text-white border-brand-700"
                    : "bg-white text-slate-900 border-slate-200",
                  article.is_internal && "!bg-amber-50 !border-amber-200 !text-amber-900 shadow-amber-100/50"
                )}>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <span className="text-[10px] font-bold uppercase opacity-70 tracking-widest">
                      {article.sender_type} {article.is_internal && '• Internal Note'}
                    </span>
                    <span className="text-[10px] opacity-70">
                      {utcTimestamp(article.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {article.body}
                  </div>

                  {/* Attachments */}
                  {article.attachments && article.attachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {article.attachments.map((att: any) => (
                        <TocynButton
                          key={att.id}
                          onClick={(e) => { e.preventDefault(); dashboardApi.download(`/attachments/${att.id}/download`, att.filename || att.file_name); }}
                          className={clsx(
                            "flex w-full cursor-pointer hover:opacity-80 items-center gap-2 p-2 rounded-lg text-sm",
                            article.sender_type === 'agent'
                              ? "bg-brand-700/50 text-white"
                              : "bg-gray-50 text-gray-700 border border-gray-100",
                            article.is_internal && "!bg-amber-100/50 !text-amber-900 border border-amber-200/50"
                          )}
                        >
                          <Paperclip className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate flex-1 text-left">{att.filename || att.file_name || 'Attachment'}</span>
                          <span className="text-xs opacity-75">
                            {attachmentSize(att.size ?? att.file_size)}
                          </span>
                        </TocynButton>
                      ))}
                    </div>
                  )}

                  {article.qa_type === 'question' && <p className="text-sm text-slate-700 bg-white p-2">Legacy Question marker retained. Compatibility review is required before changing this marker.</p>}
                  {/* QA Toggle Buttons */}
                  <div className="mt-3 p-2 rounded bg-white text-slate-900 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <TocynButton
                        aria-label="Mark as SOP (internal procedure)" aria-pressed={article.qa_type === 'sop'} disabled={qaPending || article.qa_type === 'question'}
                        onClick={() => handleToggleQa(article.id, article.qa_type === 'sop' ? null : 'sop')}
                        className={clsx(
                          "min-h-11 text-xs font-semibold px-3 py-2 rounded border transition-colors",
                          article.qa_type === 'sop' ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-900 border-slate-400 hover:bg-slate-100"
                        )}
                      >
                        {article.qa_type === 'sop' ? '✓ SOP (internal)' : 'Mark as SOP (internal)'}
                      </TocynButton>
                      <TocynButton
                        aria-label="Mark as answer" aria-pressed={article.qa_type === 'answer'} disabled={qaPending || article.qa_type === 'question'}
                        onClick={() => handleToggleQa(article.id, article.qa_type === 'answer' ? null : 'answer')}
                        className={clsx(
                          "min-h-11 text-xs font-semibold px-3 py-2 rounded border transition-colors",
                          article.qa_type === 'answer' ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-900 border-slate-400 hover:bg-slate-100"
                        )}
                      >
                        {article.qa_type === 'answer' ? '✓ Answer' : 'Mark as Answer'}
                      </TocynButton>
                    </div>
                    {article.qa_type && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-slate-700 px-2 py-1">
                        <ShieldCheck className="w-3 h-3" />
                        QA marked
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {ticket.pagination && <div className="border-t border-slate-200 bg-white p-4 space-y-2">
            <TocynButton type="button" onClick={() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage({ cancelRefetch: false }); }} aria-disabled={!hasNextPage || isFetchingNextPage}
              aria-controls="conversation-messages" aria-busy={isFetchingNextPage}
              className="rounded-md border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 aria-disabled:cursor-default">
              {isFetchingNextPage ? 'Loading messages…' : hasNextPage ? 'Load more messages' : 'All messages loaded'}
            </TocynButton>
            <p role="status" aria-live="polite" className="text-sm text-slate-700">
              {isFetchNextPageError ? 'Could not load more messages. Try again.' : isFetchingNextPage ? 'Loading more messages…' : `Showing ${ticket.articles.length} messages.${hasNextPage ? ' More messages are available.' : ' All messages are loaded.'}`}
            </p>
          </div>}
          <div className="p-6 border-t border-slate-200 bg-white">
            {replyError && <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-900">{replyError} <TocynButton type="button" onClick={() => void refetch()} className="underline">Refresh conversation</TocynButton></p>}
            {(draft.status !== 'idle' && draft.status !== 'discarded') && <div role={draft.status === 'error' || draft.status === 'conflict' ? 'alert' : 'status'} className={clsx(
              'mb-4 flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm',
              draft.status === 'error' || draft.status === 'conflict' ? 'border-red-300 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50 text-slate-700'
            )}>
              <span>
                {draft.status === 'loading' && 'Restoring your saved draft…'}
                {draft.status === 'unsaved' && 'Draft has unsaved changes.'}
                {draft.status === 'saving' && 'Saving draft…'}
                {draft.status === 'saved' && 'Draft saved.'}
                {draft.status === 'error' && (draft.error ?? 'Draft could not be saved.')}
                {draft.status === 'conflict' && (draft.error ?? 'Draft changed in another session. Review before discarding it.')}
              </span>
              <span className="flex items-center gap-3">
                {draft.status === 'error' && <TocynButton type="button" onClick={() => { draft.retryRestore(); draft.retrySave(); }} className="underline">Retry draft</TocynButton>}
                {(draft.status === 'saved' || draft.status === 'unsaved' || draft.status === 'error' || draft.status === 'conflict') && <TocynButton type="button" aria-disabled={isSubmitting} onClick={() => void discardDraft()} className="underline">Discard draft</TocynButton>}
              </span>
            </div>}
            <form onSubmit={handleSubmitReply} className="space-y-4">
              {sentDraftVersion && <p role="status">This reply was sent. Draft cleanup is still pending. <TocynButton type="button" aria-disabled={isSubmitting} onClick={() => void retrySentDraftCleanup()} className="underline">Retry sent-draft cleanup</TocynButton></p>}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <TocynButton
                    type="button"
                    aria-disabled={isSubmitting} aria-pressed={!isInternal}
                    onClick={() => { if (!submission.current) updateDraft({ mode: 'public' }); }}
                    className={clsx(
                      "text-xs font-bold px-4 py-1.5 rounded-full transition-all border",
                      !isInternal ? "bg-brand-600 text-white border-brand-700 shadow-sm" : "text-slate-500 hover:bg-slate-100 border-transparent"
                    )}
                  >
                    Public Reply
                  </TocynButton>
                  <TocynButton
                    type="button"
                    aria-disabled={isSubmitting} aria-pressed={isInternal}
                    onClick={() => { if (!submission.current) updateDraft({ mode: 'internal' }); }}
                    className={clsx(
                      "text-xs font-bold px-4 py-1.5 rounded-full transition-all border",
                      isInternal ? "bg-amber-700 text-white border-amber-800 shadow-sm" : "text-slate-500 hover:bg-slate-100 border-transparent"
                    )}
                  >
                    Internal Note
                  </TocynButton>
                </div>

                <TocynButton
                  type="button"
                  onClick={handleGetAiSuggestion}
                  disabled={isGeneratingSuggestion || isSubmitting}
                  className="flex items-center gap-2 text-xs font-bold text-brand-600 hover:text-brand-700 px-3 py-1.5 bg-brand-50 rounded-lg transition-colors border border-brand-100"
                >
                  <Activity className="w-3.5 h-3.5" />
                  {isGeneratingSuggestion ? 'Thinking...' : 'AI Suggestion'}
                </TocynButton>
              </div>

              {suggestion && (
                <div className="bg-slate-50 border border-brand-100 rounded-xl p-4 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      AI Auto-Draft
                    </span>
                    <div className="flex items-center gap-3">
                      <TocynButton
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => updateDraft({ body: suggestion })}
                        className="text-[10px] font-bold text-brand-600 hover:bg-brand-100 px-2 py-1 rounded transition-colors"
                      >
                        Replace All
                      </TocynButton>
                      <TocynButton
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => updateDraft({ body: reply ? `${reply}\n\n${suggestion}` : suggestion })}
                        className="text-[10px] font-bold text-brand-600 hover:bg-brand-100 px-2 py-1 rounded transition-colors"
                      >
                        Append
                      </TocynButton>
                      <TocynButton
                        type="button"
                        aria-label="Dismiss suggested reply"
                        onClick={() => setSuggestion(null)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </TocynButton>
                    </div>
                  </div>
                  <p className="text-sm text-slate-700 italic leading-relaxed">"{suggestion}"</p>
                </div>
              )}

              <div className="relative">
                <label htmlFor="reply-message" className="sr-only">Reply message</label>
                <TocynTextarea id="reply-message" readOnly={isSubmitting || draft.status === 'loading'} aria-busy={isSubmitting || draft.status === 'loading'}
                  className={clsx(
                    "w-full rounded-xl border p-4 text-sm focus:ring-4 outline-none min-h-[140px] transition-all resize-none shadow-inner",
                    isInternal
                      ? "bg-amber-50/50 border-amber-200 focus:ring-amber-500/10"
                      : "bg-slate-50/50 border-slate-200 focus:ring-brand-500/10"
                  )}
                  placeholder={isInternal ? "Type an internal note only visible to agents..." : "Type your reply to the customer..."}
                  value={reply}
                  onChange={(e) => { if (!submission.current) updateDraft({ body: e.target.value }); }}
                />
              </div>

              {(draft.attachments.length > 0 || visiblePendingAttachments.length > 0) && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {draft.attachments.map(attachment => (
                    <div key={attachment.storageKey} className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200">
                      <Paperclip className="w-3 h-3 text-slate-500" />
                      <span className="truncate max-w-[150px]">{attachment.filename}</span>
                      <TocynButton
                        type="button"
                        aria-disabled={isSubmitting} aria-label={`Remove ${attachment.filename}`}
                        onClick={() => {
                          if (submission.current) return;
                          updateDraft({ attachments: draftRef.current.attachments.filter(candidate => candidate.storageKey !== attachment.storageKey) });
                          setNotice('Attachment removed.');
                          attachButtonRef.current?.focus();
                        }}
                        className="text-slate-600 hover:text-red-700"
                      >
                        <X className="w-3 h-3" />
                      </TocynButton>
                    </div>
                  ))}
                  {visiblePendingAttachments.map(attachment => (
                    <div key={attachment.id} className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200">
                      <Paperclip className="w-3 h-3 text-slate-500" />
                      <span className="truncate max-w-[150px]">{attachment.file.name}</span>
                      <span role={attachment.status === 'error' ? 'alert' : 'status'} className="text-slate-600">{attachment.status === 'uploading' ? 'Uploading…' : 'Upload failed.'}</span>
                      {attachment.status === 'error' && <TocynButton type="button" aria-disabled={isSubmitting} onClick={() => retryAttachment(attachment)} className="underline">Retry upload</TocynButton>}
                      <TocynButton
                        type="button"
                        aria-disabled={isSubmitting} aria-label={`Remove ${attachment.file.name}`}
                        onClick={() => {
                          if (submission.current) return;
                          activeUploads.current.delete(attachment.id);
                          setPendingAttachments(current => current.filter(candidate => candidate.id !== attachment.id));
                          setNotice('Attachment removed.');
                          attachButtonRef.current?.focus();
                        }}
                        className="text-slate-600 hover:text-red-700"
                      >
                        <X className="w-3 h-3" />
                      </TocynButton>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-600 flex items-center gap-1.5">
                  <Info className="w-3 h-3" />
                  {isInternal
                    ? "Private note for team coordination."
                    : "Public replies are visible to the customer in this conversation."}
                </p>
                <div className="flex items-center gap-2">
                  <TocynInput
                    type="file" aria-label="Reply attachments" disabled={isSubmitting}
                    multiple
                    ref={fileInputRef}
                    className="hidden"
                    onChange={(e) => {
                      if (submission.current) return;
                      const selectedFiles = Array.from(e.currentTarget.files ?? []);
                      if (selectedFiles.length) addAttachments(selectedFiles);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  />
                  <TocynButton
                    type="button"
                    ref={attachButtonRef}
                    aria-disabled={isSubmitting} aria-label="Attach files"
                    onClick={() => { if (!submission.current) fileInputRef.current?.click(); }}
                    className="p-2.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                    title="Attach files"
                  >
                    <Paperclip className="w-4 h-4" />
                  </TocynButton>
                  <TocynButton
                    type="submit"
                    aria-disabled={!reply.trim() || isSubmitting || visiblePendingAttachments.length > 0 || Boolean(sentDraftVersion)}
                    className={clsx(
                      "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all shadow-md active:scale-95 aria-disabled:opacity-60 aria-disabled:cursor-default",
                      isInternal ? "bg-amber-700 text-white hover:bg-amber-800" : "bg-brand-600 text-white hover:bg-brand-700"
                    )}
                  >
                    <Send className="w-4 h-4" />
                    {isInternal ? "Add Note" : "Send Reply"}
                  </TocynButton>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>

      <aside id="ticket-context-panel" aria-label="Context" hidden={workspace.panel !== 'details'} className="space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 ref={contextHeadingRef} tabIndex={-1} className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Info className="w-4 h-4 text-slate-400" />
            Ticket Details
          </h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="ticket-priority" className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Priority</label>
              <div className="mt-1">
                <TocynSelect
                  key={`ticket-priority-${ticketSelectVersions.priority}`}
                  ref={node => { ticketSelectRefs.current.priority = node; }}
                  id="ticket-priority" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.priority}
                  onChange={(e) => {
                    if (changing.current || pendingTicketSelectRefresh) { e.currentTarget.value = ticket.priority; return; }
                    void handleTicketChange({ priority: e.target.value as TicketChanges['priority'] }, 'priority');
                  }}
                  className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-brand-500 outline-none shadow-sm"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </TocynSelect>
              </div>
            </div>
            <div>
              <label htmlFor="ticket-assigned_to" className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Assigned To</label>
              <div className="mt-1">
                <TocynSelect
                  key={`ticket-assigned_to-${ticketSelectVersions.assigned_to}`}
                  ref={node => { ticketSelectRefs.current.assigned_to = node; }}
                  id="ticket-assigned_to" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.assigned_to || ''}
                  onChange={(e) => {
                    if (changing.current || pendingTicketSelectRefresh) { e.currentTarget.value = ticket.assigned_to || ''; return; }
                    void handleTicketChange({ assigned_to: e.target.value || null }, 'assigned_to');
                  }}
                  className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-brand-500 outline-none shadow-sm"
                >
                  <option value="">Unassigned</option>
                  {agents?.map(agent => (
                    <option key={agent.id} value={agent.id}>{agent.full_name || agent.email}</option>
                  ))}
                </TocynSelect>
              </div>
            </div>
            <div>
              <label htmlFor="ticket-group_id" className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Group</label>
              <div className="mt-1">
                <TocynSelect
                  key={`ticket-group_id-${ticketSelectVersions.group_id}`}
                  ref={node => { ticketSelectRefs.current.group_id = node; }}
                  id="ticket-group_id" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.group_id || ''}
                  onChange={(e) => {
                    if (changing.current || pendingTicketSelectRefresh) { e.currentTarget.value = ticket.group_id || ''; return; }
                    void handleTicketChange({ group_id: e.target.value || null }, 'group_id');
                  }}
                  className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-brand-500 outline-none shadow-sm"
                >
                  <option value="">No Group</option>
                  {groups?.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </TocynSelect>
              </div>
            </div>

            {ticketFields && ticketFields.filter(f => f.is_active).length > 0 && (
              <div className="pt-4 mt-4 border-t border-slate-200">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Custom Attributes</h4>
                <div className="space-y-4">
                  {ticketFields.filter(f => f.is_active).map((field) => {
                    const value = ticket.custom_fields ? ticket.custom_fields[field.name] : '';
                    const inputId = `${customFieldPrefix}-${field.id}`;

                    const handleSave = (newValue: any) => {
                      if (value === newValue) return;

                      void handleTicketChange({
                        custom_fields: {
                          ...(ticket.custom_fields || {}),
                          [field.name]: newValue
                        }
                      });
                    };

                    return (
                      <div key={field.id}>
                        <label htmlFor={inputId} className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                          {field.label}
                        </label>
                        {field.field_type === 'select' && field.options ? (
                          <TocynSelect
                            id={inputId}
                            value={value || ''}
                            onChange={(e) => handleSave(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-brand-500 outline-none shadow-sm"
                          >
                            <option value="">Select...</option>
                            {field.options.split(',').map(s => s.trim()).filter(Boolean).map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </TocynSelect>
                        ) : field.field_type === 'checkbox' ? (
                          <div className="flex items-center gap-2">
                            <TocynInput
                              id={inputId}
                              type="checkbox"
                              checked={value === true || value === 'true'}
                              onChange={(e) => handleSave(e.target.checked)}
                              className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                            />
                            <span className="text-sm font-medium text-slate-700">{field.label}</span>
                          </div>
                        ) : (
                          <CustomFieldInput
                            id={inputId}
                            field={field}
                            value={value}
                            onSave={handleSave}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {viewers.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-in slide-in-from-right-4">
            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Eye className="w-4 h-4 text-brand-500" />
              Active Now
            </h3>
            <div className="space-y-3">
              {viewers.map((viewer, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-700 text-xs font-bold border border-brand-100">
                    {viewer.name[0]}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">{viewer.name}</p>
                    <p className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      Viewing
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
      </div>
    </>
  );
}

function CustomFieldInput({ id, field, value, onSave }: { id: string, field: any, value: any, onSave: (v: any) => void }) {
  const [localValue, setLocalValue] = useState(value || '');

  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const handleBlur = () => {
    onSave(localValue);
  };

  if (field.field_type === 'textarea') {
    return (
      <TocynTextarea
        id={id}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-brand-500 outline-none shadow-sm resize-y"
        rows={3}
      />
    );
  }

  return (
    <TocynInput
      id={id}
      type="text"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-brand-500 outline-none shadow-sm"
    />
  );
}
