import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ApiError, dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

export type WorkspaceFilters = Readonly<{
  status?: 'open' | 'pending' | 'resolved' | 'closed'; priority?: 'low' | 'normal' | 'high' | 'urgent';
  assignedTo?: string | null; groupId?: string | null; filterId?: string | null;
}>;
export type WorkspacePreference = Readonly<{
  revision: number; view: 'all' | 'mine' | 'unassigned' | 'mentions' | 'drafts' | 'snoozed' | 'needs_action' | 'team' | 'custom';
  sort: 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc' | 'priority_desc' | 'priority_asc';
  filters: WorkspaceFilters; listQuery: string; listAnchor: string; selectedTicketId: string | null;
  panel: 'conversation' | 'details'; updatedAt: string;
}>;
export type WorkspacePreferencePatch = Readonly<Partial<Omit<WorkspacePreference, 'revision' | 'updatedAt'>>>;
export type WorkspacePreferenceStatus = 'idle' | 'loading' | 'restored' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict';
type Snapshot = WorkspacePreference & Readonly<{ status: WorkspacePreferenceStatus; error: string | null }>;
type DraftIndex = Readonly<{ items: readonly Readonly<{ ticketId: string; updatedAt: string }>[]; next: string | null }>;

const DEFAULT: WorkspacePreference = Object.freeze({ revision: 0, view: 'all', sort: 'updated_desc', filters: {}, listQuery: '', listAnchor: 'page:1', selectedTicketId: null, panel: 'conversation', updatedAt: '' });
function empty(status: WorkspacePreferenceStatus): Snapshot { return { ...DEFAULT, filters: {}, status, error: null }; }
function identityFor(sessionGeneration: number, tenantId: string | undefined, userId: string | undefined) {
  return tenantId && userId ? JSON.stringify([sessionGeneration, tenantId, userId]) : null;
}
function bounded(value: WorkspacePreference) {
  return new TextEncoder().encode(value.listQuery).length <= 512 && new TextEncoder().encode(value.listAnchor).length <= 512;
}
function merge(base: WorkspacePreference, patch: Partial<WorkspacePreference>): WorkspacePreference {
  return { ...base, ...patch, filters: patch.filters ? { ...patch.filters } : { ...base.filters } };
}
function mergePatch(base: WorkspacePreferencePatch, patch: WorkspacePreferencePatch): WorkspacePreferencePatch {
  return { ...base, ...patch, ...(patch.filters ? { filters: { ...patch.filters } } : {}) };
}
function saveInput(value: WorkspacePreference) {
  return { expectedRevision: value.revision, view: value.view, sort: value.sort, filters: value.filters,
    listQuery: value.listQuery, listAnchor: value.listAnchor, selectedTicketId: value.selectedTicketId, panel: value.panel };
}

