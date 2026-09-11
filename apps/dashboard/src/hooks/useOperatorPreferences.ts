import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuthStore } from '../store/authStore';

export const OPERATOR_PREFERENCES_VERSION = 1;
export type OperatorDensity = 'comfortable' | 'compact';
export type OperatorFontScale = 'normal' | 'large' | 'larger';
export type OperatorMotion = 'system' | 'reduced' | 'full';
export type OperatorPreferences = Readonly<{
  version: typeof OPERATOR_PREFERENCES_VERSION;
  density: OperatorDensity;
  fontScale: OperatorFontScale;
  focusMode: boolean;
  motion: OperatorMotion;
}>;

const DEFAULT: OperatorPreferences = { version: OPERATOR_PREFERENCES_VERSION, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system' };
const keyFor = (tenantId?: string, userId?: string) => tenantId && userId ? `tocyn:operator-preferences:v${OPERATOR_PREFERENCES_VERSION}:${tenantId}:${userId}` : null;
const valid = (value: unknown): value is OperatorPreferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.version === OPERATOR_PREFERENCES_VERSION
    && (row.density === 'comfortable' || row.density === 'compact')
    && (row.fontScale === 'normal' || row.fontScale === 'large' || row.fontScale === 'larger')
    && typeof row.focusMode === 'boolean'
    && (row.motion === 'system' || row.motion === 'reduced' || row.motion === 'full');
};

function read(key: string | null): OperatorPreferences {
  if (!key || typeof window === 'undefined') return DEFAULT;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    return valid(parsed) ? parsed : DEFAULT;
  } catch { return DEFAULT; }
}

export function useOperatorPreferences() {
  const generation = useAuthStore(state => state.sessionGeneration);
  const tenantId = useAuthStore(state => state.user?.tenant_id);
  const userId = useAuthStore(state => state.user?.id);
  const key = useMemo(() => keyFor(tenantId, userId), [tenantId, userId]);
  const controller = useMemo(() => {
    let snapshot = read(key);
    const listeners = new Set<() => void>();
    const publish = (next: OperatorPreferences) => { snapshot = next; listeners.forEach(listener => listener()); };
    return {
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      getSnapshot: () => snapshot,
      update: (changes: Partial<OperatorPreferences>) => {
        const next = { ...snapshot, ...changes, version: OPERATOR_PREFERENCES_VERSION };
        if (!valid(next)) return;
        try { if (key) window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* Safe local fallback remains active. */ }
        publish(next);
      },
    };
  }, [key, generation]);
  const preferences = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.tocynDensity = preferences.density;
    root.dataset.tocynFontScale = preferences.fontScale;
    root.dataset.tocynFocusMode = preferences.focusMode ? 'true' : 'false';
    root.dataset.tocynMotion = preferences.motion;
    return () => {
      delete root.dataset.tocynDensity; delete root.dataset.tocynFontScale;
      delete root.dataset.tocynFocusMode; delete root.dataset.tocynMotion;
    };
  }, [preferences]);
  return { ...preferences, update: useCallback(controller.update, [controller]) };
}
