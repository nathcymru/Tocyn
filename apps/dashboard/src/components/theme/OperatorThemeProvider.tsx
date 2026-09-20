import * as React from 'react';
import { createTocynThemeScope } from '@luminatick/ui';
import { ParkAlert, ParkButton, ParkCheckbox, ParkProgress, ParkRadioGroup, ParkSkeleton } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { useOperatorTheme, type OperatorThemeMode } from '../../hooks/useOperatorTheme';
import { useOperatorPreferences, type OperatorDensity, type OperatorFontScale, type OperatorMotion } from '../../hooks/useOperatorPreferences';
import { DashboardSelect } from '../DashboardSelect';

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
    {startupTimeout && <ParkAlert.Root role="alert" aria-labelledby="appearance-load-error-title" status="error" className={css({ maxW: 'xl', mx: 'auto', my: '8' })}>
      <ParkAlert.Content>
        <ParkAlert.Title asChild><h1 id="appearance-load-error-title" tabIndex={-1}>Appearance settings could not be loaded</h1></ParkAlert.Title>
        <ParkAlert.Description>{theme.error}</ParkAlert.Description>
        <ParkButton type="button" variant="outline" onClick={theme.retry}>Retry appearance</ParkButton>
      </ParkAlert.Content>
    </ParkAlert.Root>}
    {loading && <section role="status" aria-live="polite" aria-label="Restoring appearance" className={css({ display: 'grid', gap: '3', maxW: 'xl', mx: 'auto', my: '4', p: '4', bg: 'bg.surface', borderWidth: '1px', borderColor: 'border.default', rounded: 'lg' })}>
      <div className={css({ display: 'grid', gap: '2', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' })} aria-hidden="true"><ParkSkeleton /><ParkSkeleton /><ParkSkeleton /></div>
      <ParkProgress value={null} label={loadingMessage} />
      <p>Workspace controls remain available while appearance settings load.</p>
    </section>}
    {(theme.status === 'error' || theme.status === 'conflict') && !startupTimeout && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content>
      <ParkAlert.Description>{theme.error || 'Appearance could not be restored.'}</ParkAlert.Description>
      <ParkButton type="button" variant="outline" onClick={theme.retry}>Retry appearance</ParkButton>
    </ParkAlert.Content></ParkAlert.Root>}
    <PreferencesContext.Provider value={preferences}>{children}</PreferencesContext.Provider>
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
  const localStatus = theme.status === 'error' || theme.status === 'conflict' ? '' : theme.error
    || (theme.status === 'saved' ? 'Appearance saved.' : theme.status === 'unsaved' ? 'Unsaved appearance choice.' : '');
  return <section aria-labelledby="appearance-title" data-tocyn-appearance className={css({ display: 'grid', gap: '4', py: '1' })}>
    <h3 id="appearance-title">Appearance</h3>
    <ParkRadioGroup.Root value={theme.mode} onValueChange={({ value }) => theme.updateMode(value as OperatorThemeMode)} disabled={busy} aria-label="Theme mode">
      {(['system', 'light', 'dark'] as const).map(mode => <ParkRadioGroup.Item key={mode} value={mode}>
        <ParkRadioGroup.ItemControl><ParkRadioGroup.Indicator /></ParkRadioGroup.ItemControl>
        <ParkRadioGroup.ItemText>{mode === 'system' ? 'Use system setting' : mode === 'light' ? 'Light' : 'Dark'}</ParkRadioGroup.ItemText>
        <ParkRadioGroup.ItemHiddenInput />
      </ParkRadioGroup.Item>)}
    </ParkRadioGroup.Root>
    <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}><ParkButton type="button" disabled={busy || theme.status !== 'unsaved'} onClick={() => void theme.save()}>Save appearance</ParkButton>{(theme.status === 'error' || theme.status === 'conflict') && <ParkButton type="button" onClick={theme.retry}>Retry appearance</ParkButton>}{theme.status === 'conflict' && <ParkButton type="button" onClick={theme.restore}>Restore server appearance</ParkButton>}</div>
    {theme.status === 'saving' ? <div role="status" aria-live="polite"><ParkProgress value={null} label="Saving appearance…" /></div>
      : localStatus && <ParkAlert.Root role="status" aria-live="polite" status={theme.error ? 'warning' : theme.status === 'saved' ? 'success' : 'info'}><ParkAlert.Content><ParkAlert.Description>{localStatus}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
  </section>;
}

export function OperatorPreferencesControl() {
  const preferences = useOperatorPreferencesContext();
  const busy = preferences.status === 'loading' || preferences.status === 'saving' || preferences.schemaUnavailable || preferences.status === 'conflict';
  const localStatus = preferences.error || (preferences.status === 'saved' ? 'Workspace preferences saved.'
    : preferences.status === 'unsaved' ? 'Unsaved workspace preferences.' : '');
  return <section aria-labelledby="workspace-preferences-title" data-tocyn-appearance data-tocyn-preferences className={css({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minW: '0', w: 'full', gap: '4', py: '1' })}>
    <h3 id="workspace-preferences-title">Workspace preferences</h3>
    <fieldset disabled={busy} className={css({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minW: '0', w: 'full', gap: '3', m: '0', p: '0', border: '0' })}>
      <DashboardSelect label="Workspace density" aria-label="Workspace density" disabled={busy} value={preferences.density} onValueChange={value => preferences.update({ density: value as OperatorDensity })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
      <DashboardSelect label="Workspace text size" aria-label="Workspace text size" disabled={busy} value={preferences.fontScale} onValueChange={value => preferences.update({ fontScale: value as OperatorFontScale })} options={[{ value: 'normal', label: 'Standard' }, { value: 'large', label: 'Large' }, { value: 'larger', label: 'Largest' }]} />
      <ParkCheckbox.Root checked={preferences.focusMode} disabled={busy} onCheckedChange={({ checked }) => preferences.update({ focusMode: checked === true })}><ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.Label>Focus mode</ParkCheckbox.Label><ParkCheckbox.HiddenInput /></ParkCheckbox.Root>
      <DashboardSelect label="Workspace motion" aria-label="Workspace motion" disabled={busy} value={preferences.motion} onValueChange={value => preferences.update({ motion: value as OperatorMotion })} options={[{ value: 'system', label: 'Use system setting' }, { value: 'reduced', label: 'Reduce motion' }, { value: 'full', label: 'Allow motion' }]} />
      <DashboardSelect label="Navigation labels" aria-label="Navigation labels" disabled={busy} value={preferences.navigation} onValueChange={value => preferences.update({ navigation: value as 'compact' | 'labelled' })} options={[{ value: 'compact', label: 'Compact' }, { value: 'labelled', label: 'Labelled' }]} />
      <DashboardSelect label="Context panel default" aria-label="Context panel default" disabled={busy} value={preferences.contextDefault} onValueChange={value => preferences.update({ contextDefault: value as 'remember' | 'conversation' | 'details' })} options={[{ value: 'remember', label: 'Remember previous panel' }, { value: 'conversation', label: 'Conversation' }, { value: 'details', label: 'Details' }]} />
      <ParkCheckbox.Root checked={preferences.shortcutsEnabled} disabled={busy} onCheckedChange={({ checked }) => preferences.update({ shortcutsEnabled: checked === true })}><ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.Label>Enable search shortcut</ParkCheckbox.Label><ParkCheckbox.HiddenInput /></ParkCheckbox.Root>
      <DashboardSelect label="Activity interruption level" aria-label="Activity interruption level" disabled={busy} value={preferences.interruptionLevel} onValueChange={value => preferences.update({ interruptionLevel: value as 'standard' | 'quiet' })} options={[{ value: 'standard', label: 'Standard' }, { value: 'quiet', label: 'Quiet — refresh activity manually' }]} />
      <ParkCheckbox.Root checked={preferences.advanceAfterResolve} disabled={busy} onCheckedChange={({ checked }) => preferences.update({ advanceAfterResolve: checked === true })}><ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.Label>Advance after resolving a conversation</ParkCheckbox.Label><ParkCheckbox.HiddenInput /></ParkCheckbox.Root>
    </fieldset>
    <div className={css({ display: 'flex', minW: '0', w: 'full', gap: '2', flexWrap: 'wrap', '& > button': { minW: '0', maxW: 'full', h: 'auto', minH: '10', py: '2', whiteSpace: 'normal' } })}><ParkButton type="button" disabled={busy || preferences.status !== 'unsaved'} onClick={() => void preferences.save()}>Save workspace preferences</ParkButton>{(preferences.status === 'error' || preferences.status === 'conflict') && <ParkButton type="button" onClick={preferences.retry}>Retry workspace preferences</ParkButton>}{preferences.status === 'conflict' && <ParkButton type="button" onClick={preferences.restore}>Restore server preferences</ParkButton>}</div>
    {preferences.status === 'loading' || preferences.status === 'saving'
      ? <div role="status" aria-live="polite"><ParkProgress value={null} label={preferences.status === 'loading' ? 'Restoring workspace preferences…' : 'Saving workspace preferences…'} /></div>
      : localStatus && <ParkAlert.Root role={preferences.error ? 'alert' : 'status'} aria-live={preferences.error ? undefined : 'polite'} status={preferences.error ? 'error' : preferences.status === 'saved' ? 'success' : 'info'}><ParkAlert.Content><ParkAlert.Description>{localStatus}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
  </section>;
}
