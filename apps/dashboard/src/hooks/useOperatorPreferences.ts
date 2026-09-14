import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { dashboardApi, ApiError } from '../api/client';
import { useAuthStore } from '../store/authStore';

export const OPERATOR_PREFERENCES_VERSION = 2;
export type OperatorDensity = 'comfortable' | 'compact';
export type OperatorFontScale = 'normal' | 'large' | 'larger';
export type OperatorMotion = 'system' | 'reduced' | 'full';
export type OperatorPreferences = Readonly<{ version: typeof OPERATOR_PREFERENCES_VERSION; revision: number; density: OperatorDensity; fontScale: OperatorFontScale; focusMode: boolean; motion: OperatorMotion; navigation: 'compact'|'labelled'; contextDefault: 'remember'|'conversation'|'details'; shortcutsEnabled: boolean; interruptionLevel: 'standard'|'quiet'; advanceAfterResolve: boolean; updatedAt: string | null }>;
export type OperatorPreferencesStatus = 'idle' | 'loading' | 'restored' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict';
export type OperatorPreferencesSnapshot = Readonly<OperatorPreferences & { status: OperatorPreferencesStatus; error: string | null; schemaUnavailable: boolean }>;
const DEFAULT: OperatorPreferences = { version: OPERATOR_PREFERENCES_VERSION, revision: 0, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system', navigation: 'labelled', contextDefault: 'remember', shortcutsEnabled: true, interruptionLevel: 'standard', advanceAfterResolve: false, updatedAt: null };
const valid = (value: unknown): value is OperatorPreferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.version === OPERATOR_PREFERENCES_VERSION && Number.isSafeInteger(row.revision) && Number(row.revision) >= 0
    && (row.density === 'comfortable' || row.density === 'compact') && (row.fontScale === 'normal' || row.fontScale === 'large' || row.fontScale === 'larger')
    && typeof row.navigation === 'string' && ['compact','labelled'].includes(row.navigation) && typeof row.contextDefault === 'string' && ['remember','conversation','details'].includes(row.contextDefault)
    && typeof row.shortcutsEnabled === 'boolean' && typeof row.interruptionLevel === 'string' && ['standard','quiet'].includes(row.interruptionLevel) && typeof row.advanceAfterResolve === 'boolean'
    && typeof row.focusMode === 'boolean' && (row.motion === 'system' || row.motion === 'reduced' || row.motion === 'full') && (row.updatedAt === null || typeof row.updatedAt === 'string');
};
const identityFor = (generation: number, tenantId?: string, userId?: string) => tenantId && userId ? `${generation}:${tenantId}:${userId}` : null;
function empty(status: OperatorPreferencesStatus = 'idle', error: string | null = null): OperatorPreferencesSnapshot { return { ...DEFAULT, status, error, schemaUnavailable: false }; }

