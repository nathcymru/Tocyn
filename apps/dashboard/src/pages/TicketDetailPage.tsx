import { useOptionalOperatorPreferencesContext } from '../components/theme/OperatorThemeProvider';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import { KnowledgeBrowser } from '../components/KnowledgeBrowser';
import { TicketAssignmentActions } from '../components/TicketAssignmentActions';
import { TicketSlaPanel } from '../components/TicketSlaPanel';
import { TicketSlaActionBar } from '../components/TicketSlaActionBar';
import { TicketActionBar } from '../components/TicketActionBar';
import { ParkAlert, ParkAvatar, ParkAvatarFallback, ParkButton, ParkCheckbox, ParkEmptyState, ParkFileUpload, ParkInput, ParkScrollArea, ParkSkeleton, ParkTabs, ParkTextarea, ParkTicketDetail } from '@luminatick/ui/park';
import { Collapsible as ParkCollapsible, Field, Link as ParkLink } from '@luminatick/ui/components';
import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import { attachmentSize } from '../utils/attachment-size';
import { attachmentIconKind, type AttachmentIconKind } from '../utils/attachment-icon-kind';
import { utcTimestamp } from '../utils/utcTimestamp';
import React, { useEffect, useState, useRef, useId, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { useTicket, useAssignResponsibleOwner, useUpdateTicket, type TicketChanges } from '../hooks/useTickets';
import { useGroups, useAgents } from '../hooks/useGroups';
import { useSettings } from '../hooks/useSettings';
import { useCollaboration } from '../components/CollaborationContext';
import { useTicketFields } from '../hooks/useTicketFields';
import { useSupportStates, useTicketSupportState, useTransitionSupportState } from '../hooks/useSupportStates';
import { useTicketHistory, type TicketHistoryEvent } from '../hooks/useTicketHistory';
import { useOperatorDraft, type OperatorDraftAttachment, type OperatorDraftValue, type OperatorDraftVersion } from '../hooks/useOperatorDraft';
import { useOperatorWorkspaceState } from '../hooks/useOperatorWorkspaceState';
import { useAuthStore } from '../store/authStore';
import { DraftNavigationGuard } from '../components/DraftNavigationGuard';
import { AuthenticatedAttachmentImage } from '../components/AuthenticatedAttachmentImage';
import { useReplyCapability } from '../hooks/useReplyCapability';
import { useTicketUtilityActions } from '../hooks/useTicketUtilityActions';
import { RichComposer, SafeMarkdown } from '../components/RichComposer';
import { ApiError, dashboardApi } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Send,
  User,
  ShieldCheck,
  Clock,
  MessageSquare,
  Mail,
  Eye,
  Info,
  Activity,
  X,
  IconFile, IconFileImage, IconFileLines, IconFilePdf, IconFileZip,
  Paperclip } from '../components/icons';
import { clsx } from 'clsx';
import { ticketReference } from '../utils/ticket-reference';
import { browserDateTimeLocalToInstant, browserInstantToDateTimeLocal } from '../utils/localDateTime';
import type { KnowledgeDoc } from '../types';

type PendingAttachment = Readonly<{
  id: string;
  file: File;
  sessionGeneration: number;
  status: 'uploading' | 'error';
}>;

/** A server-derived review revision; retry means that the bracketing reads disagreed. */
type StaleReplyReview = number | 'refreshing' | 'retry';

const statusOptions = [{ value: 'open', label: 'Open' }, { value: 'pending', label: 'Pending' }, { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }];
const priorityOptions = [{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }];
const attachmentIcons: Record<AttachmentIconKind, typeof IconFile> = {
  pdf: IconFilePdf, image: IconFileImage, archive: IconFileZip, text: IconFileLines, generic: IconFile,
};

const secondaryDisclosureTrigger = css({
  display: 'flex',
  alignItems: 'center',
  minH: '8',
  w: 'full',
  px: '2',
  cursor: 'pointer',
  color: 'text.primary',
  fontSize: 'sm',
  fontWeight: 'bold',
  textAlign: 'left',
  _focusVisible: { focusVisibleRing: 'outside' },
});

export function TicketDetailPage({id:providedId,workspaceBackHref,onResolved}:{id?:string;workspaceBackHref?:string;onResolved?:(id:string)=>void}={}) {
  const { id:routeId } = useParams<{ id: string }>();
  const id=providedId??routeId;
  const generation = useAuthStore(state => state.sessionGeneration);
  const user = useAuthStore(state => state.user);
  return <TicketDetail key={JSON.stringify([generation, user?.tenant_id, user?.id, user?.role, id])} id={id!} workspaceBackHref={workspaceBackHref} onResolved={onResolved} />;
}

