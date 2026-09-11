import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { ApiError, dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { articleBodyFormat, type ArticleBodyFormat } from '@luminatick/shared';

export type OperatorDraftAttachment = Readonly<{ storageKey: string; filename: string; size: number; contentType: string }>;
export type OperatorDraftMode = 'public' | 'internal';
export type OperatorDraftVersion = Readonly<{ generation: string; revision: number }>;
export type OperatorDraftValue = Readonly<{
  mode: OperatorDraftMode;
  body: string;
  bodyFormat: ArticleBodyFormat;
  attachments: readonly OperatorDraftAttachment[];
  baseConversationRevision: number;
}>;
type StoredDraft = OperatorDraftValue & OperatorDraftVersion;
type DraftStatus = 'idle' | 'loading' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict' | 'discarded';
type DraftState = OperatorDraftValue & { status: DraftStatus; error: string | null; version: OperatorDraftVersion | null };
type CleanupResult = 'cleared' | 'conflict' | 'error';

const EMPTY_DRAFT: OperatorDraftValue = Object.freeze({ mode: 'public', body: '', bodyFormat: 'markdown-v1', attachments: [], baseConversationRevision: 0 });
function empty(status: DraftStatus = 'idle'): DraftState {
  return { ...EMPTY_DRAFT, status, error: null, version: null };
}
function withinBounds(value: OperatorDraftValue) {
  return value.attachments.length <= 10 && new TextEncoder().encode(value.body).length <= 16_000;
}
function sameVersion(a: OperatorDraftVersion | null, b: OperatorDraftVersion) {
  return a?.generation === b.generation && a.revision === b.revision;
}
function toStored(value: StoredDraft): DraftState {
  return { mode: value.mode, body: value.body, bodyFormat: articleBodyFormat(value.bodyFormat), attachments: [...value.attachments],
    baseConversationRevision: value.baseConversationRevision, status: 'saved', error: null,
    version: { generation: value.generation, revision: value.revision } };
}
function currentIdentity(sessionGeneration: number, tenantId: string | undefined, userId: string | undefined, ticketId: string | null) {
  return ticketId && tenantId && userId ? JSON.stringify([sessionGeneration, tenantId, userId, ticketId]) : null;
}

/** One identity owns its state, restore gate, and serialized save/delete lane. */
function createController(identity: string | null, ticketId: string | null) {
  let state = empty(identity ? 'loading' : 'idle');
  let active = false;
  let epoch = 0;
  let known = false;
  let restoring = false;
  let dirty = false;
  let uncertainWrite = false;
  let edit = 0;
  let savedEdit = 0;
  let debounceMs = 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let deleting: Promise<CleanupResult> | null = null;
  const listeners = new Set<() => void>();
  const path = `/workspace/drafts/${encodeURIComponent(ticketId ?? '')}`;
  const isCurrent = (requestEpoch = epoch) => {
    const auth = useAuthStore.getState();
    return active && requestEpoch === epoch && identity !== null && identity ===
      currentIdentity(auth.sessionGeneration, auth.user?.tenant_id, auth.user?.id, ticketId);
  };
  const replace = (next: DraftState) => { state = next; listeners.forEach(listener => listener()); };
  const denied = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status);
  const clearDenied = () => {
    known = false;
    dirty = false;
    replace({ ...empty('error'), error: 'Draft access is unavailable. Retry restoring after access is confirmed.' });
  };
  const cancelTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const schedule = () => {
    cancelTimer();
    if (!isCurrent() || !known || !dirty || restoring || saving || deleting || state.status === 'conflict' || !withinBounds(state)) return;
    timer = setTimeout(() => { timer = null; void saveNow(); }, debounceMs);
  };

  const restore = async () => {
    if (!isCurrent() || restoring || saving || deleting || state.status === 'conflict') return;
    const requestEpoch = epoch;
    restoring = true;
    known = false;
    replace({ ...state, status: 'loading', error: null });
    try {
      const draft = await dashboardApi.getOptional<StoredDraft>(path);
      if (!isCurrent(requestEpoch)) return;
      const restored = draft ? toStored(draft) : empty();
      known = true;
      if (dirty) {
        // Edits made while restoring retain their content but must use the fetched CAS version.
        replace({ ...state, version: restored.version, baseConversationRevision: restored.baseConversationRevision,
          status: withinBounds(state) ? 'unsaved' : 'error', error: withinBounds(state) ? null : 'Draft exceeds the server size limit.' });
      } else { savedEdit = edit; replace(restored); }
    } catch (error) {
      if (isCurrent(requestEpoch)) {
        if (denied(error)) clearDenied();
        else replace({ ...state, status: 'error', error: 'Draft could not be restored. Retry before replacing it.' });
      }
    } finally {
      if (isCurrent(requestEpoch)) { restoring = false; if (known) schedule(); }
    }
  };

  const saveNow = (): Promise<void> => {
    cancelTimer();
    if (!isCurrent()) return Promise.resolve();
    if (saving) return saving;
    if (!known || !dirty || restoring || deleting || state.status === 'conflict' || !withinBounds(state)) return Promise.resolve();
    const requestEpoch = epoch;
    const snapshot = state;
    const submittedEdit = edit;
    replace({ ...state, status: 'saving', error: null });
    saving = (async () => {
      let succeeded = false;
      try {
        const saved = await dashboardApi.put<StoredDraft>(path, {
          expectedGeneration: snapshot.version?.generation ?? null, expectedRevision: snapshot.version?.revision ?? 0,
          mode: snapshot.mode, body: snapshot.body, bodyFormat: snapshot.bodyFormat, attachments: snapshot.attachments,
        });
        if (!isCurrent(requestEpoch)) return;
        const restored = toStored(saved);
        if (restored.bodyFormat !== snapshot.bodyFormat) throw new Error('Draft format was not confirmed');
        succeeded = true;
        uncertainWrite = false;
        savedEdit = submittedEdit;
        dirty = edit !== submittedEdit;
        replace(dirty ? { ...state, version: restored.version, baseConversationRevision: restored.baseConversationRevision,
          status: withinBounds(state) ? 'unsaved' : 'error', error: withinBounds(state) ? null : 'Draft exceeds the server size limit.' } : restored);
      } catch (error) {
        if (!isCurrent(requestEpoch)) return;
        if (denied(error)) { clearDenied(); return; }
        uncertainWrite = true;
        replace({ ...state, status: error instanceof ApiError && error.status === 409 ? 'conflict' : 'error',
          error: error instanceof ApiError && error.status === 409
            ? 'Draft changed in another session. Review before saving again.' : 'Draft was not saved. Retry to keep this version.' });
      } finally {
        if (isCurrent(requestEpoch)) { saving = null; if (succeeded) schedule(); }
      }
    })();
    return saving;
  };

  // Navigation must remain on the current ticket unless every current edit is acknowledged.
  // Drain at most an existing PUT plus one subsequent snapshot; continuous editing returns false.
  const flushBeforeNavigation = async (): Promise<boolean> => {
    const requestEpoch = epoch;
    const failed = () => state.status === 'error' || state.status === 'conflict';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!isCurrent(requestEpoch) || !known || restoring || deleting || state.status === 'conflict' || !withinBounds(state)) return false;
      if (!dirty && !saving) return true;
      await saveNow();
      if (!isCurrent(requestEpoch) || failed()) return false;
    }
    return isCurrent(requestEpoch) && known && !dirty && !saving && !deleting;
  };

  const update = (value: OperatorDraftValue | ((current: OperatorDraftValue) => OperatorDraftValue)) => {
    if (!isCurrent()) return;
    const next = typeof value === 'function' ? value(state) : value;
    edit++;
    dirty = true;
    cancelTimer();
    // A local edit cannot unlock a failed restore or an unresolved remote conflict.
    const blocked = state.status === 'conflict' || !known;
    replace({ ...state, ...next, attachments: next.attachments.map(attachment => ({ ...attachment })),
      status: blocked ? state.status : withinBounds(next) ? 'unsaved' : 'error',
      error: blocked ? state.error : withinBounds(next) ? null : 'Draft exceeds the server size limit.' });
    schedule();
  };

  const remove = (requestedVersion?: OperatorDraftVersion): Promise<CleanupResult> => {
    if (!isCurrent() || !known || restoring) return Promise.resolve('error');
    // Different delete intents must not share a success receipt for the first operation.
    if (deleting) return Promise.resolve('error');
    cancelTimer();
    const requestEpoch = epoch;
    // Discard covers the edits present at the click. Send cleanup covers only the saved copy.
    const clearedEdit = requestedVersion ? savedEdit : edit;
    const priorSave = saving;
    deleting = (async (): Promise<CleanupResult> => {
      // Wait even for a first PUT: clearing locally before it returns can resurrect a draft.
      if (priorSave) await priorSave;
      if (!isCurrent(requestEpoch)) return 'error';
      const version = requestedVersion ?? state.version;
      if (!version && uncertainWrite) return state.status === 'conflict' ? 'conflict' : 'error';
      try {
        if (version) await dashboardApi.deleteEmpty(`${path}?generation=${encodeURIComponent(version.generation)}&revision=${version.revision}`);
        if (!isCurrent(requestEpoch)) return 'error';
        if (!version || sameVersion(state.version, version)) {
          dirty = edit !== clearedEdit;
          if (dirty) replace({ ...state, version: null, status: withinBounds(state) ? 'unsaved' : 'error',
            error: withinBounds(state) ? null : 'Draft exceeds the server size limit.' });
          else { savedEdit = edit; replace(empty('discarded')); }
        }
        return 'cleared';
      } catch (error) {
        if (!isCurrent(requestEpoch)) return 'error';
        if (denied(error)) { clearDenied(); return 'error'; }
        const conflict = error instanceof ApiError && error.status === 409;
        // An older send receipt cannot change the status of a newer saved draft.
        if (version && sameVersion(state.version, version)) replace({ ...state, status: conflict ? 'conflict' : 'error',
          error: conflict ? 'Draft changed before cleanup.' : 'Draft cleanup failed. The draft is retained.' });
        return conflict ? 'conflict' : 'error';
      }
    })();
    const pending = deleting;
    void pending.then(result => {
      if (isCurrent(requestEpoch)) { deleting = null; if (result === 'cleared') schedule(); }
    });
    return pending;
  };

  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    currentSnapshot: () => isCurrent() ? state : null,
    start: () => {
      active = true;
      epoch++;
      restoring = false;
      void restore();
      return () => { active = false; epoch++; cancelTimer(); };
    },
    setDebounce: (value: number) => { debounceMs = value; },
    update, saveNow, flushBeforeNavigation,
    retrySave: () => { void saveNow(); },
    retryRestore: () => { if (!known) void restore(); },
    discard: () => remove(),
    cleanupAfterConfirmedSend: (version: OperatorDraftVersion) => remove(version),
  };
}

/** Content lives only in memory and the authenticated API; cleanup requires a confirmed send receipt. */
export function useOperatorDraft(ticketId: string | null, options: Readonly<{ debounceMs?: number }> = {}) {
  const sessionGeneration = useAuthStore(state => state.sessionGeneration);
  const tenantId = useAuthStore(state => state.user?.tenant_id);
  const userId = useAuthStore(state => state.user?.id);
  const identity = currentIdentity(sessionGeneration, tenantId, userId, ticketId);
  // A new identity gets an empty snapshot in its first render, before any effect runs.
  const controller = useMemo(() => createController(identity, ticketId), [identity, ticketId]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(controller.start, [controller]);
  const debounceMs = Math.max(100, Math.min(2_000, options.debounceMs ?? 500));
  useLayoutEffect(() => { controller.setDebounce(debounceMs); }, [controller, debounceMs]);
  return { ...state, currentSnapshot: controller.currentSnapshot, update: controller.update, retrySave: controller.retrySave, retryRestore: controller.retryRestore,
    discard: controller.discard, saveNow: controller.saveNow, flushBeforeNavigation: controller.flushBeforeNavigation, cleanupAfterConfirmedSend: controller.cleanupAfterConfirmedSend };
}
