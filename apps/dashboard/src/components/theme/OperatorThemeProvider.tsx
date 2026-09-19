import * as React from 'react';
import { createTocynThemeScope } from '@luminatick/ui';
import { ParkButton, ParkInput, ParkProgress, ParkSelect, ParkSkeleton } from '@luminatick/ui/park';
import { useOperatorTheme, type OperatorThemeMode } from '../../hooks/useOperatorTheme';
import { useOperatorPreferences, type OperatorDensity, type OperatorFontScale, type OperatorMotion } from '../../hooks/useOperatorPreferences';

type ThemeContextValue = ReturnType<typeof useOperatorTheme>;
const ThemeContext = React.createContext<ThemeContextValue | null>(null);
export function useOperatorThemeContext() { const value = React.useContext(ThemeContext); if (!value) throw new Error('Operator theme context is unavailable'); return value; }

export function OperatorThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useOperatorTheme();
  const preferences = useOperatorPreferences();
  const scope = React.useRef<ReturnType<typeof createTocynThemeScope> | null>(null);
  const hasStableAppearance = React.useRef(false);
  if (theme.status === 'restored' || theme.status === 'unsaved' || theme.status === 'saved' || theme.status === 'conflict') hasStableAppearance.current = true;
  React.useLayoutEffect(() => {
    if (typeof document === 'undefined' || theme.status === 'loading' || theme.status === 'idle') {
      if (theme.status === 'idle') { scope.current?.remove(); scope.current = null; }
      return;
    }
    const input = { mode: theme.resolvedMode, tenant: theme.theme[theme.resolvedMode] } as const;
    if (!scope.current) scope.current = createTocynThemeScope(document.documentElement, input); else scope.current.apply(input);
  }, [theme.resolvedMode, theme.theme, theme.status]);
  React.useEffect(() => () => { scope.current?.remove(); scope.current = null; }, []);
  const loading = theme.status === 'loading';
  const loadingMessage = useAppearanceLoadingMessage(loading);
  const startupTimeout = theme.status === 'error' && !hasStableAppearance.current && theme.error?.includes('took too long');
  return <ThemeContext.Provider value={theme}>
    {startupTimeout ? <section role="alert" aria-labelledby="appearance-load-error-title" className="tocyn-theme-load-error">
      <h1 id="appearance-load-error-title" tabIndex={-1}>Appearance settings could not be loaded</h1>
      <p>{theme.error}</p>
      <ParkButton type="button" onClick={theme.retry}>Retry appearance</ParkButton>
    </section> : <>
    {loading && <section role="status" aria-live="polite" aria-label="Restoring appearance" className="tocyn-theme-loading">
      <div className="tocyn-theme-loading-skeletons" aria-hidden="true"><ParkSkeleton /><ParkSkeleton /><ParkSkeleton /></div>
      <ParkProgress value={null} label={loadingMessage} />
      <p>Workspace controls remain available while appearance settings load.</p>
    </section>}
    {(theme.status === 'error' || theme.status === 'conflict') && <div role="alert" className="tocyn-theme-status-banner"><span>{theme.error || 'Appearance could not be restored.'}</span><ParkButton type="button" onClick={theme.retry} className="tocyn-theme-retry">Retry appearance</ParkButton></div>}
    <PreferencesContext.Provider value={preferences}>{children}</PreferencesContext.Provider>
    </>}
  </ThemeContext.Provider>;
}

function useAppearanceLoadingMessage(loading: boolean) {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 1_000);
    return () => window.clearInterval(timer);
  }, [loading]);
  if (elapsed >= 5_000) return 'Appearance settings are taking longer than expected…';
  if (elapsed >= 2_000) return 'Applying your saved appearance…';
  return 'Loading appearance…';
}

type PreferencesContextValue = ReturnType<typeof useOperatorPreferences>;
const PreferencesContext = React.createContext<PreferencesContextValue | null>(null);
export function useOptionalOperatorPreferencesContext() { return React.useContext(PreferencesContext); }
export function useOperatorPreferencesContext() { const value = React.useContext(PreferencesContext); if (!value) throw new Error('Operator preferences context is unavailable'); return value; }

