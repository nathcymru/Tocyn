import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { parseTocynTenantTheme, type TocynTenantTheme } from '@luminatick/shared/ui-theme';
import { ApiError, dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

export type OperatorThemeMode = 'light' | 'dark' | 'system';
export type OperatorThemeStatus = 'idle' | 'loading' | 'restored' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict';
export type OperatorThemePreference = Readonly<{ revision: number; mode: OperatorThemeMode; updatedAt: string | null }>;
export type OperatorThemeSnapshot = Readonly<OperatorThemePreference & { resolvedMode: 'light' | 'dark'; theme: TocynTenantTheme; status: OperatorThemeStatus; error: string | null }>;

const DEFAULT: OperatorThemePreference = { revision: 0, mode: 'system', updatedAt: null };
const FALLBACK: TocynTenantTheme = parseTocynTenantTheme({ version: '1', light: {}, dark: {} });
const identityFor = (generation: number, tenantId?: string, userId?: string) => tenantId && userId ? JSON.stringify([generation, tenantId, userId]) : null;
const validMode = (mode: unknown): mode is OperatorThemeMode => mode === 'light' || mode === 'dark' || mode === 'system';
const validPreference = (value: unknown): value is OperatorThemePreference => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Number.isSafeInteger(row.revision) && (row.revision as number) >= 0 && validMode(row.mode) && (row.updatedAt === null || typeof row.updatedAt === 'string');
};
const prefersDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;

/** The settings route adds its own fallback marker; do not give that marker to the shared parser. */
function parseThemeResponse(value: unknown): TocynTenantTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid tenant theme response');
  const response = value as Record<string, unknown>;
  if (typeof response.fallback !== 'boolean') throw new TypeError('Invalid tenant theme fallback marker');
  return parseTocynTenantTheme({ version: response.version, light: response.light, dark: response.dark });
}
function resolved(mode: OperatorThemeMode, dark: boolean, tenant: TocynTenantTheme) {
  const actual = mode === 'system' ? (dark ? 'dark' : 'light') : mode;
  return { resolvedMode: actual as 'light' | 'dark', theme: tenant };
}
function empty(status: OperatorThemeStatus, dark: boolean, error: string | null = null): OperatorThemeSnapshot {
  return { ...DEFAULT, ...resolved(DEFAULT.mode, dark, FALLBACK), status, error };
}