/** One authenticated operator owns a restore gate and one serialized preference-save lane. */
function createController(identity: string | null) {
  let state = empty(identity ? 'loading' : 'idle');
  let active = false;
  let epoch = 0;
  let known = false;
  let restoring = false;
  let dirty = false;
  let edit = 0;
  let pendingPatch: WorkspacePreferencePatch = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const current = (requestEpoch = epoch) => {
    const auth = useAuthStore.getState();
    return active && requestEpoch === epoch && identity !== null && identity === identityFor(auth.sessionGeneration, auth.user?.tenant_id, auth.user?.id);
  };
  const localOnly = () => active && identity === null;
  const replace = (next: Snapshot) => { state = next; listeners.forEach(listener => listener()); };
  const cancel = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const denied = (error: unknown) => error instanceof ApiError && [401, 403].includes(error.status);
  const clearDenied = () => {
    known = false; dirty = false; pendingPatch = {}; cancel();
    replace({ ...empty('error'), error: 'Workspace preferences are unavailable. Retry after access is confirmed.' });
  };
  const schedule = () => {
    cancel();
    if (!current() || !known || !dirty || restoring || saving || state.status === 'conflict' || !bounded(state)) return;
    timer = setTimeout(() => { timer = null; void saveNow(); }, 300);
  };

  const restore = async (discardLocal = false) => {
    if (!current() || restoring || saving) return;
    const requestEpoch = epoch;
    const requestedEdit = edit;
    restoring = true;
    replace({ ...state, status: 'loading', error: null });
    try {
      const remote = await dashboardApi.get<WorkspacePreference | null>('/workspace/state');
      if (!current(requestEpoch)) return;
      known = true;
      const restored = remote ? merge(remote, {}) : { ...DEFAULT, filters: {} };
      if (discardLocal && edit === requestedEdit) {
        dirty = false; pendingPatch = {};
        replace({ ...restored, status: 'restored', error: null });
      } else if (dirty) {
        replace({ ...merge(restored, pendingPatch), status: bounded(merge(restored, pendingPatch)) ? 'unsaved' : 'error', error: bounded(merge(restored, pendingPatch)) ? null : 'Workspace preference exceeds the server limit.' });
      } else replace({ ...restored, status: 'restored', error: null });
    } catch (error) {
      if (current(requestEpoch)) {
        if (denied(error)) clearDenied();
        else replace({ ...state, status: 'error', error: 'Workspace preferences could not be restored. Retry before saving.' });
      }
    } finally {
      if (current(requestEpoch)) { restoring = false; schedule(); }
    }
  };

  const saveNow = (): Promise<void> => {
    cancel();
    if (!current() || saving || !known || !dirty || restoring || state.status === 'conflict' || !bounded(state)) return saving ?? Promise.resolve();
    const requestEpoch = epoch;
    const snapshot = state;
    const submittedEdit = edit;
    const submittedPatch = pendingPatch;
    pendingPatch = {};
    replace({ ...state, status: 'saving', error: null });
    saving = (async () => {
      let succeeded = false;
      try {
        const saved = await dashboardApi.put<WorkspacePreference>('/workspace/state', saveInput(snapshot));
        if (!current(requestEpoch)) return;
        succeeded = true;
        if (edit === submittedEdit) {
          dirty = false;
          replace({ ...merge(saved, {}), status: 'saved', error: null });
        } else replace({ ...merge(saved, pendingPatch), status: bounded(merge(saved, pendingPatch)) ? 'unsaved' : 'error', error: bounded(merge(saved, pendingPatch)) ? null : 'Workspace preference exceeds the server limit.' });
      } catch (error) {
        if (!current(requestEpoch)) return;
        if (denied(error)) { clearDenied(); return; }
        pendingPatch = mergePatch(submittedPatch, pendingPatch);
        dirty = true;
        const conflict = error instanceof ApiError && error.status === 409;
        replace({ ...state, status: conflict ? 'conflict' : 'error', error: conflict
          ? 'Workspace preferences changed in another session. Review before replacing them.' : 'Workspace preferences were not saved. Retry to keep this version.' });
      } finally {
        if (current(requestEpoch)) { saving = null; if (succeeded) schedule(); }
      }
    })();
    return saving;
  };

  const update = (patch: WorkspacePreferencePatch) => {
    if (!current() && !localOnly()) return;
    edit++; dirty = true; cancel();
    pendingPatch = mergePatch(pendingPatch, patch);
    const next = merge(state, patch);
    if (localOnly()) { replace({ ...next, status: 'idle', error: null }); return; }
    const blocked = !known || state.status === 'conflict';
    replace({ ...next, status: blocked ? state.status : bounded(next) ? 'unsaved' : 'error', error: blocked ? state.error : bounded(next) ? null : 'Workspace preference exceeds the server limit.' });
    schedule();
  };

  // A list transition may wait for one in-flight save plus one later edit, never an unbounded stream.
  const flushBeforeNavigation = async (): Promise<boolean> => {
    if (localOnly()) return true;
    const requestEpoch = epoch;
    const failed = () => state.status === 'error' || state.status === 'conflict';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!current(requestEpoch) || !known || restoring || state.status === 'conflict' || !bounded(state)) return false;
      if (!dirty && !saving) return true;
      await saveNow();
      if (!current(requestEpoch) || failed()) return false;
    }
    return current(requestEpoch) && known && !dirty && !saving;
  };

  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => state,
    hasUnsavedChanges: () => dirty,
    start: () => { active = true; epoch++; void restore(); return () => { active = false; epoch++; cancel(); }; },
    update, saveNow, flushBeforeNavigation,
    retrySave: () => { if (known) void saveNow(); else void restore(); },
    retryRestore: () => { if (!known) void restore(); },
    restoreServerState: () => { void restore(true); },
  };
}

/** Server-backed operator preferences; browser memory is only a transient editing surface. */
export function useOperatorWorkspaceState() {
  const sessionGeneration = useAuthStore(state => state.sessionGeneration);
  const tenantId = useAuthStore(state => state.user?.tenant_id);
  const userId = useAuthStore(state => state.user?.id);
  const identity = identityFor(sessionGeneration, tenantId, userId);
  const controller = useMemo(() => createController(identity), [identity]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(controller.start, [controller]);
  return { ...state, hasUnsavedChanges: controller.hasUnsavedChanges(), update: controller.update, saveNow: controller.saveNow, flushBeforeNavigation: controller.flushBeforeNavigation, retrySave: controller.retrySave,
    retryRestore: controller.retryRestore, restoreServerState: controller.restoreServerState };
}

/** Body-free draft query input for the legacy list; #130 owns complete Drafts-view semantics. */
export function useOperatorDraftIndicators() {
  const sessionGeneration = useAuthStore(state => state.sessionGeneration);
  const tenantId = useAuthStore(state => state.user?.tenant_id);
  const userId = useAuthStore(state => state.user?.id);
  const identity = identityFor(sessionGeneration, tenantId, userId);
  const [result, setResult] = useState(() => ({ identity: null as string | null, ticketIds: new Set<string>(), status: 'idle' as 'idle' | 'loading' | 'ready' | 'partial' | 'error' }));
  useEffect(() => {
    let live = true;
    if (!identity) { setResult({ identity, ticketIds: new Set(), status: 'idle' }); return () => { live = false; }; }
    setResult({ identity, ticketIds: new Set(), status: 'loading' });
    void (async () => {
      const ticketIds = new Set<string>();
      let after = '';
      for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
        const page = await dashboardApi.get<DraftIndex>(`/workspace/drafts?limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`);
        page.items.forEach(item => ticketIds.add(item.ticketId));
        if (!page.next) { if (live) setResult({ identity, ticketIds, status: 'ready' }); return; }
        after = page.next;
      }
      if (live) setResult({ identity, ticketIds, status: 'partial' });
    })().catch(() => { if (live) setResult({ identity, ticketIds: new Set(), status: 'error' }); });
    return () => { live = false; };
  }, [identity]);
  return result.identity === identity ? result : { identity, ticketIds: new Set<string>(), status: identity ? 'loading' as const : 'idle' as const };
}