export function OperatorThemeControl() {
  const theme = useOperatorThemeContext(); const busy = theme.status === 'loading' || theme.status === 'saving';
  return <section aria-labelledby="appearance-title" data-tocyn-appearance>
    <h3 id="appearance-title">Appearance</h3>
    <fieldset disabled={busy}><legend className="tocyn-visually-hidden">Theme mode</legend>
      {(['system', 'light', 'dark'] as const).map(mode => <label key={mode}><ParkInput type="radio" name="operator-theme-mode" value={mode} checked={theme.mode === mode} onChange={() => theme.updateMode(mode as OperatorThemeMode)} />{mode === 'system' ? 'Use system setting' : mode === 'light' ? 'Light' : 'Dark'}</label>)}
    </fieldset>
    <div><ParkButton type="button" disabled={busy || theme.status !== 'unsaved'} onClick={() => void theme.save()}>Save appearance</ParkButton>{(theme.status === 'error' || theme.status === 'conflict') && <ParkButton type="button" onClick={theme.retry}>Retry appearance</ParkButton>}{theme.status === 'conflict' && <ParkButton type="button" onClick={theme.restore}>Restore server appearance</ParkButton>}</div>
    <p role="status" aria-live="polite">{theme.error || (theme.status === 'saved' ? 'Appearance saved.' : theme.status === 'saving' ? 'Saving appearance…' : theme.status === 'unsaved' ? 'Unsaved appearance choice.' : '')}</p>
  </section>;
}

export function OperatorPreferencesControl() {
  const preferences = useOperatorPreferencesContext();
  const busy = preferences.status === 'loading' || preferences.status === 'saving' || preferences.schemaUnavailable || preferences.status === 'conflict';
  return <section aria-labelledby="workspace-preferences-title" data-tocyn-appearance data-tocyn-preferences>
    <h3 id="workspace-preferences-title">Workspace preferences</h3>
    <fieldset disabled={busy}><label>Density<ParkSelect aria-label="Workspace density" value={preferences.density} onChange={event => preferences.update({ density: event.target.value as OperatorDensity })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></ParkSelect></label>
    <label>Text size<ParkSelect aria-label="Workspace text size" value={preferences.fontScale} onChange={event => preferences.update({ fontScale: event.target.value as OperatorFontScale })}><option value="normal">Standard</option><option value="large">Large</option><option value="larger">Largest</option></ParkSelect></label>
    <label><ParkInput type="checkbox" checked={preferences.focusMode} onChange={event => preferences.update({ focusMode: event.target.checked })} /> Focus mode</label>
    <label>Motion<ParkSelect aria-label="Workspace motion" value={preferences.motion} onChange={event => preferences.update({ motion: event.target.value as OperatorMotion })}><option value="system">Use system setting</option><option value="reduced">Reduce motion</option><option value="full">Allow motion</option></ParkSelect></label>
    <label>Navigation<ParkSelect aria-label="Navigation labels" value={preferences.navigation} onChange={event => preferences.update({ navigation: event.target.value as 'compact'|'labelled' })}><option value="compact">Compact</option><option value="labelled">Labelled</option></ParkSelect></label>
    <label>Context panel on opening<ParkSelect aria-label="Context panel default" value={preferences.contextDefault} onChange={event => preferences.update({ contextDefault: event.target.value as 'remember'|'conversation'|'details' })}><option value="remember">Remember previous panel</option><option value="conversation">Conversation</option><option value="details">Details</option></ParkSelect></label>
    <label><ParkInput type="checkbox" checked={preferences.shortcutsEnabled} onChange={event => preferences.update({ shortcutsEnabled: event.target.checked })} /> Enable search shortcut</label>
    <label>Activity updates<ParkSelect aria-label="Activity interruption level" value={preferences.interruptionLevel} onChange={event => preferences.update({ interruptionLevel: event.target.value as 'standard'|'quiet' })}><option value="standard">Standard</option><option value="quiet">Quiet — refresh activity manually</option></ParkSelect></label>
    <label><ParkInput type="checkbox" checked={preferences.advanceAfterResolve} onChange={event => preferences.update({ advanceAfterResolve: event.target.checked })} /> Advance after resolving a conversation</label>
    </fieldset>
    <div><ParkButton type="button" disabled={busy || preferences.status !== 'unsaved'} onClick={() => void preferences.save()}>Save workspace preferences</ParkButton>{(preferences.status === 'error' || preferences.status === 'conflict') && <ParkButton type="button" onClick={preferences.retry}>Retry workspace preferences</ParkButton>}{preferences.status === 'conflict' && <ParkButton type="button" onClick={preferences.restore}>Restore server preferences</ParkButton>}</div>
    <p role="status" aria-live="polite">{preferences.error || (preferences.status === 'saved' ? 'Workspace preferences saved.' : preferences.status === 'saving' ? 'Saving workspace preferences…' : preferences.status === 'unsaved' ? 'Unsaved workspace preferences.' : preferences.status === 'loading' ? 'Restoring workspace preferences…' : '')}</p>
  </section>;
}