function TicketDetail({ id,workspaceBackHref,onResolved }: { id: string;workspaceBackHref?:string;onResolved?:(id:string)=>void }) {
  type TicketSelectControl = 'status' | 'priority' | 'assigned_to' | 'group_id';
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError, isFetchedAfterMount, isFetching } = useTicket(id!);
  const { data: groups } = useGroups();
  const { data: agents } = useAgents();
  const { data: settings } = useSettings();
  const ticketPrefix = settings?.TICKET_PREFIX || '#';
  const { data: ticketFields } = useTicketFields();
  const customFieldPrefix = useId();
  const updateTicket = useUpdateTicket();
  const assignResponsibleOwner = useAssignResponsibleOwner();
  const [assignmentBlocked, setAssignmentBlocked] = useState(false);
  const ticketMutationPending = updateTicket.isPending || assignResponsibleOwner.isPending || assignmentBlocked;
  const refreshAssignment = useCallback(async () => { await refetch({ throwOnError: true }); }, [refetch]);
  const {
    data: supportStates = [],
    loadMore: loadMoreSupportStates,
    hasMore: hasMoreSupportStates,
    isLoading: isLoadingSupportStates,
    error: supportStatesReadError,
    dataUpdatedAt: supportStatesUpdatedAt,
    refetch: refetchSupportStates,
    isLoadingMore: isLoadingMoreSupportStates,
    isLoadMoreError: isLoadMoreSupportStatesError,
  } = useSupportStates();
  const [showSupportState, setShowSupportState] = useState(false);
  const supportState = useTicketSupportState(id, showSupportState);
  const transitionSupportState = useTransitionSupportState();
  const { updateLocation, lastMessage, viewersForTicket, typingForTicket, announceTyping, stopTyping } = useCollaboration();
  const draft = useOperatorDraft(id);
  const replyCapabilities = useReplyCapability(id);
  const utilityActions = useTicketUtilityActions(id);
  const replyCapability = replyCapabilities.data?.modes.find(mode => mode.visibility === draft.mode);
  const workspace = useOperatorWorkspaceState();
  const preferences = useOptionalOperatorPreferencesContext();
  const lifetimeIdentity = useRef(assignmentIdentity());
  const mounted = useRef(false);
  React.useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const advanceEnabled = useRef(preferences?.advanceAfterResolve ?? false);
  React.useLayoutEffect(() => { advanceEnabled.current = preferences?.advanceAfterResolve ?? false; }, [preferences?.advanceAfterResolve]);
  const [advanceConfirmationRequired, setAdvanceConfirmationRequired] = useState(false);
  const pendingAdvance = useRef<((id:string)=>void)|null>(null);
  const confirmedResolve = (status?: string) => {
    if (!pendingAdvance.current || status !== 'resolved') return;
    const advance = pendingAdvance.current;
    pendingAdvance.current = null;
    setAdvanceConfirmationRequired(false);
    if (advanceEnabled.current && mounted.current && assignmentIdentity() === lifetimeIdentity.current) advance(id);
  };
  const contextApplied = useRef(false);
  useEffect(() => {
    if (contextApplied.current || !ticket || !preferences || ['loading','idle','error'].includes(preferences.status)
      || !['restored','saved'].includes(workspace.status)) return;
    contextApplied.current = true;
    if (preferences.contextDefault !== 'remember') workspace.update({ panel: preferences.contextDefault });
  }, [preferences, ticket, workspace]);
  const customerHistory = useTicketHistory(id, workspace.panel === 'details');
  const sessionGeneration = useAuthStore(state => state.sessionGeneration);
  const currentUserId = useAuthStore(state => state.user?.id);
  const sessionGenerationRef = useRef(sessionGeneration);
  sessionGenerationRef.current = sessionGeneration;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [pendingAttachments, renderPendingAttachments] = React.useState<readonly PendingAttachment[]>([]);
  const pendingAttachmentsRef = useRef<readonly PendingAttachment[]>([]);
  const setPendingAttachments = (update: (current: readonly PendingAttachment[]) => readonly PendingAttachment[]) => {
    pendingAttachmentsRef.current = update(pendingAttachmentsRef.current);
    renderPendingAttachments(pendingAttachmentsRef.current);
  };
  const [sentDraftVersion, setSentDraftVersion] = useState<OperatorDraftVersion | null>(null);
  const pendingAttachmentIds = useRef(0);
  const activeUploads = useRef(new Set<string>());
  useEffect(() => () => { activeUploads.current.clear(); }, [sessionGeneration]);
  const visiblePendingAttachments = pendingAttachments.filter(attachment => attachment.sessionGeneration === sessionGeneration);
  const reply = draft.body;
  const isInternal = draft.mode === 'internal';
  const [suggestion, setSuggestion] = React.useState<string | null>(null);
  const mentionedUserIds = draft.mentionedUserIds ?? [];
  // The existing roster is already bounded server-side; selection has its own 16-person cap.
  const mentionCandidates = (agents ?? []).filter(agent => agent.id !== currentUserId);
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [staleReplyReview, setStaleReplyReview] = useState<StaleReplyReview | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [knowledgeArticles, setKnowledgeArticles] = useState<KnowledgeDoc[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState(false);
  const knowledgeLoaded = useRef(false);
  const [knowledgeAttempt, setKnowledgeAttempt] = useState(0);
  const [knowledgeInserting, setKnowledgeInserting] = useState<string | null>(null);
  const qaChanging = useRef(false);
  const [qaPending, setQaPending] = useState(false);
  const submission = useRef(false);
  const idempotency = useRef<{ intent: string; key: string } | null>(null);
  const changing = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const contextHeadingRef = useRef<HTMLHeadingElement>(null);
  const conversationHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusedConversation = useRef(false);
  const [focusContext, setFocusContext] = useState(false);
  const ticketSelectRefs = useRef<Record<TicketSelectControl, HTMLButtonElement | null>>({
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
  const [supportStateDraft, setSupportStateDraft] = useState({ definitionId: '', waitingReason: '', nextAction: '', snoozedUntil: '' });
  const [supportStateError, setSupportStateError] = useState<string | null>(null);
  const [supportStateNotice, setSupportStateNotice] = useState<string | null>(null);
  const supportStateSelect = useRef<HTMLButtonElement>(null);
  const supportStateDraftDirty = useRef(false);
  const supportStateFlight = useRef(false);
  const [isSupportStateSubmitting, setIsSupportStateSubmitting] = useState(false);
  const selectedSupportStateDefinition = supportStates.find(candidate => candidate.id === supportStateDraft.definitionId);
  const supportStateReadFailed = supportState.isError;
  const supportStatesReadFailed = Boolean(supportStatesReadError) && !isLoadMoreSupportStatesError;
  const supportStateReadsUnconfirmed = supportStateReadFailed || supportStatesReadFailed;
  const supportStateOptions = React.useMemo(() => [
    ...(!selectedSupportStateDefinition && supportState.data?.definition_id === supportStateDraft.definitionId
      ? [{ value: supportStateDraft.definitionId, label: `${supportState.data.internal_label} (${supportState.data.lifecycle}) — state details loading` }]
      : []),
    ...supportStates.map(state => ({ value: state.id, label: `${state.internal_label} (${state.legacy_status})` })),
  ], [selectedSupportStateDefinition, supportState.data, supportStateDraft.definitionId, supportStates]);
  const assignedToOptions = React.useMemo(() => [{ value: '', label: 'Unassigned' }, ...(agents ?? []).map(agent => ({ value: agent.id, label: agent.full_name || agent.email }))], [agents]);
  const groupOptions = React.useMemo(() => [{ value: '', label: 'No Group' }, ...(groups ?? []).map(group => ({ value: group.id, label: group.name }))], [groups]);
  const customerHistoryEvents = customerHistory.data?.events ?? [];
  const selectedSupportStateNeedsDetails = Boolean(supportState.data?.definition_id) && !selectedSupportStateDefinition;

  const restoreSupportStateDraft = (current = supportState.data) => {
    if (!current) return;
    supportStateDraftDirty.current = false;
    setSupportStateDraft({ definitionId: current.definition_id, waitingReason: current.waiting_reason ?? '', nextAction: current.next_action ?? '', snoozedUntil: current.snoozed_until ? browserInstantToDateTimeLocal(current.snoozed_until) : '' });
  };

  const updateSupportStateDraft = (change: Partial<{ definitionId: string; waitingReason: string; nextAction: string; snoozedUntil: string }>) => {
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
    const trigger = ticketSelectRefs.current[control];
    // Ark's trigger is a real disabled button during confirmation. Wait until
    // the confirmed read has also released that state before returning focus.
    if (!trigger || trigger.disabled) return;
    pendingTicketSelectFocus.current = null;
    const restore = () => {
      if (mounted.current && trigger.isConnected && !trigger.disabled && (document.activeElement === document.body || ticketSelectOwnsFocus(control))) trigger.focus();
    };
    restore();
    // Ark can finish its popup-close focus work after this layout effect.
    window.setTimeout(restore, 0);
  }, [ticketSelectVersions, isConfirmingTicketSelect, ticketMutationPending, pendingTicketSelectRefresh]);

  const ticketSelectContains = (control: TicketSelectControl, target: Element) => {
    const trigger = ticketSelectRefs.current[control];
    if (!trigger) return false;
    const root = trigger.closest('[data-scope="select"][data-part="root"]');
    if (root?.contains(target)) return true;
    const contentId = trigger.getAttribute('aria-controls');
    return Boolean(contentId && target.closest('[data-scope="select"][data-part="content"]')?.id === contentId);
  };

  const ticketSelectOwnsFocus = (control: TicketSelectControl) => {
    const active = document.activeElement;
    return Boolean(active && ticketSelectContains(control, active));
  };

  const refreshTicketSelect = (control: TicketSelectControl, restoreFocus = false, allowCurrentFocus = true) => {
    // Remount the Park Select after the authoritative mutation/refetch so its
    // trigger and hidden form value share that revision. Restore trigger focus
    // only when the operator still owns it.
    if (restoreFocus || (allowCurrentFocus && ticketSelectOwnsFocus(control))) {
      pendingTicketSelectFocus.current = control;
    }
    setTicketSelectVersions(previous => ({ ...previous, [control]: previous[control] + 1 }));
  };

  const retryTicketDetail = async (trigger?: HTMLElement) => {
    if (changing.current) return;
    changing.current = true;
    setIsConfirmingTicketSelect(true);
    const retryOwnedFocus = trigger !== undefined && document.activeElement === trigger;
    let focusMoved = false;
    const onFocusIn = (event: Event) => { if (event.target !== trigger && event.target !== document.body) focusMoved = true; };
    const onPointerDown = (event: Event) => { if (event.target !== trigger) focusMoved = true; };
    const onBlur = () => {
      // An explicit blur while the retry button still exists relinquishes focus.
      // A successful read can remove the button and leave body focused instead.
      queueMicrotask(() => { if (trigger?.isConnected) focusMoved = true; });
    };
    if (retryOwnedFocus && trigger) {
      document.addEventListener('focusin', onFocusIn, true);
      document.addEventListener('pointerdown', onPointerDown, true);
      trigger.addEventListener('blur', onBlur);
    }
    try {
      const confirmation = await refetch({ throwOnError: true });
      confirmedResolve(confirmation.data?.pages[0]?.status);
      if (pendingTicketSelectRefresh) {
        const control = pendingTicketSelectRefresh;
        setPendingTicketSelectRefresh(null);
        // The recovery control is removed after a successful read. Return focus
        // to the refreshed select only if the retry still owned it.
        const restoreFocus = retryOwnedFocus && !focusMoved;
        refreshTicketSelect(control, restoreFocus);
        setNotice('Ticket details saved.');
      }
    } catch {
      // Keep recovery available even if a background read clears the query error.
    } finally {
      if (retryOwnedFocus && trigger) {
        document.removeEventListener('focusin', onFocusIn, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
        trigger.removeEventListener('blur', onBlur);
      }
      changing.current = false;
      setIsConfirmingTicketSelect(false);
    }
  };

  // Filter presence to find other agents viewing this ticket and deduplicate by userId
  const viewers = viewersForTicket(id);
  const typing = typingForTicket(id);

  useEffect(() => {
    if (!ticket || error || (workspace.status !== 'restored' && workspace.status !== 'saved') || workspace.selectedTicketId === id) return;
    workspace.update({ selectedTicketId: id });
  }, [id, ticket, error, workspace]);

  useEffect(() => {
    if (ticket && workspaceBackHref && !focusedConversation.current) {
      focusedConversation.current=true;
      conversationHeadingRef.current?.focus();
    }
  }, [ticket,workspaceBackHref]);

  useEffect(() => {
    if (!focusContext || workspace.panel !== 'details') return;
    contextHeadingRef.current?.focus();
    setFocusContext(false);
  }, [focusContext, workspace.panel]);

  const customerHistoryLabel = (event: TicketHistoryEvent): string => {
    if (event.kind === 'ticket.intake') return 'Ticket intake';
    if (event.kind === 'ticket.assignment_changed') return 'Ticket assignment changed';
    if (event.kind === 'ticket.state_changed') return 'Ticket state changed';
    if (event.kind === 'message.reply') return 'Message reply';
    return `Conversation event: ${event.kind}`;
  };

  const customerHistoryActor = (event: TicketHistoryEvent): string => {
    if (event.actor.kind === 'customer') return 'Customer';
    if (event.actor.kind === 'api-key') return 'System';
    return 'Support staff';
  };

  useEffect(() => {
    updateLocation(`ticket:${id}`);
    return () => { updateLocation(null); stopTyping(id); };
  }, [draft.baseConversationRevision, id, stopTyping, updateLocation]);

  useEffect(() => {
    if (lastMessage?.type === 'article.created' && String(lastMessage.payload?.ticket_id ?? lastMessage.payload?.ticketId) === String(id)) {
      void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    }
  }, [lastMessage, id, queryClient]);

  const handleTicketChange = async (changes: TicketChanges, control?: TicketSelectControl) => {
    if (changing.current || assignmentBlocked || (control && pendingTicketSelectRefresh)) return;
    changing.current = true;
    let movedFocus = false;
    const focusMoved = (event: Event) => {
      if (!control || !(event.target instanceof Element)) return;
      if (!ticketSelectContains(control, event.target)) movedFocus = true;
    };
    if (control) {
      document.addEventListener('focusin', focusMoved, true);
      document.addEventListener('pointerdown', focusMoved, true);
    }
    setChangeError(null);
    setNotice('');
    try {
      if (control === 'assigned_to') {
        await assignResponsibleOwner.mutateAsync({ id, ownerId: changes.assigned_to ?? null,
          expectedOwnerId: ticket?.assigned_to ?? null, idempotencyKey: crypto.randomUUID() });
      } else {
        await updateTicket.mutateAsync({ id, ...changes });
      }
      pendingAdvance.current = changes.status === 'resolved' && preferences?.advanceAfterResolve ? onResolved ?? null : null;
      if (control) {
        setIsConfirmingTicketSelect(true);
        try {
          const confirmation = await refetch({ throwOnError: true });
          confirmedResolve(confirmation.data?.pages[0]?.status);
          refreshTicketSelect(control, false, !movedFocus);
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
      if (error instanceof Error && error.name !== 'AbortError') {
        setChangeError(error.message);
        // A rejected selection keeps its original trigger. Ark may still be
        // closing the popup, so return focus after that work settles.
        if (control && !movedFocus) window.setTimeout(() => {
          const trigger = ticketSelectRefs.current[control];
          if (mounted.current && trigger?.isConnected && !trigger.disabled && (document.activeElement === document.body || ticketSelectOwnsFocus(control))) trigger.focus();
        }, 0);
      }
    } finally {
      if (control) {
        document.removeEventListener('focusin', focusMoved, true);
        document.removeEventListener('pointerdown', focusMoved, true);
      }
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
    setChangeError(null);
    try {
      const data = await dashboardApi.get<{ suggestion: string }>(`/knowledge/tickets/${id}/ai-suggest`);
      setSuggestion(data.suggestion);
    } catch {
      setChangeError('AI suggestion could not be generated. Try again.');
    } finally {
      setIsGeneratingSuggestion(false);
    }
  };

  useEffect(() => {
    if (workspace.panel !== 'details') { setKnowledgeLoading(false); return; }
    if (knowledgeLoaded.current) return;
    let active = true;
    setKnowledgeLoading(true);
    setKnowledgeError(false);
    void dashboardApi.get<KnowledgeDoc[]>('/knowledge/articles').then(articles => {
      if (active) {
        setKnowledgeArticles(articles.filter(article => article.status === 'active' && (article.tier === 'answer' || article.tier === 'sop')));
        knowledgeLoaded.current = true;
      }
    }).catch(() => { if (active) setKnowledgeError(true); }).finally(() => { if (active) setKnowledgeLoading(false); });
    return () => { active = false; };
  }, [workspace.panel, knowledgeAttempt]);

  const knowledgeDraftLifecycle = useRef(0);
  const cancelKnowledgeInsertion = () => {
    knowledgeDraftLifecycle.current += 1;
    setKnowledgeInserting(null);
  };

  const insertKnowledgeArticle = async (article: KnowledgeDoc) => {
    if (knowledgeInserting || submission.current || isSubmitting || draft.status === 'loading') return;
    const identity = assignmentIdentity();
    const lifecycle = knowledgeDraftLifecycle.current;
    const current = () => mounted.current && assignmentIdentity() === identity && knowledgeDraftLifecycle.current === lifecycle;
    setKnowledgeInserting(article.id);
    setChangeError(null);
    try {
      const source = await dashboardApi.get<{ content: string }>(`/knowledge/articles/${encodeURIComponent(article.id)}/content`);
      if (!current() || submission.current) return;
      const snapshot = draft.currentSnapshot();
      if (!snapshot || snapshot.status === 'loading') return;
      const content = source.content.trim();
      if (!content) { setChangeError('This knowledge article has no insertable content.'); return; }
      const body = snapshot.body;
      const nextBody = body.trim() ? `${body.replace(/\s+$/, '')}\n\n${content}` : content;
      if (!updateDraft({ body: nextBody })) return;
      setNotice(`Inserted knowledge: ${article.title}`);
      requestAnimationFrame(() => {
        if (!current()) return;
        const editor = document.getElementById('reply-message') as (HTMLElement & { setSelectionRange?: (start: number, end: number) => void }) | null;
        editor?.focus();
        if (editor && typeof editor.setSelectionRange === 'function') {
          editor.setSelectionRange(nextBody.length, nextBody.length);
        } else if (editor) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });
    } catch (error) {
      if (!current()) return;
      setChangeError(error instanceof ApiError && [401, 403, 404].includes(error.status)
        ? 'Knowledge content is unavailable for this tenant or session.'
        : 'Knowledge content could not be loaded. Try again.');
      } finally { if (current()) setKnowledgeInserting(null); }
    };

  
  const submitSupportState = async (event?: React.FormEvent, snoozedUntilOverride?: string | null) => {
    event?.preventDefault();
    if (supportStateFlight.current || assignmentBlocked || supportStateReadsUnconfirmed) return;
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
      const snoozedUntil = snoozedUntilOverride === undefined
        ? (supportStateDraft.snoozedUntil ? browserDateTimeLocalToInstant(supportStateDraft.snoozedUntil) : null)
        : snoozedUntilOverride;
      const saved = await transitionSupportState.mutateAsync({ ticketId: id, definitionId: definition.id, waitingReason: waitingReason || null, nextAction: nextAction || null, snoozedUntil, expectedRevision: current.revision });
      restoreSupportStateDraft(saved);
      setSupportStateNotice('Support state saved.');
      pendingAdvance.current = definition.legacy_status === 'resolved' && preferences?.advanceAfterResolve ? onResolved ?? null : null;
      if (pendingAdvance.current) {
        try { const confirmation = await refetch({ throwOnError: true }); confirmedResolve(confirmation.data?.pages[0]?.status); }
        catch { setAdvanceConfirmationRequired(true); setSupportStateNotice('Support state saved. Confirm the ticket before advancing.'); }
      }
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
    const snapshot = draft.currentSnapshot();
    if (!snapshot || snapshot.status === 'loading') return false;
    draft.update(current => ({
      mode: changes.mode ?? current.mode,
      body: changes.body ?? current.body,
      bodyFormat: changes.bodyFormat ?? current.bodyFormat,
      attachments: changes.attachments ?? current.attachments,
      mentionedUserIds: changes.mentionedUserIds ?? current.mentionedUserIds ?? [],
      baseConversationRevision: current.baseConversationRevision,
    }));
    if (changes.body !== undefined) announceTyping(id, draft.baseConversationRevision, changes.body.trim().length > 0);
    return true;
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
      // Draft subscriptions can render before ordinary component state. Promote
      // the pending and saved lists together, without an intermediate duplicate.
      flushSync(() => {
        draft.update(current => ({ ...current, attachments: current.attachments.some(attachment => attachment.storageKey === uploaded.storageKey)
          ? current.attachments : [...current.attachments, uploaded] }));
        activeUploads.current.delete(pending.id);
        setPendingAttachments(currentAttachments => currentAttachments.filter(attachment => attachment.id !== pending.id));
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (sessionGenerationRef.current !== pending.sessionGeneration || !activeUploads.current.has(pending.id)) return;
      setPendingAttachments(currentAttachments => currentAttachments.map(attachment =>
        attachment.id === pending.id ? { ...attachment, status: 'error' } : attachment));
    }
  };

  const addAttachments = (files: readonly File[]) => {
    const snapshot = draft.currentSnapshot();
    if (submission.current || !snapshot || snapshot.status === 'loading') return;
    if (!replyCapability) { setNotice('Reply options are unavailable. Retry loading them before attaching files.'); return; }
    const allowed = files.filter(file => file.size <= replyCapability.attachments.maxBytesPerFile && (replyCapability.attachments.contentTypes as readonly string[]).includes(file.type));
    const rejected = files.length - allowed.length;
    const available = replyCapability.attachments.maxCount - snapshot.attachments.length - pendingAttachmentsRef.current.filter(attachment => attachment.sessionGeneration === sessionGeneration).length;
    const selected = allowed.slice(0, Math.max(0, available));
    if (!selected.length) {
      setNotice(rejected ? 'Files were not attached: their type or size is not allowed for this reply.' : `A draft can include at most ${replyCapability.attachments.maxCount} attachments.`);
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
    setNotice(`${selected.length} attachment${selected.length === 1 ? '' : 's'} selected and uploading.${rejected ? ` ${rejected} rejected because their type or size is not allowed.` : ''}`);
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
    cancelKnowledgeInsertion();
    activeUploads.current.clear();
    setPendingAttachments(current => current.map(attachment => ({ ...attachment, status: 'error' })));
    const result = await draft.discard();
    stopTyping(id);
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

  const refreshConversationForStaleReply = async () => {
    if (submission.current || staleReplyReview === 'refreshing') return;
    setStaleReplyReview('refreshing');
    setNotice('');
    try {
      // Bracket the ticket read with two server-derived revisions. The ticket
      // response is a real read between them, so matching values prove no
      // material event arrived before, during, or after that rendered review.
      // The following rebase remains a separate explicit action so the
      // operator can review the material without losing local draft edits.
      const before = await replyCapabilities.refetch({ throwOnError: true });
      const beforeCollision = before.data?.collision;
      if (!beforeCollision) {
        setStaleReplyReview(null);
        setReplyError('Collision-safe replies are unavailable for this session. Your draft is retained.');
        return;
      }
      const refreshed = await refetch({ throwOnError: true });
      // Article reads are ascending. Do not acknowledge a revision until the
      // operator has deliberately loaded the bounded remaining pages, so the
      // newest material is actually on screen for review.
      if (refreshed.data?.pages.at(-1)?.pagination?.has_more) {
        setStaleReplyReview('retry');
        setReplyError('More messages are available. Load them, then refresh and review the conversation before rebasing. Your draft is retained.');
        return;
      }
      const after = await replyCapabilities.refetch({ throwOnError: true });
      const afterCollision = after.data?.collision;
      if (!afterCollision) {
        setStaleReplyReview(null);
        setReplyError('Collision-safe replies are unavailable for this session. Your draft is retained.');
        return;
      }
      if (beforeCollision.conversationRevision !== afterCollision.conversationRevision) {
        setStaleReplyReview('retry');
        setReplyError('The conversation changed while it was being refreshed. Your draft is retained; refresh and review the latest material before rebasing.');
        return;
      }
      // The ticket response is rendered by the query update above before this
      // exact reviewed revision is made available to the separate rebase action.
      setStaleReplyReview(afterCollision.conversationRevision);
      setReplyError('The latest conversation is shown below. Review it, then rebase the saved draft when ready.');
    } catch (error) {
      setStaleReplyReview(null);
      setReplyError(error instanceof Error ? `${error.message}. Your draft is retained.` : 'Could not refresh the conversation. Your draft is retained.');
    }
  };

  const rebaseReviewedStaleDraft = async () => {
    if (submission.current || typeof staleReplyReview !== 'number') return;
    setNotice('');
    if (await draft.rebase(staleReplyReview)) {
      idempotency.current = null;
      setStaleReplyReview(null);
      setReplyError(null);
      setNotice('Draft rebased to the reviewed conversation. Review the draft, then send manually.');
    } else {
      setStaleReplyReview(null);
      setReplyError('The conversation or saved draft changed again. Your draft is retained; refresh and review before rebasing.');
    }
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (assignmentBlocked || !reply.trim() || submission.current || sentDraftVersion) return;
    if (staleReplyReview) {
      setReplyError('Review the refreshed conversation and rebase the saved draft before sending. Your draft is retained.');
      return;
    }
    if (!replyCapability || !replyCapability.body.acceptedFormats.includes(draft.bodyFormat) || reply.length > replyCapability.body.maxCharacters) {
      setReplyError('Reply options do not allow this message. Review its format and length or retry loading reply options.'); return;
    }
    if (visiblePendingAttachments.some(attachment => attachment.status === 'uploading')) return;
    const failedAttachments = visiblePendingAttachments.filter(attachment => attachment.status === 'error');
    if (failedAttachments.length) {
      failedAttachments.forEach(retryAttachment);
      setNotice('Retrying failed attachment uploads before sending.');
      return;
    }
    cancelKnowledgeInsertion();
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
      const collision = replyCapabilities.data?.collision;
      const precondition = collision ? {
        generation: sendingDraft.version.generation, revision: sendingDraft.version.revision,
        baseConversationRevision: sendingDraft.baseConversationRevision,
      } : undefined;
      const intent = JSON.stringify({ ticketId: id, draft: precondition, mode: sendingDraft.mode, body: sendingDraft.body,
        bodyFormat: sendingDraft.bodyFormat, mentionedUserIds: sendingDraft.mode === 'internal' && replyCapabilities.data?.internalMentions ? (sendingDraft.mentionedUserIds ?? []) : [], attachments: sendingDraft.attachments.map(({ storageKey, filename, size, contentType }) => ({ storageKey, filename, size, contentType })) });
      if (!idempotency.current || idempotency.current.intent !== intent) idempotency.current = { intent, key: crypto.randomUUID() };
      const article = await dashboardApi.post<{ id?: string }>(`/tickets/${id}/articles`, {
        body: sendingDraft.body,
        body_format: sendingDraft.bodyFormat,
        is_internal: sendingDraft.mode === 'internal',
        attachments: sendingDraft.attachments,
        ...(sendingDraft.mode === 'internal' && replyCapabilities.data?.internalMentions && (sendingDraft.mentionedUserIds?.length ?? 0) ? { mentioned_user_ids: sendingDraft.mentionedUserIds } : {}),
        ...(precondition ? { draft: precondition } : {}),
      }, { headers: { 'Idempotency-Key': idempotency.current.key } });
      if (!article?.id) throw new Error('The reply was not confirmed.');
      stopTyping(id);
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
          if (error instanceof ApiError && error.status === 409 && error.code === 'staff_reply_stale' && replyCapabilities.data?.collision) {
          setStaleReplyReview('retry');
          setReplyError('The saved draft or conversation changed. Review and rebase before sending; your draft is retained.');
        } else setReplyError(`${error.message}. Your draft is retained. Refresh the conversation before trying again if delivery is uncertain.`);
      }
    } finally {
      submission.current = false;
      setIsSubmitting(false);
    }
  };

  const detailStyles = ParkTicketDetail();
  if (isLoading) return <div role="status" aria-label="Loading conversation" className={css({ display: 'grid', gap: '4', minH: '64', p: '5' })}>
    <span className={css({ srOnly: true })}>Loading conversation…</span>
    <ParkSkeleton aria-hidden="true" height="8" width="60%" />
    <ParkSkeleton aria-hidden="true" height="20" width="100%" />
    <ParkSkeleton aria-hidden="true" height="20" width="86%" />
    <ParkSkeleton aria-hidden="true" height="24" width="100%" />
  </div>;
  if (!ticket) return <ParkEmptyState
    role="alert" className={detailStyles.unavailable} title={error instanceof ApiError && error.status === 404 ? 'Ticket not found.' : error instanceof ApiError && error.status === 403 ? 'You do not have access to this ticket.' : 'Could not load ticket. Please try again.'}
    description="The conversation could not be displayed. Retry loading it or return to the list."
    action={<div className={css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2', maxW: 'full' })}>
      <ParkButton type="button" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect} onClick={(event) => void retryTicketDetail(event.currentTarget)}>Retry loading ticket</ParkButton>
      <ParkLink asChild><Link to={workspaceBackHref??'/inbox/all'} className={css({ minW: 0, minH: '6', maxW: 'full', overflowWrap: 'anywhere' })}>{workspaceBackHref?'Back to conversations':'Back to Inbox'}</Link></ParkLink>
    </div>}
  />;
  const reference = ticketReference(ticket, ticketPrefix);

  return (
    <>
      <DraftNavigationGuard pending={draftNavigationPending} flush={flushDraftBeforeNavigation}
        failureMessage="Your draft or workspace preferences are not saved. Stay on this ticket, retry or restore preferences, then navigate again."
        retryLabel="Retry navigation" />
      <div data-panel={workspace.panel === 'details' ? 'details' : 'conversation'} className={detailStyles.root}>
      <div className={detailStyles.main}>
        {((error && !isFetchNextPageError) || pendingTicketSelectRefresh) && <ParkAlert.Root role={error ? 'alert' : 'status'} status={error ? 'error' : 'warning'}>
          <ParkAlert.Content><ParkAlert.Description>
            {error ? 'Could not refresh this ticket. Showing the last confirmed details. ' : 'Confirm the saved ticket details before making another change. '}
            <ParkButton type="button" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect} onClick={(event) => void retryTicketDetail(event.currentTarget)}>Retry loading ticket</ParkButton>
          </ParkAlert.Description></ParkAlert.Content>
        </ParkAlert.Root>}
        {changeError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{changeError}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
        {supportStateError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{supportStateError} <ParkButton type="button" onClick={() => void refreshSupportState()}>Refresh current support state</ParkButton></ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
        {notice && <ParkAlert.Root status="info"><ParkAlert.Content><ParkAlert.Description role="status">{notice}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
        {supportStateNotice && <ParkAlert.Root status="info"><ParkAlert.Content><ParkAlert.Description role="status">{supportStateNotice}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
        {advanceConfirmationRequired && <ParkButton type="button" disabled={isConfirmingTicketSelect} onClick={event => void retryTicketDetail(event.currentTarget)}>Confirm resolved ticket</ParkButton>}
        {(workspace.status === 'saving' || workspace.status === 'saved' || workspace.status === 'error' || workspace.status === 'conflict') && <ParkAlert.Root role={workspace.status === 'error' || workspace.status === 'conflict' ? 'alert' : 'status'} status={workspace.status === 'error' ? 'error' : workspace.status === 'conflict' ? 'warning' : workspace.status === 'saved' ? 'success' : 'info'}>
          <ParkAlert.Content><ParkAlert.Description>
            {workspace.status === 'saving' && 'Saving workspace preference…'}
            {workspace.status === 'saved' && 'Workspace preference saved.'}
            {workspace.status === 'error' && <>{workspace.error} <ParkButton type="button" onClick={() => workspace.retrySave()}>Retry workspace preference</ParkButton></>}
            {workspace.status === 'conflict' && <>{workspace.error} <ParkButton type="button" onClick={() => workspace.restoreServerState()}>Restore server preferences</ParkButton></>}
          </ParkAlert.Description></ParkAlert.Content>
        </ParkAlert.Root>}
        <div className={detailStyles.toolbar}>
          <ParkLink asChild variant="plain"><Link to={workspaceBackHref??'/inbox/all'} className={`${detailStyles.back} ${css({ minW: 0, maxW: 'full', flexShrink: '1', whiteSpace: 'normal', overflowWrap: 'anywhere' })}`}>
            <ArrowLeft className={css({ w: '5', h: '5', flexShrink: 0 })} />
            {workspaceBackHref?'Back to conversations':'Back to Inbox'}
          </Link></ParkLink>
          <div className={detailStyles.controls}>
            <ParkButton type="button" ref={contextTriggerRef} aria-expanded={workspace.panel === 'details'} aria-controls="ticket-context-panel"
              onClick={() => {
                contextApplied.current = true;
                const opening = workspace.panel !== 'details';
                if (opening) setFocusContext(true);
                else contextTriggerRef.current?.focus();
                workspace.update({ panel: opening ? 'details' : 'conversation' });
              }}>
              {workspace.panel === 'details' ? 'Hide ticket context' : 'Show ticket context'}
            </ParkButton>
            <DashboardSelect
              key={`ticket-status-${ticketSelectVersions.status}`}
              triggerRef={node => { ticketSelectRefs.current.status = node; }}
              aria-label="Status" disabled={ticketMutationPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
              value={ticket.status}
              onValueChange={(value) => {
                if (changing.current || assignmentBlocked || pendingTicketSelectRefresh) return;
                void handleTicketChange({ status: value as TicketChanges['status'] }, 'status');
              }}
              className={detailStyles.control}
              options={statusOptions}
            />
          </div>
        </div>

        <TicketSlaActionBar ticketId={ticket.id} />
        <ParkCollapsible.Root open={showSupportState} onOpenChange={({ open }) => setShowSupportState(open)} className={css({ mb: '2' })}>
          <ParkCollapsible.Trigger asChild><ParkButton type="button" variant="plain" className={css({ minH: '9' })}>Manage support state</ParkButton></ParkCollapsible.Trigger>
          <ParkCollapsible.Content>
            {showSupportState && supportState.isLoading && <div role="status" aria-label="Loading current support state" className={css({ display: 'grid', gap: '2', p: '3' })}><span className={css({ srOnly: true })}>Loading current support state…</span><ParkSkeleton aria-hidden="true" height="4" width="70%" /><ParkSkeleton aria-hidden="true" height="4" width="90%" /></div>}
            {showSupportState && supportStateReadFailed && !supportState.data && <ParkEmptyState role="alert" headingLevel={3} title="Current support state could not be loaded" description="Retry before managing this ticket's support state." action={<ParkButton type="button" onClick={() => void supportState.refetch()}>Retry current support state</ParkButton>} />}
            {showSupportState && supportStateReadFailed && supportState.data && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Title>Current support state could not be refreshed</ParkAlert.Title><ParkAlert.Description>The last confirmed state and your local input are retained. Retry before saving.</ParkAlert.Description><ParkButton type="button" onClick={() => void supportState.refetch()}>Retry current support state</ParkButton></ParkAlert.Content></ParkAlert.Root>}
            {showSupportState && supportStatesReadFailed && supportStatesUpdatedAt === 0 && <ParkEmptyState role="alert" headingLevel={3} title="Support-state definitions could not be loaded" description="The current ticket state remains visible. Retry to load its available transitions." action={<ParkButton type="button" onClick={() => void refetchSupportStates()}>Retry support-state definitions</ParkButton>} />}
            {showSupportState && supportStatesReadFailed && supportStatesUpdatedAt > 0 && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Title>Support-state definitions could not be refreshed</ParkAlert.Title><ParkAlert.Description>The last loaded definitions and your local input are retained. Retry before saving.</ParkAlert.Description><ParkButton type="button" onClick={() => void refetchSupportStates()}>Retry support-state definitions</ParkButton></ParkAlert.Content></ParkAlert.Root>}
            {showSupportState && supportState.data && typeof supportState.data.definition_id === 'string' && <form onSubmit={submitSupportState} className={detailStyles.supportStateForm} aria-label="Support state">
          <div className={detailStyles.supportStateHeader}><h2 className={detailStyles.contextFieldLabel}>Support state</h2><p className={detailStyles.supportStateHelp}>Internal state and waiting facts are visible to staff only. Customer-facing label: {supportState.data.public_label}</p></div>
          <DashboardSelect triggerRef={supportStateSelect} label="Support state" aria-label="Support state" value={supportStateDraft.definitionId} disabled={isSupportStateSubmitting || isLoadingSupportStates || supportStateReadsUnconfirmed} onValueChange={definitionId => updateSupportStateDraft({ definitionId })} className={css({ w: 'full' })}
            options={supportStateOptions} />
          {isLoadingSupportStates && <div role="status" aria-label="Loading support-state definitions" className={css({ display: 'grid', gap: '2' })}><span className={css({ srOnly: true })}>Loading support-state definitions…</span><ParkSkeleton aria-hidden="true" height="4" width="75%" /></div>}
          <div className={detailStyles.supportStateFields}>
            <Field.Root className={detailStyles.contextField}><Field.Label htmlFor={`${customFieldPrefix}-waiting-reason`}>Waiting reason{selectedSupportStateDefinition ? selectedSupportStateDefinition.waiting_reason_required ? ' (required)' : ' (optional)' : ' (state details loading)'}</Field.Label><ParkInput id={`${customFieldPrefix}-waiting-reason`} aria-label="Waiting reason" aria-required={Boolean(selectedSupportStateDefinition?.waiting_reason_required)} disabled={isSupportStateSubmitting} value={supportStateDraft.waitingReason} onChange={event => updateSupportStateDraft({ waitingReason: event.target.value })} maxLength={512} className={css({ w: 'full' })} /></Field.Root>
            <Field.Root className={detailStyles.contextField}><Field.Label htmlFor={`${customFieldPrefix}-next-action`}>Next action{selectedSupportStateDefinition ? selectedSupportStateDefinition.next_action_required ? ' (required)' : ' (optional)' : ' (state details loading)'}</Field.Label><ParkInput id={`${customFieldPrefix}-next-action`} aria-label="Next action" aria-required={Boolean(selectedSupportStateDefinition?.next_action_required)} disabled={isSupportStateSubmitting} value={supportStateDraft.nextAction} onChange={event => updateSupportStateDraft({ nextAction: event.target.value })} maxLength={512} className={css({ w: 'full' })} /></Field.Root>
          </div>
          <div className={detailStyles.supportStateFields}>
            <Field.Root className={detailStyles.contextField}><Field.Label htmlFor={`${customFieldPrefix}-snooze-until`}>Snooze until (your local time)</Field.Label>
              <ParkInput id={`${customFieldPrefix}-snooze-until`} type="datetime-local" aria-label="Snooze until (your local time)" disabled={isSupportStateSubmitting} value={supportStateDraft.snoozedUntil} onChange={event => updateSupportStateDraft({ snoozedUntil: event.target.value })} className={css({ w: 'full' })} />
            </Field.Root>
            <p className={css({ color: 'text.muted', fontSize: 'sm' })}>The shared queue will resurface this ticket at the selected local time.</p>
            <div className={detailStyles.supportStateActions}>
              <ParkButton type="button" disabled={isSupportStateSubmitting || assignmentBlocked || supportStateReadsUnconfirmed || !selectedSupportStateDefinition || !supportStateDraft.snoozedUntil} onClick={() => void submitSupportState(undefined, browserDateTimeLocalToInstant(supportStateDraft.snoozedUntil))} className={css({ minH: '10' })}>Snooze ticket</ParkButton>
              {supportState.data.snoozed_until && <ParkButton type="button" disabled={isSupportStateSubmitting || assignmentBlocked || supportStateReadsUnconfirmed || !selectedSupportStateDefinition} onClick={() => void submitSupportState(undefined, null)} className={css({ minH: '10' })}>Unsnooze ticket</ParkButton>}
            </div>
            {supportState.data.snoozed_until && <p role="status" className={css({ color: 'text.muted', fontSize: 'sm' })}>Snoozed until {new Date(supportState.data.snoozed_until).toLocaleString()}.</p>}
          </div>
          {selectedSupportStateNeedsDetails && <p role="status" className={css({ color: 'text.muted', fontSize: 'sm' })}>Load the current support-state definition before saving.</p>}
          <div className={detailStyles.supportStateActions}><ParkButton type="submit" disabled={isSupportStateSubmitting || assignmentBlocked || supportStateReadsUnconfirmed || !selectedSupportStateDefinition} aria-disabled={isSupportStateSubmitting || assignmentBlocked || supportStateReadsUnconfirmed || !selectedSupportStateDefinition} className={detailStyles.modeButton}>Save support state</ParkButton><ParkButton type="button" disabled={isSupportStateSubmitting} onClick={() => void refreshSupportState()} variant="plain">Refresh current state</ParkButton>{supportStateDraftDirty.current && <ParkButton type="button" disabled={isSupportStateSubmitting} onClick={discardSupportStateDraft} variant="plain">Discard local changes</ParkButton>}</div>
          {hasMoreSupportStates && <ParkButton type="button" aria-disabled={isLoadingMoreSupportStates} onClick={() => void loadMoreSupportStates()} variant="plain">{isLoadingMoreSupportStates ? 'Loading more support states…' : 'Load more support states'}</ParkButton>}
          {isLoadMoreSupportStatesError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>Could not load more support states. Try again.</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
            </form>}
          </ParkCollapsible.Content>
        </ParkCollapsible.Root>

        <div className={css({ display: 'flex', minW: 0, minH: '42rem', flex: '1 1 auto', flexShrink: 0, flexDirection: 'column', overflow: 'hidden', bg: 'bg.surface' })}>
          <div className={detailStyles.header}>
            <div className={detailStyles.heading}>
              <div className={detailStyles.titleStack}>
                <div className={detailStyles.titleRow}>
                  <span className={detailStyles.reference} title={reference}>{reference}</span>
                  <h1 ref={conversationHeadingRef} tabIndex={-1} className={`${detailStyles.title} ${css({ whiteSpace: 'normal', overflowWrap: 'anywhere' })}`}>{ticket.subject}</h1>
                </div>
                <div className={detailStyles.meta}>
                  <span className={detailStyles.customer}>
                    <User className={css({ w: '3.5', h: '3.5', flexShrink: 0 })} />
                    {ticket.customer_email}
                  </span>
                  <span className={detailStyles.opened}>
                    <Clock className={css({ w: '3.5', h: '3.5', flexShrink: 0 })} />
                    Opened {utcTimestamp(ticket.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Presence Indicator */}
              <div className={detailStyles.presence}>
                {!workspaceBackHref && viewers.length > 0 && (
                  <div className={detailStyles.viewers}>
                    <div aria-hidden="true" className={detailStyles.avatars}>
                      {viewers.slice(0, 3).map((viewer, i) => (
                        <ParkAvatar
                          key={i}
                          size="sm"
                          title={`${viewer.name} is viewing this ticket`}
                        >
                          <ParkAvatarFallback name={viewer.name} />
                        </ParkAvatar>
                      ))}
                      {viewers.length > 3 && (
                        <span className={css({ color: 'fg.muted', fontSize: 'xs' })}>
                          +{viewers.length - 3}
                        </span>
                      )}
                    </div>
                    <span className={css({ position: 'absolute', w: '1px', h: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' })}>Viewing this ticket: {viewers.map(viewer => viewer.name).join(', ')}</span>
                    <span className={detailStyles.liveLabel}>
                      <span className={detailStyles.liveDot} />
                      Live Viewers
                    </span>
                  </div>
                )}
                {typing.length > 0 && (
                  <p className={detailStyles.typing}>
                    {typing.map(candidate => candidate.actor.name).join(', ')} {typing.length === 1 ? 'is' : 'are'} typing…
                  </p>
                )}
              </div>
            </div>
          </div>

          <ParkScrollArea.Root className={css({ minW: 0, minH: '12rem', flex: '1 1 12rem', bg: 'bg.canvas' })}>
            <ParkScrollArea.Viewport id="conversation-messages" className={css({ minH: 0, flex: '1', h: 'full' })}>
              <ParkScrollArea.Content className={css({ display: 'flex', minW: 0, flexDirection: 'column', gap: '4', p: { base: '4', md: '5' } })}>
            {ticket.articles.map((article) => (
              <div
                key={article.id}
                className={detailStyles.timelineRow}
              >
                <ParkAvatar size="md" aria-label={article.sender_type === 'agent' ? article.is_internal ? 'Private internal note' : 'Public operator reply' : article.sender_type === 'system' ? 'System event' : 'Customer message'}>
                  <ParkAvatarFallback name={article.sender_type === 'agent' ? 'Operator' : article.sender_type === 'system' ? 'System' : ticket.customer_email} />
                </ParkAvatar>
                <div data-sender={article.sender_type} data-internal={article.is_internal ? 'true' : 'false'} className={detailStyles.timelineBubble}>
                  <div className={detailStyles.timelineMeta}>
                    <span className={detailStyles.timelineLabel}>
                      {article.sender_type} {article.is_internal && '• Internal Note'}
                    </span>
                    <span className={detailStyles.timelineTime}>
                      {utcTimestamp(article.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {(ticket.source === 'email' || article.raw_email_id) && article.sender_type === 'customer' && (
                    <div className={detailStyles.emailPresentation}>
                      <div className={detailStyles.emailSummary}>
                        <Mail className={detailStyles.emailSummaryIcon} aria-hidden="true" />
                        <span className={detailStyles.emailSummaryLabel}>Email</span>
                        <span className={detailStyles.emailSummaryTime}>{utcTimestamp(article.created_at).toLocaleString()}</span>
                      </div>
                      <dl className={detailStyles.emailSummaryFields}>
                        <div><dt>From</dt><dd><span className={css({ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' })}>{ticket.customer_email}</span></dd></div>
                        <div><dt>To</dt><dd>Support queue</dd></div>
                        <div><dt>Subject</dt><dd><span className={css({ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' })}>{ticket.subject}</span></dd></div>
                      </dl>
                    </div>
                  )}
                  {/* Only explicitly versioned new content is interpreted as Markdown. */}
                  {article.body_format === 'markdown-v1'
                    ? <SafeMarkdown className={detailStyles.timelineBody}>{article.body ?? ''}</SafeMarkdown>
                    : <div className={`${detailStyles.timelineBody} ${css({ whiteSpace: 'pre-wrap' })}`}>{article.body ?? ''}</div>}
                  {(ticket.source === 'email' || article.raw_email_id) && article.sender_type === 'customer' && (
                    <ParkCollapsible.Root className={detailStyles.emailDisclosure}>
                      <ParkCollapsible.Trigger className={css({ cursor: 'pointer', color: 'text.primary', fontWeight: 'semibold', textAlign: 'left' })}>Show full email</ParkCollapsible.Trigger>
                      <ParkCollapsible.Content><div className={detailStyles.emailCopy}>
                        <p>Structured headers and quoted history are unavailable for this stored message.</p>
                        <p>Complete stored body is shown above.</p>
                        {article.raw_email_id && <p>Raw email reference: {article.raw_email_id}</p>}
                      </div></ParkCollapsible.Content>
                    </ParkCollapsible.Root>
                  )}

                  {/* Attachments */}
                  {article.attachments && article.attachments.length > 0 && (
                    <div className={detailStyles.attachments}>
                      {article.attachments.map((att: any) => {
                        const filename = (typeof att.filename === 'string' && att.filename)
                          || (typeof att.file_name === 'string' && att.file_name)
                          || 'Attachment';
                        const contentType = att.contentType ?? att.content_type;
                        const AttachmentGlyph = attachmentIcons[attachmentIconKind(filename, contentType)];
                        return <div key={att.id} className={css({ minW: 0, maxW: 'full' })}>
                          <ParkButton
                            onClick={(e) => { e.preventDefault(); dashboardApi.download(`/attachments/${att.id}/download`, filename); }}
                            className={detailStyles.attachmentLink}
                          >
                            <AttachmentGlyph className={detailStyles.attachmentIcon} />
                            <span className={detailStyles.attachmentName}>{filename}</span>
                            <span className={detailStyles.attachmentSize}>
                              {attachmentSize(att.size ?? att.file_size)}
                            </span>
                          </ParkButton>
                          <AuthenticatedAttachmentImage
                            ticketId={id}
                            attachmentId={att.id}
                            filename={filename}
                            contentType={contentType}
                            size={att.size ?? att.file_size}
                          />
                        </div>;
                      })}
                    </div>
                  )}

                  {article.qa_type === 'question' && <p className={detailStyles.legacyMarker}>Legacy Question marker retained. Compatibility review is required before changing this marker.</p>}
                  {/* QA Toggle Buttons */}
                  <div className={detailStyles.qa}>
                    <div className={detailStyles.qaActions}>
                      <ParkButton
                        aria-label="Mark as SOP (internal procedure)" aria-pressed={article.qa_type === 'sop'} disabled={qaPending || article.qa_type === 'question'}
                        onClick={() => handleToggleQa(article.id, article.qa_type === 'sop' ? null : 'sop')}
                        className={clsx(detailStyles.qaButton, article.qa_type === 'sop' ? detailStyles.qaButtonActive : detailStyles.qaButtonInactive)}
                      >
                        {article.qa_type === 'sop' && <Check aria-hidden="true" />}{article.qa_type === 'sop' ? 'SOP (internal)' : 'Mark as SOP (internal)'}
                      </ParkButton>
                      <ParkButton
                        aria-label="Mark as answer" aria-pressed={article.qa_type === 'answer'} disabled={qaPending || article.qa_type === 'question'}
                        onClick={() => handleToggleQa(article.id, article.qa_type === 'answer' ? null : 'answer')}
                        className={clsx(detailStyles.qaButton, article.qa_type === 'answer' ? detailStyles.qaButtonActive : detailStyles.qaButtonInactive)}
                      >
                        {article.qa_type === 'answer' && <Check aria-hidden="true" />}{article.qa_type === 'answer' ? 'Answer' : 'Mark as Answer'}
                      </ParkButton>
                    </div>
                    {article.qa_type && (
                      <span className={detailStyles.qaMarked}>
                        <ShieldCheck className={detailStyles.qaMarkedIcon} />
                        QA marked
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
              </ParkScrollArea.Content>
            </ParkScrollArea.Viewport>
            <ParkScrollArea.Scrollbar orientation="vertical" />
          </ParkScrollArea.Root>

          {ticket.pagination && <div className={detailStyles.pagination}>
            <ParkButton type="button" onClick={() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage({ cancelRefetch: false }); }} aria-disabled={!hasNextPage || isFetchingNextPage}
              aria-controls="conversation-messages" aria-busy={isFetchingNextPage}
              className={detailStyles.paginationButton}>
              {isFetchingNextPage ? 'Loading messages…' : hasNextPage ? 'Load more messages' : 'All messages loaded'}
            </ParkButton>
            <p role="status" aria-live="polite" className={detailStyles.status}>
              {isFetchNextPageError ? 'Could not load more messages. Try again.' : isFetchingNextPage ? 'Loading more messages…' : `Showing ${ticket.articles.length} messages.${hasNextPage ? ' More messages are available.' : ' All messages are loaded.'}`}
            </p>
          </div>}
          <div className={detailStyles.composerPanel}>
          {replyError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{replyError} {' '}
              {staleReplyReview ? <>
                {staleReplyReview === 'refreshing'
                  ? <span role="status">Refreshing the latest conversation…</span>
                  : typeof staleReplyReview !== 'number'
                    ? <ParkButton type="button" onClick={() => void refreshConversationForStaleReply()} variant="plain">Refresh and review conversation</ParkButton>
                    : <ParkButton type="button" aria-disabled={isSubmitting} onClick={() => void rebaseReviewedStaleDraft()} variant="plain">Rebase saved draft</ParkButton>}
              </> : <ParkButton type="button" onClick={() => void refetch()} variant="plain">Refresh conversation</ParkButton>}
            </ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
            {(draft.status !== 'idle' && draft.status !== 'discarded') && <ParkAlert.Root role={draft.status === 'error' || draft.status === 'conflict' ? 'alert' : 'status'} status={draft.status === 'error' ? 'error' : draft.status === 'conflict' ? 'warning' : draft.status === 'saved' ? 'success' : 'info'}>
              <ParkAlert.Content><ParkAlert.Description>
                {draft.status === 'loading' && 'Restoring your saved draft…'}
                {draft.status === 'unsaved' && 'Draft has unsaved changes.'}
                {draft.status === 'saving' && 'Saving draft…'}
                {draft.status === 'saved' && 'Draft saved.'}
                {draft.status === 'error' && (draft.error ?? 'Draft could not be saved.')}
                {draft.status === 'conflict' && (draft.error ?? 'Draft changed in another session. Review before discarding it.')}
              </ParkAlert.Description>
              <span className={detailStyles.draftActions}>
                {draft.status === 'error' && <ParkButton type="button" onClick={() => { draft.retryRestore(); draft.retrySave(); }} variant="plain">Retry draft</ParkButton>}
                {(draft.status === 'saved' || draft.status === 'unsaved' || draft.status === 'error' || draft.status === 'conflict') && <ParkButton type="button" aria-disabled={isSubmitting} onClick={() => void discardDraft()} variant="plain">Discard draft</ParkButton>}
              </span>
              </ParkAlert.Content>
            </ParkAlert.Root>}
            <form onSubmit={handleSubmitReply} className={`${detailStyles.composerForm} ${css({ gridTemplateColumns: 'minmax(0, 1fr)' })}`}>
              {sentDraftVersion && <p role="status">This reply was sent. Draft cleanup is still pending. <ParkButton type="button" aria-disabled={isSubmitting} onClick={() => void retrySentDraftCleanup()}>Retry sent-draft cleanup</ParkButton></p>}
              <div className={detailStyles.modeRow}>
                <ParkTabs.Root value={isInternal ? 'internal' : 'public'} onValueChange={({ value }) => {
                  if (submission.current || isSubmitting) return;
                  if (value === 'public') updateDraft({ mode: 'public', mentionedUserIds: [] });
                  else if (value === 'internal') updateDraft({ mode: 'internal' });
                }}>
                  <ParkTabs.List aria-label="Reply mode">
                    <ParkTabs.Trigger value="public" disabled={isSubmitting}>Public Reply</ParkTabs.Trigger>
                    <ParkTabs.Trigger value="internal" disabled={isSubmitting}>Internal Note</ParkTabs.Trigger>
                    <ParkTabs.Indicator />
                  </ParkTabs.List>
                  <ParkTabs.Content value="public" className={css({ srOnly: true })}>Public replies are visible to the customer.</ParkTabs.Content>
                  <ParkTabs.Content value="internal" className={css({ srOnly: true })}>Internal notes are private to staff.</ParkTabs.Content>
                </ParkTabs.Root>

                <ParkButton
                  type="button"
                  onClick={handleGetAiSuggestion}
                  disabled={isGeneratingSuggestion || isSubmitting}
                  className={detailStyles.modeButton}
                >
                  <Activity className={css({ w: '4', h: '4', flexShrink: 0 })} />
                  {isGeneratingSuggestion ? 'Thinking...' : 'AI Suggestion'}
                </ParkButton>
              </div>

              {suggestion && (
                <div className={detailStyles.suggestion}>
                  <div className={detailStyles.suggestionHeader}>
                    <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '2', fontSize: 'sm', fontWeight: 'semibold' })}>
                      <ShieldCheck className={css({ w: '4', h: '4', flexShrink: 0 })} />
                      AI Auto-Draft
                    </span>
                    <div className={detailStyles.suggestionActions}>
                      <ParkButton
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => updateDraft({ body: suggestion })}
                        className={css({ fontSize: 'sm' })}
                      >
                        Replace All
                      </ParkButton>
                      <ParkButton
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => updateDraft({ body: reply ? `${reply}\n\n${suggestion}` : suggestion })}
                        className={css({ fontSize: 'sm' })}
                      >
                        Append
                      </ParkButton>
                      <ParkButton
                        type="button"
                        aria-label="Dismiss suggested reply"
                        onClick={() => setSuggestion(null)}
                        className={css({ minW: '9', minH: '9' })}
                      >
                        <X className={css({ w: '4', h: '4', flexShrink: 0 })} />
                      </ParkButton>
                    </div>
                  </div>
                  <p className={detailStyles.suggestionCopy}>"{suggestion}"</p>
                </div>
              )}

              {!replyCapability ? <div role="status" className={detailStyles.replyCapability}>
                {replyCapabilities.isLoading ? <><span className={css({ srOnly: true })}>Loading reply options…</span><ParkSkeleton aria-hidden="true" height="4" width="70%" /></> : 'Reply options are unavailable.'}
                {replyCapabilities.isError && <ParkButton
                  type="button"
                  variant="plain"
                  className={css({ ml: '2' })}
                  onClick={() => void replyCapabilities.refetch()}
                >
                  Retry reply options
                </ParkButton>}
              </div> : <p className={css({ color: 'text.muted', fontSize: 'sm' })}>{replyCapability.channel === 'email'
                ? `Email reply to ${ticket.customer_email}. Delivery is attempted after saving.`
                : 'Internal note. No email is sent.'} Up to {replyCapability.attachments.maxCount} attachments, {replyCapability.attachments.maxBytesPerFile / 1024 / 1024} MB each.</p>}
              {isInternal && replyCapabilities.data?.internalMentions && <fieldset className={detailStyles.mentions}>
                <legend className={css({ fontWeight: 'semibold' })}>Mention colleagues</legend>
                <p id="mention-help" className={css({ color: 'text.muted', fontSize: 'sm' })}>Mentioned colleagues with current ticket access receive a private activity after this note is saved. Up to 16.</p>
                {mentionCandidates.length ? <div className={detailStyles.mentionList}>
                  {mentionCandidates.map(agent => {
                    const checked = mentionedUserIds.includes(agent.id);
                    return <ParkCheckbox.Root key={agent.id} className={detailStyles.mentionOption} checked={checked} disabled={isSubmitting}
                      onCheckedChange={() => updateDraft({ mentionedUserIds: checked ? mentionedUserIds.filter(id => id !== agent.id)
                        : mentionedUserIds.length < (replyCapabilities.data?.internalMentions?.maxRecipients ?? 0) ? [...mentionedUserIds, agent.id] : mentionedUserIds })}>
                      <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
                      <ParkCheckbox.Label>{agent.full_name || agent.email}</ParkCheckbox.Label>
                      <ParkCheckbox.HiddenInput aria-describedby="mention-help" />
                    </ParkCheckbox.Root>;
                  })}
                </div> : <p className={detailStyles.status}>No colleagues are available to mention.</p>}
              </fieldset>}
              <DashboardSelect label="Message format" aria-label="Message format" value={draft.bodyFormat ?? 'plain'} disabled={!replyCapability || isSubmitting || draft.status === 'loading'}
                  onValueChange={value => { if (!submission.current && (value === 'plain' || value === 'markdown-v1') && replyCapability?.body.acceptedFormats.includes(value)) updateDraft({ bodyFormat: value }); }}
                  className={css({ w: 'full' })}
                  options={[...(replyCapability?.body.acceptedFormats.includes('plain') ? [{ value: 'plain', label: 'Plain text' }] : []), ...(replyCapability?.body.acceptedFormats.includes('markdown-v1') ? [{ value: 'markdown-v1', label: 'Markdown' }] : [])]} />
              <RichComposer
                id="reply-message"
                value={reply}
                format={draft.bodyFormat ?? 'plain'}
                readOnly={isSubmitting || draft.status === 'loading'}
                mode={isInternal ? 'internal' : 'public'}
                onChange={body => {
                  // Tiptap can emit a synthetic input while mounting or
                  // synchronising controlled content. Do not turn an
                  // identical value into an unsaved draft, which would make
                  // an immediate ticket navigation appear blocked.
                  if (!submission.current && body !== draftRef.current.body) updateDraft({ body });
                }}
                onImageFiles={files => addAttachments(files)}
                onRejectedImageFiles={count => setNotice(`${count} image${count === 1 ? '' : 's'} was not attached. Use JPEG, PNG, GIF, or WebP images up to 10 MB.`)}
              />

              {(draft.attachments.length > 0 || visiblePendingAttachments.length > 0) && (
                <div className={detailStyles.composerAttachments}>
                  {draft.attachments.map(attachment => (
                    <div key={attachment.storageKey} className={detailStyles.composerAttachment}>
                      <Paperclip className={css({ w: '4', h: '4', flexShrink: 0 })} />
                      <span className={css({ minW: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{attachment.filename}</span>
                      <ParkButton
                        type="button"
                        aria-disabled={isSubmitting} aria-label={`Remove ${attachment.filename}`}
                        onClick={() => {
                          if (submission.current) return;
                          updateDraft({ attachments: draftRef.current.attachments.filter(candidate => candidate.storageKey !== attachment.storageKey) });
                          setNotice('Attachment removed.');
                          attachButtonRef.current?.focus();
                        }}
                        className={css({ minW: '8', minH: '8' })}
                      >
                        <X className={css({ w: '4', h: '4' })} />
                      </ParkButton>
                    </div>
                  ))}
                  {visiblePendingAttachments.map(attachment => (
                    <div key={attachment.id} className={detailStyles.composerAttachment}>
                      <Paperclip className={css({ w: '4', h: '4', flexShrink: 0 })} />
                      <span className={css({ minW: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{attachment.file.name}</span>
                      <span role={attachment.status === 'error' ? 'alert' : 'status'} className={css({ color: 'text.muted', fontSize: 'xs' })}>{attachment.status === 'uploading' ? 'Uploading…' : 'Upload failed.'}</span>
                      {attachment.status === 'error' && <ParkButton type="button" aria-disabled={isSubmitting} onClick={() => retryAttachment(attachment)} variant="plain">Retry upload</ParkButton>}
                      <ParkButton
                        type="button"
                        aria-disabled={isSubmitting} aria-label={`Remove ${attachment.file.name}`}
                        onClick={() => {
                          if (submission.current) return;
                          activeUploads.current.delete(attachment.id);
                          setPendingAttachments(current => current.filter(candidate => candidate.id !== attachment.id));
                          setNotice('Attachment removed.');
                          attachButtonRef.current?.focus();
                        }}
                        className={css({ minW: '8', minH: '8' })}
                      >
                        <X className={css({ w: '4', h: '4' })} />
                      </ParkButton>
                    </div>
                  ))}
                </div>
              )}

              <div className={detailStyles.composerFooter}>
                <p className={detailStyles.composerNote}>
                  <Info className={css({ w: '3.5', h: '3.5', flexShrink: 0 })} />
                  {isInternal
                    ? "Private note for team coordination."
                    : "Public replies are visible to the customer in this conversation."}
                </p>
                <div className={detailStyles.composerActions}>
                  <ParkFileUpload.Root
                    // The application owns the queued attachment lifecycle. Keep Ark's
                    // picker state empty so removed files do not consume maxFiles.
                    acceptedFiles={[]}
                    disabled={isSubmitting || !replyCapability}
                    maxFiles={replyCapability?.attachments.maxCount ?? 10}
                    allowDrop={false}
                    style={{ display: 'contents' }}
                  >
                    <ParkFileUpload.HiddenInput
                      ref={fileInputRef}
                      aria-label="Reply attachments"
                      multiple
                      onChange={event => {
                        if (submission.current) return;
                        const selectedFiles = Array.from(event.currentTarget.files ?? []);
                        if (selectedFiles.length) addAttachments(selectedFiles);
                        event.currentTarget.value = '';
                      }}
                    />
                    <ParkFileUpload.Trigger asChild>
                      <ParkButton
                        type="button"
                        ref={attachButtonRef}
                        aria-disabled={!replyCapability || isSubmitting} aria-label="Attach files"
                        className={css({ display: 'inline-flex', alignItems: 'center', gap: '2' })}
                        title="Attach files"
                      >
                        <Paperclip className={css({ w: '5', h: '5', flexShrink: 0 })} />
                      </ParkButton>
                    </ParkFileUpload.Trigger>
                  </ParkFileUpload.Root>
                  <ParkButton
                    type="submit"
                    variant="solid"
                    aria-disabled={assignmentBlocked || !replyCapability || !replyCapability.body.acceptedFormats.includes(draft.bodyFormat) || !reply.trim() || isSubmitting || visiblePendingAttachments.length > 0 || Boolean(sentDraftVersion) || Boolean(staleReplyReview)}
                    className={clsx(
                      css({ display: 'inline-flex', alignItems: 'center', gap: '2' }),
                      isInternal && css({ bg: 'warning.surface', color: 'warning' })
                    )}
                  >
                    <Send className={css({ w: '5', h: '5', flexShrink: 0 })} />
                    {isInternal ? "Add Note" : "Send Reply"}
                  </ParkButton>
                </div>
              </div>
            </form>
          </div>
        </div>
        <TicketActionBar reference={reference} actions={utilityActions.data?.actions ?? []} loading={utilityActions.isLoading}
          error={utilityActions.isError} retry={() => void utilityActions.refetch()} />
        <TicketSlaPanel ticketId={ticket.id} />
      </div>

      <aside id="ticket-context-panel" aria-label="Context" hidden={workspace.panel !== 'details'} className={detailStyles.contextPanel}>
        <ParkCollapsible.Root defaultOpen className={detailStyles.contextCard}>
          <ParkCollapsible.Trigger className={detailStyles.contextSummary}>
            <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '2' })}><User className={css({ w: '4', h: '4' })} />Customer</span>
          </ParkCollapsible.Trigger>
          <ParkCollapsible.Content><div className={detailStyles.contextBody}>
            <div>
              <p className={css({ color: 'text.muted', fontSize: 'xs', textTransform: 'uppercase', letterSpacing: 'wide' })}>Verified identity</p>
              <p className={css({ fontWeight: 'semibold', overflowWrap: 'anywhere' })}>{ticket.customer_email}</p>
              <p className={css({ color: 'text.muted', fontSize: 'xs' })}>Loaded from this tenant-scoped conversation.</p>
            </div>
            {customerHistory.isLoading ? (
              <div role="status" aria-label="Loading customer history" className={css({ display: 'grid', gap: '2', p: '3' })}><span className={css({ srOnly: true })}>Loading customer history…</span><ParkSkeleton aria-hidden="true" height="4" width="80%" /><ParkSkeleton aria-hidden="true" height="4" width="60%" /></div>
            ) : customerHistory.isError ? (
              <ParkEmptyState headingLevel={3} title="Customer history unavailable" description={customerHistory.error instanceof Error ? customerHistory.error.message : 'Try opening the conversation again.'} action={<ParkButton type="button" onClick={() => void customerHistory.refetch()}>Retry customer history</ParkButton>} />
            ) : customerHistoryEvents.length === 0 ? (
              <ParkEmptyState headingLevel={3} title="No linked customer history" description="No cross-channel identity match was made for this conversation." />
            ) : (
              <ul className={css({ display: 'grid', gap: '2', p: 0, listStyle: 'none' })}>
                {customerHistoryEvents.map((historyEvent) => (
                  <li key={historyEvent.id} className={css({ borderTopWidth: '1px', borderColor: 'border.default', pt: '2' })}>
                    <p className={css({ fontSize: 'sm', fontWeight: 'semibold' })}>{customerHistoryLabel(historyEvent)} — {customerHistoryActor(historyEvent)}</p>
                    <p className={css({ color: 'text.muted', fontSize: 'xs' })}>
                      {historyEvent.visibility} {historyEvent.source}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div></ParkCollapsible.Content>
        </ParkCollapsible.Root>

        <div className={detailStyles.contextSettingsCard}>
          <h3 ref={contextHeadingRef} tabIndex={-1} className={detailStyles.contextFieldLabel}>
            <Info className={detailStyles.attachmentIcon} />
            Ticket Details
          </h3>
          <div className={detailStyles.contextSettingsFields}>
            <div>
              <div className={detailStyles.contextFieldControl}>
                <DashboardSelect
                  key={`ticket-priority-${ticketSelectVersions.priority}`}
                  triggerRef={node => { ticketSelectRefs.current.priority = node; }}
                  id="ticket-priority" label="Priority" aria-label="Priority" disabled={ticketMutationPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.priority}
                  onValueChange={(value) => {
                    if (changing.current || assignmentBlocked || pendingTicketSelectRefresh) return;
                    void handleTicketChange({ priority: value as TicketChanges['priority'] }, 'priority');
                  }}
                  className={detailStyles.contextFieldControl}
                  options={priorityOptions}
                />
              </div>
            </div>
            <div>
              <div className={detailStyles.contextFieldControl}>
                <DashboardSelect
                  key={`ticket-assigned_to-${ticketSelectVersions.assigned_to}`}
                  triggerRef={node => { ticketSelectRefs.current.assigned_to = node; }}
                  id="ticket-assigned_to" label="Assigned To" aria-label="Assigned To" disabled={ticketMutationPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.assigned_to || ''}
                  onValueChange={(value) => {
                    if (changing.current || assignmentBlocked || pendingTicketSelectRefresh) return;
                    void handleTicketChange({ assigned_to: value || null }, 'assigned_to');
                  }}
                  className={detailStyles.contextFieldControl}
                  options={assignedToOptions}
                />
                <TicketAssignmentActions ticketId={id} ownerId={ticket.assigned_to ?? null}
                  agents={agents ?? []} fresh={isFetchedAfterMount && !isFetching && !error}
                  disabled={updateTicket.isPending || assignResponsibleOwner.isPending || isSupportStateSubmitting || isSubmitting || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  refreshTicket={refreshAssignment} onBlocked={setAssignmentBlocked} />
              </div>
            </div>
            <div>
              <div className={detailStyles.contextFieldControl}>
                <DashboardSelect
                  key={`ticket-group_id-${ticketSelectVersions.group_id}`}
                  triggerRef={node => { ticketSelectRefs.current.group_id = node; }}
                  id="ticket-group_id" label="Group" aria-label="Group" disabled={ticketMutationPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.group_id || ''}
                  onValueChange={(value) => {
                    if (changing.current || assignmentBlocked || pendingTicketSelectRefresh) return;
                    void handleTicketChange({ group_id: value || null }, 'group_id');
                  }}
                  className={detailStyles.contextFieldControl}
                  options={groupOptions}
                />
              </div>
            </div>

            {ticketFields && ticketFields.filter(f => f.is_active).length > 0 && (
              <div className={css({ display: 'grid', gap: '3', pt: '4', borderTopWidth: '1px', borderColor: 'border.default' })}>
                <h4 className={css({ fontSize: 'sm', fontWeight: 'semibold' })}>Custom Attributes</h4>
                <div className={css({ display: 'grid', gap: '3' })}>
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
                      <div key={field.id} className={detailStyles.contextField}>
                        {field.field_type === 'select' && field.options ? (
                          <DashboardSelect
                            id={inputId}
                            label={field.label}
                            aria-label={field.label}
                            value={String(value || '')}
                            onValueChange={handleSave}
                            className={detailStyles.contextFieldControl}
                            options={[{ value: '', label: 'Select...' }, ...field.options.split(',').map(s => s.trim()).filter(Boolean).map(opt => ({ value: opt, label: opt }))]}
                          />
                        ) : field.field_type === 'checkbox' ? (
                          <ParkCheckbox.Root checked={value === true || value === 'true'} onCheckedChange={({ checked }) => handleSave(checked === true)} className={css({ display: 'inline-flex', alignItems: 'center', gap: '2' })}>
                            <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
                            <ParkCheckbox.Label>{field.label}</ParkCheckbox.Label>
                            <ParkCheckbox.HiddenInput id={inputId} />
                          </ParkCheckbox.Root>
                        ) : (
                          <Field.Root>
                            <Field.Label htmlFor={inputId}>{field.label}</Field.Label>
                            <CustomFieldInput
                              id={inputId}
                              field={field}
                              value={value}
                              onSave={handleSave}
                            />
                          </Field.Root>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <ParkCollapsible.Root defaultOpen className={css({ mt: '4', p: '5', bg: 'bg.surface', borderWidth: '1px', borderColor: 'border.default', rounded: 'xl', boxShadow: 'sm' })}>
          <ParkCollapsible.Trigger className={secondaryDisclosureTrigger}>
            <span className={css({ display: 'flex', alignItems: 'center', gap: '2' })}><Activity className={css({ w: '4', h: '4', color: 'text.muted' })} />Operational context</span>
          </ParkCollapsible.Trigger>
          <ParkCollapsible.Content><ParkEmptyState headingLevel={3} title="Operational context unavailable" description="No operational source is connected for this ticket. Live SLA and routing details remain unavailable." /></ParkCollapsible.Content>
        </ParkCollapsible.Root>

        <ParkCollapsible.Root defaultOpen className={css({ mt: '4', p: '5', bg: 'bg.surface', borderWidth: '1px', borderColor: 'border.default', rounded: 'xl', boxShadow: 'sm' })}>
          <ParkCollapsible.Trigger className={secondaryDisclosureTrigger}>
            <span className={css({ display: 'flex', alignItems: 'center', gap: '2' })}><MessageSquare className={css({ w: '4', h: '4', color: 'text.muted' })} />Knowledge</span>
          </ParkCollapsible.Trigger>
          <ParkCollapsible.Content><div className={css({ display: 'grid', gap: '3', mt: '4' })}>
            {knowledgeLoading ? <div role="status" aria-label="Loading tenant knowledge" className={css({ display: 'grid', gap: '2' })}><span className={css({ srOnly: true })}>Loading tenant knowledge…</span><ParkSkeleton aria-hidden="true" height="4" width="80%" /><ParkSkeleton aria-hidden="true" height="4" width="60%" /></div>
              : knowledgeError ? <ParkEmptyState headingLevel={3} title="Knowledge temporarily unavailable" description="No content was inserted." action={<ParkButton type="button" onClick={() => setKnowledgeAttempt(attempt => attempt + 1)}>Retry knowledge</ParkButton>} />
              : knowledgeArticles.length === 0 ? <ParkEmptyState headingLevel={3} title="No eligible knowledge" description="No eligible internal knowledge articles are available." />
              : <p id="knowledge-insert-help" className={css({ color: 'fg.muted', fontSize: 'sm' })}>Select an article to append its verified content to the reply.</p>}
            {workspace.panel === 'details' && knowledgeArticles.length > 0 && <KnowledgeBrowser articles={knowledgeArticles} insertingId={knowledgeInserting}
              disabled={Boolean(knowledgeInserting) || isSubmitting || draft.status === 'loading'} onInsert={article => void insertKnowledgeArticle(article)} />}
          </div></ParkCollapsible.Content>
        </ParkCollapsible.Root>

        <ParkCollapsible.Root defaultOpen className={css({ mt: '4', p: '5', bg: 'bg.surface', borderWidth: '1px', borderColor: 'border.default', rounded: 'xl', boxShadow: 'sm' })}>
            <ParkCollapsible.Trigger className={secondaryDisclosureTrigger}>
              <span className={css({ display: 'flex', alignItems: 'center', gap: '2' })}><Eye className={css({ w: '4', h: '4', color: 'accent.primary' })} />Collaboration</span>
            </ParkCollapsible.Trigger>
            <ParkCollapsible.Content>
            {viewers.length > 0 ? <div className={css({ display: 'grid', gap: '3' })}>
              {viewers.map((viewer, i) => (
                <div key={i} className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
                  <ParkAvatar size="sm"><ParkAvatarFallback name={viewer.name} /></ParkAvatar>
                  <div>
                    <p className={css({ color: 'text.primary', fontSize: 'xs', fontWeight: 'bold' })}>{viewer.name}</p>
                    <p className={css({ display: 'flex', alignItems: 'center', gap: '1', color: 'text.muted', fontSize: 'xs', fontWeight: 'medium' })}>
                      <span className={css({ w: '2', h: '2', rounded: 'full', bg: 'info.text' })} />
                      Viewing
                    </p>
                  </div>
                </div>
              ))}
            </div> : <ParkEmptyState headingLevel={3} title="No current viewers" description="No collaborators are viewing this ticket." />}
            </ParkCollapsible.Content>
        </ParkCollapsible.Root>
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
      <ParkTextarea
        id={id}
        aria-label={field.label}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        className={css({ w: 'full', resize: 'vertical' })}
        rows={3}
      />
    );
  }

  return (
    <ParkInput
      id={id}
      aria-label={field.label}
      type="text"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      className={css({ w: 'full' })}
    />
  );
}