function createController(identity: string | null) {
  let state = empty(identity ? 'loading' : 'idle'); let active = false; let denied = !identity; let epoch = 0; let dirty = false; let revisionKnown = false;
  let restoreFlight: Promise<void> | null = null; let saving: Promise<void> | null = null; let saveQueued = false; const listeners = new Set<() => void>();
  const current = (requestEpoch?: number) => active && !denied && identity !== null && identity === identityFor(useAuthStore.getState().sessionGeneration, useAuthStore.getState().user?.tenant_id, useAuthStore.getState().user?.id) && (requestEpoch === undefined || epoch === requestEpoch);
  const replace = (next: OperatorPreferencesSnapshot) => { state = next; listeners.forEach(listener => listener()); };
  const clearUnauthorized = () => { denied = true; dirty = false; revisionKnown = false; replace(empty()); };
  const restore = (discardLocal = false) => {
    if (!current() || restoreFlight) return;
    const requestEpoch = epoch; const preserveLocal = dirty && !discardLocal;
    if (discardLocal) dirty = false;
    replace({ ...state, status: 'loading', error: null });
    const flight = dashboardApi.get<unknown>('/workspace/presentation-preference').then(response => {
      if (!current(requestEpoch)) return;
      if (!valid(response)) { revisionKnown = false; dirty = false; replace({ ...empty('error', 'Workspace preferences response is invalid. Restore before saving.'), schemaUnavailable: true }); return; }
      revisionKnown = true;
      if (preserveLocal) { replace({ ...state, revision: response.revision, updatedAt: response.updatedAt, status: 'unsaved', error: null, schemaUnavailable: false }); return; }
      dirty = false; replace({ ...response, status: 'restored', error: null, schemaUnavailable: false });
    }).catch(error => {
      if (!current(requestEpoch)) return;
      if (error instanceof ApiError && error.status === 403) { clearUnauthorized(); return; }
      if (error instanceof ApiError && error.code === 'presentation_schema_unavailable') {
        revisionKnown = false; dirty = false;
        replace({ ...empty('error', 'Workspace preferences schema is unavailable. Restore before saving.'), schemaUnavailable: true });
      } else replace({ ...state, status: 'error', error: 'Workspace preferences could not be restored. Retry.' });
    }).finally(() => {
      if (restoreFlight !== flight) return;
      restoreFlight = null;
      if (saveQueued && revisionKnown && current()) { saveQueued = false; void save(); }
    });
    restoreFlight = flight;
  };
  const save = async () => {
    if (!current() || !dirty || saving || state.status === 'conflict') return;
    if (restoreFlight) { saveQueued = true; return; }
    if (!revisionKnown) return;
    const requestEpoch = epoch; const submitted = state;
    replace({ ...state, status: 'saving', error: null });
    const flight = dashboardApi.put<unknown>('/workspace/presentation-preference', { version: OPERATOR_PREFERENCES_VERSION, expectedRevision: submitted.revision, density: submitted.density, fontScale: submitted.fontScale, focusMode: submitted.focusMode, motion: submitted.motion, navigation: submitted.navigation, contextDefault: submitted.contextDefault, shortcutsEnabled: submitted.shortcutsEnabled, interruptionLevel: submitted.interruptionLevel, advanceAfterResolve: submitted.advanceAfterResolve }).then(response => {
      if (!current(requestEpoch)) return;
      if (!valid(response) || response.revision <= submitted.revision) throw new Error('Invalid saved preference');
      revisionKnown = true; dirty = false; replace({ ...response, status: 'saved', error: null, schemaUnavailable: false });
    }).catch(error => {
      if (!current(requestEpoch)) return;
      if (error instanceof ApiError && error.status === 403) { clearUnauthorized(); return; }
      if (error instanceof ApiError && error.code === 'presentation_schema_unavailable') {
        revisionKnown = false; dirty = false;
        replace({ ...empty('error', 'Workspace preferences schema is unavailable. Restore before saving.'), schemaUnavailable: true });
        return;
      }
      const conflict = error instanceof ApiError && error.status === 409;
      replace({ ...state, status: conflict ? 'conflict' : 'error', error: conflict ? 'Workspace preferences changed elsewhere. Restore before replacing them.' : 'Workspace preferences were not saved. Retry.' });
    }).finally(() => { if (saving === flight) saving = null; });
    saving = flight; await flight;
  };
  return { subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => state,
    start: () => { active = true; epoch++; denied = !identity; if (identity) restore(); return () => {
      active = false; epoch++;
      // StrictMode can replay this effect before its first restore settles.
      // Detach obsolete flights so the next start can restore independently.
      restoreFlight = null; saving = null; saveQueued = false;
    }; },
    update: (changes: Partial<Pick<OperatorPreferences, 'density'|'fontScale'|'focusMode'|'motion'|'navigation'|'contextDefault'|'shortcutsEnabled'|'interruptionLevel'|'advanceAfterResolve'>>) => {
      if (!current() || state.schemaUnavailable || state.status === 'conflict') return;
      const next = { ...state, ...changes }; if (!valid(next)) return;
      dirty = true;
      // A preview cannot be saved until a validated server revision is known.
      // Keep the error and Retry control available instead of promising a save.
      replace({ ...next, status: revisionKnown ? 'unsaved' : state.status, error: revisionKnown ? null : state.error });
    },
    save, retry: () => { if (!denied) { if (dirty && revisionKnown && state.status !== 'conflict') void save(); else restore(false); } }, restore: () => restore(true) };
}

export function useOperatorPreferences() {
  const generation = useAuthStore(state => state.sessionGeneration); const tenantId = useAuthStore(state => state.user?.tenant_id); const userId = useAuthStore(state => state.user?.id);
  const controller = useMemo(() => createController(identityFor(generation, tenantId, userId)), [generation, tenantId, userId]);
  const preferences = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(controller.start, [controller]);
  useEffect(() => { const root = document.documentElement; root.dataset.tocynDensity = preferences.density; root.dataset.tocynFontScale = preferences.fontScale; root.dataset.tocynFocusMode = preferences.focusMode ? 'true' : 'false'; root.dataset.tocynMotion = preferences.motion;
    return () => { delete root.dataset.tocynDensity; delete root.dataset.tocynFontScale; delete root.dataset.tocynFocusMode; delete root.dataset.tocynMotion; }; }, [preferences]);
  return { ...preferences, update: useCallback(controller.update, [controller]), save: controller.save, retry: controller.retry, restore: controller.restore };
}
