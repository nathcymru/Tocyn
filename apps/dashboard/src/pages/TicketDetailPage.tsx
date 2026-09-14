import { useOptionalOperatorPreferencesContext } from '../components/theme/OperatorThemeProvider';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import { KnowledgeBrowser } from '../components/KnowledgeBrowser';
import { TicketAssignmentActions } from '../components/TicketAssignmentActions';
import { TicketSlaPanel } from '../components/TicketSlaPanel';
import { TicketSlaActionBar } from '../components/TicketSlaActionBar';
import { TicketActionBar } from '../components/TicketActionBar';
import { TocynButton, TocynInput, TocynTextarea, TocynSelect } from '@luminatick/ui/primitives';
import { ParkEmptyState, ParkInput, ParkSelect } from '@luminatick/ui/park';
import { attachmentSize } from '../utils/attachment-size';
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
  Send,
  User,
  ShieldCheck,
  Clock,
  MessageSquare,
  Eye,
  Info,
  Activity,
  X,
  Paperclip } from 'lucide-react';
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
    isLoadingMore: isLoadingMoreSupportStates,
    isLoadMoreError: isLoadMoreSupportStatesError,
  } = useSupportStates();
  const [showSupportState, setShowSupportState] = useState(Boolean(workspaceBackHref));
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
  const [supportStateDraft, setSupportStateDraft] = useState({ definitionId: '', waitingReason: '', nextAction: '', snoozedUntil: '' });
  const [supportStateError, setSupportStateError] = useState<string | null>(null);
  const [supportStateNotice, setSupportStateNotice] = useState<string | null>(null);
  const supportStateSelect = useRef<HTMLSelectElement>(null);
  const supportStateDraftDirty = useRef(false);
  const supportStateFlight = useRef(false);
  const [isSupportStateSubmitting, setIsSupportStateSubmitting] = useState(false);
  const selectedSupportStateDefinition = supportStates.find(candidate => candidate.id === supportStateDraft.definitionId);
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
      const confirmation = await refetch({ throwOnError: true });
      confirmedResolve(confirmation.data?.pages[0]?.status);
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
        const editor = document.getElementById('reply-message') as HTMLTextAreaElement | null;
        editor?.focus();
        editor?.setSelectionRange(nextBody.length, nextBody.length);
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
    if (supportStateFlight.current || assignmentBlocked) return;
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

  if (isLoading) return <div role="status" className="tocyn-ticket-detail-loading">Loading ticket...</div>;
  if (!ticket) return <ParkEmptyState
    role="alert" className="tocyn-ticket-detail-unavailable" title={error instanceof ApiError && error.status === 404 ? 'Ticket not found.' : error instanceof ApiError && error.status === 403 ? 'You do not have access to this ticket.' : 'Could not load ticket. Please try again.'}
    description="The conversation could not be displayed. Retry loading it or return to the list."
    action={<div><TocynButton type="button" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect} onClick={(event) => void retryTicketDetail(event.currentTarget)} className="tocyn-ticket-detail-retry">Retry loading ticket</TocynButton>
      <Link to={workspaceBackHref??'/tickets'} className="tocyn-ticket-detail-back">{workspaceBackHref?'Back to conversations':'Back to Tickets'}</Link></div>}
  />;
  const reference = ticketReference(ticket, ticketPrefix);

  return (
    <>
      <DraftNavigationGuard pending={draftNavigationPending} flush={flushDraftBeforeNavigation}
        failureMessage="Your draft or workspace preferences are not saved. Stay on this ticket, retry or restore preferences, then navigate again." />
      <div className="tocyn-ticket-detail-grid">
      <div className="tocyn-ticket-detail-main">
        {((error && !isFetchNextPageError) || pendingTicketSelectRefresh) && <div role={error ? 'alert' : 'status'} className="tocyn-ticket-detail-alert">
          {error ? 'Could not refresh this ticket. Showing the last confirmed details. ' : 'Confirm the saved ticket details before making another change. '}
          <TocynButton type="button" aria-disabled={updateTicket.isPending || isConfirmingTicketSelect} onClick={(event) => void retryTicketDetail(event.currentTarget)} className="tocyn-ticket-detail-inline-action">Retry loading ticket</TocynButton>
        </div>}
        {changeError && <p role="alert" className="tocyn-ticket-detail-alert">{changeError}</p>}
        {supportStateError && <p role="alert" className="tocyn-ticket-detail-alert">{supportStateError} <TocynButton type="button" onClick={() => void refreshSupportState()} className="tocyn-ticket-detail-inline-action">Refresh current support state</TocynButton></p>}
        {notice && <p role="status" className="tocyn-ticket-detail-notice">{notice}</p>}
        {supportStateNotice && <p role="status" className="tocyn-ticket-detail-notice">{supportStateNotice}</p>}
        {advanceConfirmationRequired && <TocynButton type="button" disabled={isConfirmingTicketSelect} onClick={event => void retryTicketDetail(event.currentTarget)}>Confirm resolved ticket</TocynButton>}
        {(workspace.status === 'saving' || workspace.status === 'saved' || workspace.status === 'error' || workspace.status === 'conflict') && <p role={workspace.status === 'error' || workspace.status === 'conflict' ? 'alert' : 'status'} className="tocyn-ticket-detail-status">
          {workspace.status === 'saving' && 'Saving workspace preference…'}
          {workspace.status === 'saved' && 'Workspace preference saved.'}
          {workspace.status === 'error' && <>{workspace.error} <TocynButton type="button" onClick={() => workspace.retrySave()} className="tocyn-ticket-detail-inline-action">Retry workspace preference</TocynButton></>}
          {workspace.status === 'conflict' && <>{workspace.error} <TocynButton type="button" onClick={() => workspace.restoreServerState()} className="tocyn-ticket-detail-inline-action">Restore server preferences</TocynButton></>}
        </p>}
        <div className="tocyn-ticket-detail-toolbar">
          <Link to={workspaceBackHref??'/tickets'} className={clsx("tocyn-ticket-detail-back",workspaceBackHref&&"tocyn-ticket-detail-back--mobile-only")}>
            <ArrowLeft className="tocyn-ticket-detail-icon-md" />
            {workspaceBackHref?'Back to conversations':'Back to Tickets'}
          </Link>
          <div className="tocyn-ticket-detail-controls">
            <TocynButton type="button" ref={contextTriggerRef} aria-expanded={workspace.panel === 'details'} aria-controls="ticket-context-panel"
              onClick={() => {
                contextApplied.current = true;
                const opening = workspace.panel !== 'details';
                if (opening) setFocusContext(true);
                else contextTriggerRef.current?.focus();
                workspace.update({ panel: opening ? 'details' : 'conversation' });
              }} className="tocyn-ticket-detail-context-button">
              {workspace.panel === 'details' ? 'Hide ticket context' : 'Show ticket context'}
            </TocynButton>
            <TocynSelect
              key={`ticket-status-${ticketSelectVersions.status}`}
              ref={node => { ticketSelectRefs.current.status = node; }}
              aria-label="Status" aria-disabled={ticketMutationPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
              value={ticket.status}
              onChange={(e) => {
                if (changing.current || assignmentBlocked || pendingTicketSelectRefresh) { e.currentTarget.value = ticket.status; return; }
                void handleTicketChange({ status: e.target.value as TicketChanges['status'] }, 'status');
              }}
              className="tocyn-ticket-detail-select"
            >
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </TocynSelect>
          </div>
        </div>

        <TicketActionBar reference={reference} actions={utilityActions.data?.actions ?? []} loading={utilityActions.isLoading}
          error={utilityActions.isError} retry={() => void utilityActions.refetch()} />
        <TicketSlaActionBar ticketId={ticket.id} />
        <TicketSlaPanel ticketId={ticket.id} />
        {!showSupportState && <TocynButton type="button" onClick={() => setShowSupportState(true)} className="tocyn-ticket-detail-secondary-action">Manage support state</TocynButton>}
        {showSupportState && supportState.isLoading && <p role="status" className="tocyn-support-state-loading">Loading current support state…</p>}
        {showSupportState && supportState.data && typeof supportState.data.definition_id === 'string' && <form onSubmit={submitSupportState} className="tocyn-support-state-form" aria-label="Support state">
          <div className="tocyn-support-state-header"><h2 className="tocyn-support-state-form-title">Support state</h2><p className="tocyn-support-state-description">Internal state and waiting facts are visible to staff only. Customer-facing label: {supportState.data.public_label}</p></div>
          <label className="tocyn-form-field">State
            <TocynSelect ref={supportStateSelect} aria-label="Support state" value={supportStateDraft.definitionId} disabled={isSupportStateSubmitting || isLoadingSupportStates} aria-disabled={isSupportStateSubmitting || isLoadingSupportStates} onChange={event => updateSupportStateDraft({ definitionId: event.target.value })} className="tocyn-ticket-detail-select">
              {!selectedSupportStateDefinition && supportState.data?.definition_id === supportStateDraft.definitionId && <option value={supportStateDraft.definitionId}>{supportState.data.internal_label} ({supportState.data.lifecycle}) — state details loading</option>}
              {supportStates.map(state => <option key={state.id} value={state.id}>{state.internal_label} ({state.legacy_status})</option>)}
            </TocynSelect>
          </label>
          {isLoadingSupportStates && <p role="status" className="tocyn-ticket-detail-status">Loading support-state definitions…</p>}
          <div className="tocyn-support-state-fields">
            <label className="tocyn-form-field">Waiting reason{selectedSupportStateDefinition ? selectedSupportStateDefinition.waiting_reason_required ? ' (required)' : ' (optional)' : ' (state details loading)'}<TocynInput aria-label="Waiting reason" aria-required={Boolean(selectedSupportStateDefinition?.waiting_reason_required)} disabled={isSupportStateSubmitting} value={supportStateDraft.waitingReason} onChange={event => updateSupportStateDraft({ waitingReason: event.target.value })} maxLength={512} className="tocyn-ticket-detail-select" /></label>
            <label className="tocyn-form-field">Next action{selectedSupportStateDefinition ? selectedSupportStateDefinition.next_action_required ? ' (required)' : ' (optional)' : ' (state details loading)'}<TocynInput aria-label="Next action" aria-required={Boolean(selectedSupportStateDefinition?.next_action_required)} disabled={isSupportStateSubmitting} value={supportStateDraft.nextAction} onChange={event => updateSupportStateDraft({ nextAction: event.target.value })} maxLength={512} className="tocyn-ticket-detail-select" /></label>
          </div>
          <div className="tocyn-support-state-snooze">
            <label className="tocyn-form-field">Snooze until (your local time)
              <TocynInput type="datetime-local" aria-label="Snooze until (your local time)" disabled={isSupportStateSubmitting} value={supportStateDraft.snoozedUntil} onChange={event => updateSupportStateDraft({ snoozedUntil: event.target.value })} className="tocyn-ticket-detail-datetime" />
            </label>
            <p className="tocyn-ticket-detail-help">The shared queue will resurface this ticket at the selected local time.</p>
            <div className="tocyn-support-state-actions">
              <TocynButton type="button" disabled={isSupportStateSubmitting || assignmentBlocked || !selectedSupportStateDefinition || !supportStateDraft.snoozedUntil} onClick={() => void submitSupportState(undefined, browserDateTimeLocalToInstant(supportStateDraft.snoozedUntil))} className="tocyn-ticket-detail-primary-outline">Snooze ticket</TocynButton>
              {supportState.data.snoozed_until && <TocynButton type="button" disabled={isSupportStateSubmitting || assignmentBlocked || !selectedSupportStateDefinition} onClick={() => void submitSupportState(undefined, null)} className="tocyn-ticket-detail-secondary-action">Unsnooze ticket</TocynButton>}
            </div>
            {supportState.data.snoozed_until && <p role="status" className="tocyn-ticket-detail-status">Snoozed until {new Date(supportState.data.snoozed_until).toLocaleString()}.</p>}
          </div>
          {selectedSupportStateNeedsDetails && <p role="status" className="tocyn-ticket-detail-status">Load the current support-state definition before saving.</p>}
          <div className="tocyn-support-state-actions"><TocynButton type="submit" disabled={isSupportStateSubmitting || assignmentBlocked || !selectedSupportStateDefinition} aria-disabled={isSupportStateSubmitting || assignmentBlocked || !selectedSupportStateDefinition} className="tocyn-support-state-submit">Save support state</TocynButton><TocynButton type="button" disabled={isSupportStateSubmitting} onClick={() => void refreshSupportState()} className="tocyn-ticket-detail-inline-action">Refresh current state</TocynButton>{supportStateDraftDirty.current && <TocynButton type="button" disabled={isSupportStateSubmitting} onClick={discardSupportStateDraft} className="tocyn-ticket-detail-inline-action">Discard local changes</TocynButton>}</div>
          {hasMoreSupportStates && <TocynButton type="button" aria-disabled={isLoadingMoreSupportStates} onClick={() => void loadMoreSupportStates()} className="tocyn-ticket-detail-inline-action">{isLoadingMoreSupportStates ? 'Loading more support states…' : 'Load more support states'}</TocynButton>}
          {isLoadMoreSupportStatesError && <p role="alert" className="tocyn-ticket-detail-load-more-error">Could not load more support states. Try again.</p>}
        </form>}

        <div className="tocyn-ticket-detail-card">
          <div className="tocyn-ticket-detail-header">
            <div className="tocyn-ticket-detail-heading">
              <div className="tocyn-ticket-detail-title-stack">
                <div className="tocyn-ticket-detail-title-row">
                  <span className="tocyn-ticket-detail-reference" title={reference}>{reference}</span>
                  <h1 ref={conversationHeadingRef} tabIndex={-1} className="tocyn-ticket-detail-title">{ticket.subject}</h1>
                </div>
                <div className="tocyn-ticket-detail-meta">
                  <span className="tocyn-ticket-detail-customer">
                    <User className="tocyn-ticket-detail-icon-xs" />
                    {ticket.customer_email}
                  </span>
                  <span className="tocyn-ticket-detail-opened">
                    <Clock className="tocyn-ticket-detail-icon-xs" />
                    Opened {utcTimestamp(ticket.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Presence Indicator */}
              <div className="tocyn-ticket-detail-presence">
                {!workspaceBackHref && viewers.length > 0 && (
                  <div className="tocyn-ticket-detail-viewers">
                    <div aria-hidden="true" className="tocyn-ticket-detail-avatars">
                      {viewers.slice(0, 3).map((viewer, i) => (
                        <div
                          key={i}
                          className="tocyn-ticket-detail-avatar"
                          title={`${viewer.name} is viewing this ticket`}
                        >
                          {viewer.name[0]}
                        </div>
                      ))}
                      {viewers.length > 3 && (
                        <div className="tocyn-ticket-detail-avatar tocyn-ticket-detail-avatar-more">
                          +{viewers.length - 3}
                        </div>
                      )}
                    </div>
                    <span className="sr-only">Viewing this ticket: {viewers.map(viewer => viewer.name).join(', ')}</span>
                    <span className="tocyn-ticket-detail-live-label">
                      <span className="tocyn-ticket-detail-live-dot" />
                      Live Viewers
                    </span>
                  </div>
                )}
                {typing.length > 0 && (
                  <p className="tocyn-ticket-detail-typing">
                    {typing.map(candidate => candidate.actor.name).join(', ')} {typing.length === 1 ? 'is' : 'are'} typing…
                  </p>
                )}
              </div>
            </div>
          </div>

          <div id="conversation-messages" className="tocyn-ticket-detail-messages">
            {ticket.articles.map((article) => (
              <div
                key={article.id}
                className={clsx(
                  "tocyn-timeline-row",
                  article.sender_type === 'agent' && "is-agent"
                )}
              >
                <div className={clsx(
                  "tocyn-timeline-avatar",
                  article.sender_type === 'agent' ? "tocyn-timeline-avatar-agent" : "tocyn-timeline-avatar-customer",
                  article.is_internal && "tocyn-timeline-avatar-internal"
                )}>
                  {article.sender_type === 'agent' ? 'A' : article.sender_type === 'system' ? 'S' : 'C'}
                </div>
                <div className={clsx(
                  "tocyn-timeline-bubble",
                  article.sender_type === 'agent'
                    ? "tocyn-timeline-bubble-agent"
                    : "tocyn-timeline-bubble-customer",
                  article.is_internal && "tocyn-timeline-bubble-internal"
                )}>
                  <div className="tocyn-timeline-meta">
                    <span className="tocyn-timeline-label">
                      {article.sender_type} {article.is_internal && '• Internal Note'}
                    </span>
                    <span className="tocyn-timeline-time">
                      {utcTimestamp(article.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {/* Only explicitly versioned new content is interpreted as Markdown. */}
                  {article.body_format === 'markdown-v1'
                    ? <SafeMarkdown className="tocyn-timeline-body">{article.body ?? ''}</SafeMarkdown>
                    : <div className="tocyn-timeline-body tocyn-timeline-body-plain">{article.body ?? ''}</div>}

                  {/* Attachments */}
                  {article.attachments && article.attachments.length > 0 && (
                    <div className="tocyn-timeline-attachments">
                      {article.attachments.map((att: any) => {
                        const filename = att.filename || att.file_name || 'Attachment';
                        return <div key={att.id}>
                          <TocynButton
                            onClick={(e) => { e.preventDefault(); dashboardApi.download(`/attachments/${att.id}/download`, filename); }}
                            className={clsx(
                              "tocyn-timeline-attachment-link",
                              article.sender_type === 'agent'
                                ? "tocyn-timeline-attachment-link-agent"
                                : "tocyn-timeline-attachment-link-customer",
                              article.is_internal && "tocyn-timeline-attachment-link-internal"
                            )}
                          >
                            <Paperclip className="tocyn-timeline-attachment-icon" />
                            <span className="tocyn-timeline-attachment-name">{filename}</span>
                            <span className="tocyn-timeline-attachment-size">
                              {attachmentSize(att.size ?? att.file_size)}
                            </span>
                          </TocynButton>
                          <AuthenticatedAttachmentImage
                            ticketId={id}
                            attachmentId={att.id}
                            filename={filename}
                            contentType={att.contentType ?? att.content_type}
                            size={att.size ?? att.file_size}
                          />
                        </div>;
                      })}
                    </div>
                  )}

                  {article.qa_type === 'question' && <p className="tocyn-timeline-legacy-marker">Legacy Question marker retained. Compatibility review is required before changing this marker.</p>}
                  {/* QA Toggle Buttons */}
                  <div className="tocyn-timeline-qa">
                    <div className="tocyn-timeline-qa-actions">
                      <TocynButton
                        aria-label="Mark as SOP (internal procedure)" aria-pressed={article.qa_type === 'sop'} disabled={qaPending || article.qa_type === 'question'}
                        onClick={() => handleToggleQa(article.id, article.qa_type === 'sop' ? null : 'sop')}
                        className={clsx(
                          "tocyn-timeline-qa-button",
                          article.qa_type === 'sop' ? "tocyn-timeline-qa-button-active" : "tocyn-timeline-qa-button-inactive"
                        )}
                      >
                        {article.qa_type === 'sop' ? '✓ SOP (internal)' : 'Mark as SOP (internal)'}
                      </TocynButton>
                      <TocynButton
                        aria-label="Mark as answer" aria-pressed={article.qa_type === 'answer'} disabled={qaPending || article.qa_type === 'question'}
                        onClick={() => handleToggleQa(article.id, article.qa_type === 'answer' ? null : 'answer')}
                        className={clsx(
                          "tocyn-timeline-qa-button",
                          article.qa_type === 'answer' ? "tocyn-timeline-qa-button-active" : "tocyn-timeline-qa-button-inactive"
                        )}
                      >
                        {article.qa_type === 'answer' ? '✓ Answer' : 'Mark as Answer'}
                      </TocynButton>
                    </div>
                    {article.qa_type && (
                      <span className="tocyn-timeline-qa-marked">
                        <ShieldCheck className="tocyn-timeline-qa-marked-icon" />
                        QA marked
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {ticket.pagination && <div className="tocyn-ticket-pagination">
            <TocynButton type="button" onClick={() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage({ cancelRefetch: false }); }} aria-disabled={!hasNextPage || isFetchingNextPage}
              aria-controls="conversation-messages" aria-busy={isFetchingNextPage}
              className="tocyn-ticket-pagination-button">
              {isFetchingNextPage ? 'Loading messages…' : hasNextPage ? 'Load more messages' : 'All messages loaded'}
            </TocynButton>
            <p role="status" aria-live="polite" className="tocyn-ticket-detail-status">
              {isFetchNextPageError ? 'Could not load more messages. Try again.' : isFetchingNextPage ? 'Loading more messages…' : `Showing ${ticket.articles.length} messages.${hasNextPage ? ' More messages are available.' : ' All messages are loaded.'}`}
            </p>
          </div>}
          <div className="tocyn-ticket-composer-panel">
            {replyError && <p role="alert" className="tocyn-ticket-composer-alert">{replyError} {' '}
              {staleReplyReview ? <>
                {staleReplyReview === 'refreshing'
                  ? <span role="status">Refreshing the latest conversation…</span>
                  : typeof staleReplyReview !== 'number'
                    ? <TocynButton type="button" onClick={() => void refreshConversationForStaleReply()} className="tocyn-ticket-detail-inline-action">Refresh and review conversation</TocynButton>
                    : <TocynButton type="button" aria-disabled={isSubmitting} onClick={() => void rebaseReviewedStaleDraft()} className="tocyn-ticket-detail-inline-action">Rebase saved draft</TocynButton>}
              </> : <TocynButton type="button" onClick={() => void refetch()} className="tocyn-ticket-detail-inline-action">Refresh conversation</TocynButton>}
            </p>}
            {(draft.status !== 'idle' && draft.status !== 'discarded') && <div role={draft.status === 'error' || draft.status === 'conflict' ? 'alert' : 'status'} className={clsx(
              'tocyn-ticket-composer-draft-status',
              draft.status === 'error' || draft.status === 'conflict' ? 'tocyn-ticket-composer-draft-status-error' : 'tocyn-ticket-composer-draft-status-neutral'
            )}>
              <span>
                {draft.status === 'loading' && 'Restoring your saved draft…'}
                {draft.status === 'unsaved' && 'Draft has unsaved changes.'}
                {draft.status === 'saving' && 'Saving draft…'}
                {draft.status === 'saved' && 'Draft saved.'}
                {draft.status === 'error' && (draft.error ?? 'Draft could not be saved.')}
                {draft.status === 'conflict' && (draft.error ?? 'Draft changed in another session. Review before discarding it.')}
              </span>
              <span className="tocyn-ticket-composer-draft-actions">
                {draft.status === 'error' && <TocynButton type="button" onClick={() => { draft.retryRestore(); draft.retrySave(); }} className="tocyn-ticket-detail-inline-action">Retry draft</TocynButton>}
                {(draft.status === 'saved' || draft.status === 'unsaved' || draft.status === 'error' || draft.status === 'conflict') && <TocynButton type="button" aria-disabled={isSubmitting} onClick={() => void discardDraft()} className="tocyn-ticket-detail-inline-action">Discard draft</TocynButton>}
              </span>
            </div>}
            <form onSubmit={handleSubmitReply} className="tocyn-ticket-composer-form">
              {sentDraftVersion && <p role="status">This reply was sent. Draft cleanup is still pending. <TocynButton type="button" aria-disabled={isSubmitting} onClick={() => void retrySentDraftCleanup()} className="underline">Retry sent-draft cleanup</TocynButton></p>}
              <div className="tocyn-ticket-composer-mode-row">
                <div className="tocyn-ticket-composer-mode-group">
                  <TocynButton
                    type="button"
                    aria-disabled={isSubmitting} aria-pressed={!isInternal}
                    onClick={() => { if (!submission.current) updateDraft({ mode: 'public', mentionedUserIds: [] }); }}
                    className={clsx(
                      "tocyn-ticket-composer-mode-button",
                      !isInternal ? "tocyn-ticket-composer-mode-button-public" : "tocyn-ticket-composer-mode-button-inactive"
                    )}
                  >
                    Public Reply
                  </TocynButton>
                  <TocynButton
                    type="button"
                    aria-disabled={isSubmitting} aria-pressed={isInternal}
                    onClick={() => { if (!submission.current) updateDraft({ mode: 'internal' }); }}
                    className={clsx(
                      "tocyn-ticket-composer-mode-button",
                      isInternal ? "tocyn-ticket-composer-mode-button-internal" : "tocyn-ticket-composer-mode-button-inactive"
                    )}
                  >
                    Internal Note
                  </TocynButton>
                </div>

                <TocynButton
                  type="button"
                  onClick={handleGetAiSuggestion}
                  disabled={isGeneratingSuggestion || isSubmitting}
                  className="tocyn-ticket-composer-suggestion-button"
                >
                  <Activity className="tocyn-ticket-detail-icon-sm" />
                  {isGeneratingSuggestion ? 'Thinking...' : 'AI Suggestion'}
                </TocynButton>
              </div>

              {suggestion && (
                <div className="tocyn-ticket-composer-suggestion">
                  <div className="tocyn-ticket-composer-suggestion-header">
                    <span className="tocyn-ticket-composer-suggestion-label">
                      <ShieldCheck className="tocyn-ticket-detail-icon-sm" />
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
                        <X className="tocyn-ticket-detail-icon-sm" />
                      </TocynButton>
                    </div>
                  </div>
                  <p className="text-sm text-slate-700 italic leading-relaxed">"{suggestion}"</p>
                </div>
              )}

              {!replyCapability ? <div role="status" className="tocyn-ticket-reply-capability">
                {replyCapabilities.isLoading ? 'Loading reply options…' : 'Reply options are unavailable.'}
                {replyCapabilities.isError && <TocynButton
                  type="button"
                  className="tocyn-ticket-detail-inline-action tocyn-ticket-detail-inline-action--spaced"
                  onClick={() => void replyCapabilities.refetch()}
                >
                  Retry reply options
                </TocynButton>}
              </div> : <p className="tocyn-ticket-reply-capability tocyn-ticket-reply-capability-ready">{replyCapability.channel === 'email'
                ? `Email reply to ${ticket.customer_email}. Delivery is attempted after saving.`
                : 'Internal note. No email is sent.'} Up to {replyCapability.attachments.maxCount} attachments, {replyCapability.attachments.maxBytesPerFile / 1024 / 1024} MB each.</p>}
              {isInternal && replyCapabilities.data?.internalMentions && <fieldset className="tocyn-composer-mentions">
                <legend className="tocyn-composer-mentions-title">Mention colleagues</legend>
                <p id="mention-help" className="tocyn-composer-mentions-help">Mentioned colleagues with current ticket access receive a private activity after this note is saved. Up to 16.</p>
                {mentionCandidates.length ? <div className="tocyn-composer-mentions-list">
                  {mentionCandidates.map(agent => {
                    const checked = mentionedUserIds.includes(agent.id);
                    return <label key={agent.id} className="tocyn-composer-mention-option">
                      <ParkInput type="checkbox" aria-describedby="mention-help" checked={checked} disabled={isSubmitting}
                        onChange={() => updateDraft({ mentionedUserIds: checked ? mentionedUserIds.filter(id => id !== agent.id)
                          : mentionedUserIds.length < (replyCapabilities.data?.internalMentions?.maxRecipients ?? 0) ? [...mentionedUserIds, agent.id] : mentionedUserIds })} />
                      <span>{agent.full_name || agent.email}</span>
                    </label>;
                  })}
                </div> : <p className="tocyn-ticket-detail-status">No colleagues are available to mention.</p>}
              </fieldset>}
              <label className="mb-2 block text-sm text-slate-700">
                Message format
                <ParkSelect aria-label="Message format" value={draft.bodyFormat ?? 'plain'} disabled={!replyCapability || isSubmitting || draft.status === 'loading'}
                  onChange={event => { if (!submission.current && (event.target.value === 'plain' || event.target.value === 'markdown-v1') && replyCapability?.body.acceptedFormats.includes(event.target.value)) updateDraft({ bodyFormat: event.target.value }); }}
                  className="tocyn-form-control tocyn-ticket-detail-message-format">
                  <option value="plain" disabled={!replyCapability?.body.acceptedFormats.includes('plain')}>Plain text</option><option value="markdown-v1" disabled={!replyCapability?.body.acceptedFormats.includes('markdown-v1')}>Markdown</option>
                </ParkSelect>
              </label>
              <RichComposer
                id="reply-message"
                value={reply}
                format={draft.bodyFormat ?? 'plain'}
                readOnly={isSubmitting || draft.status === 'loading'}
                mode={isInternal ? 'internal' : 'public'}
                onChange={body => { if (!submission.current) updateDraft({ body }); }}
                onImageFiles={files => addAttachments(files)}
                onRejectedImageFiles={count => setNotice(`${count} image${count === 1 ? '' : 's'} was not attached. Use JPEG, PNG, GIF, or WebP images up to 10 MB.`)}
              />

              {(draft.attachments.length > 0 || visiblePendingAttachments.length > 0) && (
                <div className="tocyn-composer-attachments">
                  {draft.attachments.map(attachment => (
                    <div key={attachment.storageKey} className="tocyn-composer-attachment">
                      <Paperclip className="tocyn-composer-attachment-icon" />
                      <span className="tocyn-composer-attachment-name">{attachment.filename}</span>
                      <TocynButton
                        type="button"
                        aria-disabled={isSubmitting} aria-label={`Remove ${attachment.filename}`}
                        onClick={() => {
                          if (submission.current) return;
                          updateDraft({ attachments: draftRef.current.attachments.filter(candidate => candidate.storageKey !== attachment.storageKey) });
                          setNotice('Attachment removed.');
                          attachButtonRef.current?.focus();
                        }}
                        className="tocyn-composer-attachment-remove"
                      >
                        <X className="tocyn-composer-attachment-remove-icon" />
                      </TocynButton>
                    </div>
                  ))}
                  {visiblePendingAttachments.map(attachment => (
                    <div key={attachment.id} className="tocyn-composer-attachment">
                      <Paperclip className="tocyn-composer-attachment-icon" />
                      <span className="tocyn-composer-attachment-name">{attachment.file.name}</span>
                      <span role={attachment.status === 'error' ? 'alert' : 'status'} className="tocyn-composer-attachment-status">{attachment.status === 'uploading' ? 'Uploading…' : 'Upload failed.'}</span>
                      {attachment.status === 'error' && <TocynButton type="button" aria-disabled={isSubmitting} onClick={() => retryAttachment(attachment)} className="tocyn-ticket-detail-inline-action">Retry upload</TocynButton>}
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
                        className="tocyn-composer-attachment-remove"
                      >
                        <X className="tocyn-composer-attachment-remove-icon" />
                      </TocynButton>
                    </div>
                  ))}
                </div>
              )}

              <div className="tocyn-composer-footer">
                <p className="tocyn-composer-note">
                  <Info className="tocyn-ticket-detail-icon-xs" />
                  {isInternal
                    ? "Private note for team coordination."
                    : "Public replies are visible to the customer in this conversation."}
                </p>
                <div className="tocyn-composer-actions">
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
                    aria-disabled={!replyCapability || isSubmitting} aria-label="Attach files"
                    onClick={() => { if (!submission.current && replyCapability) fileInputRef.current?.click(); }}
                    className="tocyn-composer-attach-button"
                    title="Attach files"
                  >
                    <Paperclip className="w-4 h-4" />
                  </TocynButton>
                  <TocynButton
                    type="submit"
                    aria-disabled={assignmentBlocked || !replyCapability || !replyCapability.body.acceptedFormats.includes(draft.bodyFormat) || !reply.trim() || isSubmitting || visiblePendingAttachments.length > 0 || Boolean(sentDraftVersion) || Boolean(staleReplyReview)}
                    className={clsx(
                      "tocyn-composer-submit",
                      isInternal ? "tocyn-composer-submit-internal" : "tocyn-composer-submit-public"
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

      <aside id="ticket-context-panel" aria-label="Context" hidden={workspace.panel !== 'details'} className="tocyn-ticket-context-panel">
        <details open className="tocyn-ticket-context-card">
          <summary className="tocyn-ticket-context-summary">
            <span className="tocyn-ticket-context-summary-label"><User className="tocyn-ticket-context-user-icon" />Customer</span>
          </summary>
          <div className="tocyn-ticket-context-body">
            <div>
              <p className="tocyn-ticket-context-eyebrow">Verified identity</p>
              <p className="tocyn-ticket-context-value">{ticket.customer_email}</p>
              <p className="tocyn-ticket-context-help">Loaded from this tenant-scoped conversation.</p>
            </div>
            {customerHistory.isLoading ? (
              <p role="status" className="tocyn-ticket-context-notice">
                Loading customer history...
              </p>
            ) : customerHistory.isError ? (
              <p role="status" className="tocyn-ticket-context-notice">
                Customer history is unavailable for this conversation. {customerHistory.error instanceof Error ? customerHistory.error.message : 'Try opening the conversation again.'}
              </p>
            ) : customerHistoryEvents.length === 0 ? (
              <p role="status" className="tocyn-ticket-context-notice">
                Customer history is unavailable for this conversation. No cross-channel identity match was made.
              </p>
            ) : (
              <ul className="tocyn-ticket-context-history">
                {customerHistoryEvents.map((historyEvent) => (
                  <li key={historyEvent.id} className="tocyn-ticket-context-history-item">
                    <p className="tocyn-ticket-context-history-title">{customerHistoryLabel(historyEvent)} — {customerHistoryActor(historyEvent)}</p>
                    <p className="tocyn-ticket-context-history-meta">
                      {historyEvent.visibility} {historyEvent.source}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        <div className="tocyn-ticket-context-settings-card">
          <h3 ref={contextHeadingRef} tabIndex={-1} className="tocyn-ticket-context-settings-heading">
            <Info className="tocyn-ticket-context-settings-icon" />
            Ticket Details
          </h3>
          <div className="tocyn-ticket-context-settings-fields">
            <div>
              <label htmlFor="ticket-priority" className="tocyn-ticket-context-settings-label">Priority</label>
              <div className="tocyn-ticket-context-settings-field-control">
                <TocynSelect
                  key={`ticket-priority-${ticketSelectVersions.priority}`}
                  ref={node => { ticketSelectRefs.current.priority = node; }}
                  id="ticket-priority" aria-disabled={ticketMutationPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.priority}
                  onChange={(e) => {
                    if (changing.current || assignmentBlocked || pendingTicketSelectRefresh) { e.currentTarget.value = ticket.priority; return; }
                    void handleTicketChange({ priority: e.target.value as TicketChanges['priority'] }, 'priority');
                  }}
                  className="tocyn-form-control tocyn-ticket-context-settings-control"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </TocynSelect>
              </div>
            </div>
            <div>
              <label htmlFor="ticket-assigned_to" className="tocyn-ticket-context-settings-label">Assigned To</label>
              <div className="tocyn-ticket-context-settings-field-control">
                <TocynSelect
                  key={`ticket-assigned_to-${ticketSelectVersions.assigned_to}`}
                  ref={node => { ticketSelectRefs.current.assigned_to = node; }}
                  id="ticket-assigned_to" aria-disabled={ticketMutationPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.assigned_to || ''}
                  onChange={(e) => {
                    if (changing.current || assignmentBlocked || pendingTicketSelectRefresh) { e.currentTarget.value = ticket.assigned_to || ''; return; }
                    void handleTicketChange({ assigned_to: e.target.value || null }, 'assigned_to');
                  }}
                  className="tocyn-form-control tocyn-ticket-context-settings-control"
                >
                  <option value="">Unassigned</option>
                  {agents?.map(agent => (
                    <option key={agent.id} value={agent.id}>{agent.full_name || agent.email}</option>
                  ))}
                </TocynSelect>
                <TicketAssignmentActions ticketId={id} ownerId={ticket.assigned_to ?? null}
                  agents={agents ?? []} fresh={isFetchedAfterMount && !isFetching && !error}
                  disabled={updateTicket.isPending || assignResponsibleOwner.isPending || isSupportStateSubmitting || isSubmitting || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  refreshTicket={refreshAssignment} onBlocked={setAssignmentBlocked} />
              </div>
            </div>
            <div>
              <label htmlFor="ticket-group_id" className="tocyn-ticket-context-settings-label">Group</label>
              <div className="tocyn-ticket-context-settings-field-control">
                <TocynSelect
                  key={`ticket-group_id-${ticketSelectVersions.group_id}`}
                  ref={node => { ticketSelectRefs.current.group_id = node; }}
                  id="ticket-group_id" aria-disabled={ticketMutationPending || isConfirmingTicketSelect || Boolean(pendingTicketSelectRefresh)}
                  value={ticket.group_id || ''}
                  onChange={(e) => {
                    if (changing.current || assignmentBlocked || pendingTicketSelectRefresh) { e.currentTarget.value = ticket.group_id || ''; return; }
                    void handleTicketChange({ group_id: e.target.value || null }, 'group_id');
                  }}
                  className="tocyn-form-control tocyn-ticket-context-settings-control"
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

        <details open className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <summary className="cursor-pointer list-none text-sm font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
            <span className="flex items-center gap-2"><Activity className="w-4 h-4 text-slate-400" />Operational context</span>
          </summary>
          <p role="status" className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            No operational source is connected for this ticket. Live SLA and routing details remain unavailable.
          </p>
        </details>

        <details open className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <summary className="cursor-pointer list-none text-sm font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
            <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-slate-400" />Knowledge</span>
          </summary>
          <div className="mt-4 space-y-3">
            <p id="knowledge-insert-help" role="status" className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              {knowledgeLoading ? 'Loading tenant knowledge…' : knowledgeError ? 'Knowledge is temporarily unavailable. No content was inserted.' : knowledgeArticles.length ? 'Select an article to append its verified content to the reply.' : 'No eligible internal knowledge articles are available.'}
            </p>
            {knowledgeError && <TocynButton type="button" onClick={() => setKnowledgeAttempt(attempt => attempt + 1)} className="text-sm underline">Retry knowledge</TocynButton>}
            {workspace.panel === 'details' && knowledgeArticles.length > 0 && <KnowledgeBrowser articles={knowledgeArticles} insertingId={knowledgeInserting}
              disabled={Boolean(knowledgeInserting) || isSubmitting || draft.status === 'loading'} onInsert={article => void insertKnowledgeArticle(article)} />}
          </div>
        </details>

        <details open className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-in slide-in-from-right-4">
            <summary className="cursor-pointer list-none text-sm font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
              <span className="flex items-center gap-2"><Eye className="w-4 h-4 text-brand-500" />Collaboration</span>
            </summary>
            {viewers.length > 0 ? <div className="space-y-3">
              {viewers.map((viewer, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-700 text-xs font-bold border border-brand-100">
                    {viewer.name[0]}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">{viewer.name}</p>
                    <p className="text-[10px] tocyn-presence-viewing font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      Viewing
                    </p>
                  </div>
                </div>
              ))}
            </div> : <p role="status" className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">No collaborators are viewing this ticket.</p>}
        </details>
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