function createController(identity: string | null) {
  let state = empty(identity ? 'loading' : 'idle', prefersDark());
  let active = false;
  let epoch = 0;
  let editVersion = 0;
  let dirty = false;
  let revisionKnown = false;
  let denied = false;
  let saving: Promise<void> | null = null;
  let restoreFlight: Promise<void> | null = null;
  let restoreEpoch = 0;
  let restoreQueued = false;
  let restoreQueuedDiscard = false;
  let restoreDiscardLocal = false;
  let restoreAuthorityValid = false;
  let saveQueued = false;
  const listeners = new Set<() => void>();
  const current = (requestEpoch = epoch) => {
    const auth = useAuthStore.getState();
    return active && identity !== null && requestEpoch === epoch && identity === identityFor(auth.sessionGeneration, auth.user?.tenant_id, auth.user?.id);
  };
  const replace = (next: OperatorThemeSnapshot) => { state = next; listeners.forEach(listener => listener()); };
  const clearUnauthorized = () => {
    denied = true;
    dirty = false;
    revisionKnown = false;
    editVersion++;
    restoreQueued = false;
    restoreQueuedDiscard = false;
    restoreAuthorityValid = false;
    saveQueued = false;
    replace(empty('error', prefersDark(), 'Theme preferences are no longer available for this session. Sign in again to restore them.'));
  };

  const restore = (discardLocal = false) => {
    if (!current() || denied) return;
    if (saving) {
      restoreQueued = true;
      restoreQueuedDiscard ||= discardLocal;
      return;
    }
    if (restoreFlight) {
      if (restoreEpoch !== epoch || discardLocal !== restoreDiscardLocal) {
        restoreQueued = true;
        restoreQueuedDiscard ||= discardLocal;
      }
      return;
    }
    const requestEpoch = epoch;
    const requestEditVersion = editVersion;
    const preserveLocal = dirty && !discardLocal;
    restoreAuthorityValid = false;
    if (!dirty) replace({ ...state, status: 'loading', error: null });
    const flight = (async () => {
      try {
        const [preferenceResponse, themeResponse] = await Promise.all([
          dashboardApi.get<unknown>('/workspace/theme-preference'),
          dashboardApi.get<unknown>('/settings/theme'),
        ]);
        if (!current(requestEpoch)) return;
        if (!validPreference(preferenceResponse)) {
          // Do not continue to write against a revision from an older, now untrusted read.
          revisionKnown = false;
          replace({ ...state, status: 'error', error: 'Theme preference response is invalid. Restore before saving a choice.' });
          return;
        }
        let tenant = FALLBACK;
        let themeError: string | null = null;
        try { tenant = parseThemeResponse(themeResponse); } catch { themeError = 'Tenant theme is invalid; using the safe default palette.'; }
        revisionKnown = true;
        restoreAuthorityValid = true;
        const preference = preferenceResponse;
        if (preserveLocal || editVersion !== requestEditVersion) {
          // Local edits win, while the returned revision remains the base for their next CAS write.
          replace({ ...state, revision: preference.revision, updatedAt: preference.updatedAt,
            ...resolved(state.mode, prefersDark(), tenant), status: 'unsaved', error: themeError });
          return;
        }
        dirty = false;
        replace({ ...preference, ...resolved(preference.mode, prefersDark(), tenant), status: 'restored', error: themeError });
      } catch (error) {
        if (!current(requestEpoch)) return;
        if (error instanceof ApiError && error.status === 403) { clearUnauthorized(); return; }
        replace({ ...state, status: 'error', error: 'Theme preferences could not be restored. Retry to try again.' });
      }
    })();
    restoreFlight = flight;
    restoreEpoch = requestEpoch;
    restoreDiscardLocal = discardLocal;
    void flight.finally(() => {
      if (restoreFlight !== flight) return;
      restoreFlight = null;
      if (restoreQueued && active && !denied) {
        const discard = restoreQueuedDiscard;
        restoreQueued = false;
        restoreQueuedDiscard = false;
        restore(discard);
      } else if (saveQueued && restoreAuthorityValid && active && !denied) {
        saveQueued = false;
        void save();
      } else {
        saveQueued = false;
      }
    });
  };

  const save = async () => {
    if (!current() || denied || saving || !dirty || state.status === 'conflict') return;
    if (restoreFlight) { saveQueued = true; return; }
    if (!revisionKnown) return;
    const requestEpoch = epoch;
    const requestEditVersion = editVersion;
    const submitted = { revision: state.revision, mode: state.mode };
    replace({ ...state, status: 'saving', error: null });
    const flight = dashboardApi.put<unknown>('/workspace/theme-preference', { expectedRevision: submitted.revision, mode: submitted.mode }).then(response => {
      if (!current(requestEpoch)) return;
      if (!validPreference(response) || response.revision <= submitted.revision || response.mode !== submitted.mode) throw new Error('Invalid saved theme preference');
      revisionKnown = true;
      if (editVersion !== requestEditVersion) {
        // Only the captured choice committed; preserve a newer choice and its updated CAS base.
        replace({ ...state, revision: response.revision, updatedAt: response.updatedAt,
          ...resolved(state.mode, prefersDark(), state.theme), status: 'unsaved', error: null });
        return;
      }
      dirty = false;
      replace({ ...response, ...resolved(response.mode, prefersDark(), state.theme), status: 'saved', error: null });
    }).catch(error => {
      if (!current(requestEpoch)) return;
      if (error instanceof ApiError && error.status === 403) { clearUnauthorized(); return; }
      const conflict = error instanceof ApiError && error.status === 409;
      replace({ ...state, status: conflict ? 'conflict' : 'error', error: conflict
        ? 'Theme preference changed in another session. Restore before replacing it.'
        : 'Theme preference was not saved. Retry to keep this choice.' });
    }).finally(() => {
      if (saving === flight) saving = null;
      if (restoreQueued && active && !denied) {
        const discard = restoreQueuedDiscard;
        restoreQueued = false;
        restoreQueuedDiscard = false;
        restore(discard);
      }
    });
    saving = flight;
    await flight;
  };

  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => state,
    start: () => { active = true; epoch++; restore(); return () => { active = false; epoch++; }; },
    update: (mode: OperatorThemeMode) => {
      if (!current() || denied || state.status === 'conflict' || !validMode(mode)) return;
      editVersion++;
      dirty = true;
      replace({ ...state, mode, ...resolved(mode, prefersDark(), state.theme), status: 'unsaved', error: null });
    },
    save,
    retry: () => {
      if (denied) return;
      if (dirty && revisionKnown && state.status !== 'conflict') void save();
      else restore(false);
    },
    restore: () => restore(true),
    systemChanged: (dark: boolean) => { if (state.mode === 'system') replace({ ...state, ...resolved(state.mode, dark, state.theme) }); },
  };
}

export function useOperatorTheme() {
  const generation = useAuthStore(state => state.sessionGeneration);
  const tenantId = useAuthStore(state => state.user?.tenant_id);
  const userId = useAuthStore(state => state.user?.id);
  const identity = identityFor(generation, tenantId, userId);
  const controller = useMemo(() => createController(identity), [identity]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(controller.start, [controller]);
  useEffect(() => {
    const media = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const change = (event: MediaQueryListEvent) => controller.systemChanged(event.matches);
    media.addEventListener?.('change', change);
    return () => media.removeEventListener?.('change', change);
  }, [controller]);
  return { ...snapshot, updateMode: controller.update, save: controller.save, retry: controller.retry, restore: controller.restore };
}
