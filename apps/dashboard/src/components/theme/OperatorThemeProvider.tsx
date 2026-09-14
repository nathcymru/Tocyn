import * as React from 'react';
import { createTocynThemeScope } from '@luminatick/ui';
import { TocynButton, TocynSelect } from '@luminatick/ui/primitives';
import { useOperatorTheme, type OperatorThemeMode } from '../../hooks/useOperatorTheme';
import { useOperatorPreferences, OPERATOR_TABLE_COLUMNS, type OperatorDensity, type OperatorFontScale, type OperatorMotion } from '../../hooks/useOperatorPreferences';

type ThemeContextValue = ReturnType<typeof useOperatorTheme>;
const ThemeContext = React.createContext<ThemeContextValue | null>(null);
export function useOperatorThemeContext() { const value = React.useContext(ThemeContext); if (!value) throw new Error('Operator theme context is unavailable'); return value; }

export function OperatorThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useOperatorTheme();
  const preferences = useOperatorPreferences();
  const scope = React.useRef<ReturnType<typeof createTocynThemeScope> | null>(null);
  const hasResolved = React.useRef(false);
  if (theme.status !== 'loading' && theme.status !== 'idle') hasResolved.current = true;
  React.useLayoutEffect(() => {
    if (typeof document === 'undefined' || theme.status === 'loading' || theme.status === 'idle') {
      if (theme.status === 'idle') { scope.current?.remove(); scope.current = null; }
      return;
    }
    const input = { mode: theme.resolvedMode, tenant: theme.theme[theme.resolvedMode] } as const;
    if (!scope.current) scope.current = createTocynThemeScope(document.documentElement, input); else scope.current.apply(input);
  }, [theme.resolvedMode, theme.theme, theme.status]);
  React.useEffect(() => () => { scope.current?.remove(); scope.current = null; }, []);
  const loading = !hasResolved.current && theme.status === 'loading';
  return <ThemeContext.Provider value={theme}>
    {loading ? <div role="status" aria-live="polite" className="min-h-screen flex items-center justify-center bg-[var(--tocyn-app-surface)] text-[var(--tocyn-app-text)]">Loading appearance…</div> : <>
      {(theme.status === 'error' || theme.status === 'conflict') && <div role="alert" className="flex items-center justify-center gap-3 border-b border-[var(--tocyn-app-border)] bg-[var(--tocyn-app-surface)] px-4 py-2 text-sm text-[var(--tocyn-app-text)]"><span>{theme.error || 'Appearance could not be restored.'}</span><TocynButton type="button" onClick={theme.retry} className="min-h-11 rounded border border-[var(--tocyn-app-border)] px-3 py-1 text-sm">Retry appearance</TocynButton></div>}
      <PreferencesContext.Provider value={preferences}>{children}</PreferencesContext.Provider>
    </>}
  </ThemeContext.Provider>;
}

type PreferencesContextValue = ReturnType<typeof useOperatorPreferences>;
const PreferencesContext = React.createContext<PreferencesContextValue | null>(null);
export function useOptionalOperatorPreferencesContext() { return React.useContext(PreferencesContext); }
export function useOperatorPreferencesContext() { const value = React.useContext(PreferencesContext); if (!value) throw new Error('Operator preferences context is unavailable'); return value; }

export function OperatorThemeControl() {
  const theme = useOperatorThemeContext(); const busy = theme.status === 'loading' || theme.status === 'saving';
  return <section aria-labelledby="appearance-title" data-tocyn-appearance>
    <h3 id="appearance-title">Appearance</h3>
    <fieldset disabled={busy}><legend className="sr-only">Theme mode</legend>
      {(['system', 'light', 'dark'] as const).map(mode => <label key={mode}><input type="radio" name="operator-theme-mode" value={mode} checked={theme.mode === mode} onChange={() => theme.updateMode(mode as OperatorThemeMode)} />{mode === 'system' ? 'Use system setting' : mode === 'light' ? 'Light' : 'Dark'}</label>)}
    </fieldset>
    <div><TocynButton type="button" disabled={busy || theme.status !== 'unsaved'} onClick={() => void theme.save()}>Save appearance</TocynButton>{(theme.status === 'error' || theme.status === 'conflict') && <TocynButton type="button" onClick={theme.retry}>Retry appearance</TocynButton>}{theme.status === 'conflict' && <TocynButton type="button" onClick={theme.restore}>Restore server appearance</TocynButton>}</div>
    <p role="status" aria-live="polite">{theme.error || (theme.status === 'saved' ? 'Appearance saved.' : theme.status === 'saving' ? 'Saving appearance…' : theme.status === 'unsaved' ? 'Unsaved appearance choice.' : '')}</p>
  </section>;
}

export function TableColumnsControl({ preferences }: { preferences: Pick<ReturnType<typeof useOperatorPreferences>, 'tableColumns' | 'update'> }) {
  type Column = typeof OPERATOR_TABLE_COLUMNS[number];
  const rowRefs = React.useRef(new Map<Column, HTMLDivElement>());
  const pendingFocus = React.useRef<{ column: Column; delta: -1 | 1 } | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  React.useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const buttons = Array.from(rowRefs.current.get(pending.column)?.querySelectorAll('button') ?? []);
    const preferred = buttons[pending.delta === -1 ? 0 : 1];
    (preferred && !preferred.disabled ? preferred : buttons.find(button => !button.disabled))?.focus();
  }, [preferences.tableColumns]);
  const ordered = [...preferences.tableColumns, ...OPERATOR_TABLE_COLUMNS.filter(column => !preferences.tableColumns.includes(column))];
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= preferences.tableColumns.length) return;
    const next = [...preferences.tableColumns];
    [next[index], next[target]] = [next[target], next[index]];
    pendingFocus.current = { column: preferences.tableColumns[index], delta };
    preferences.update({ tableColumns: next });
    setAnnouncement(`${preferences.tableColumns[index]} moved to column ${target + 1} of ${next.length}.`);
  };
  return <fieldset><legend>Table columns</legend>
    {ordered.map(column => {
      const index = preferences.tableColumns.indexOf(column); const visible = index >= 0;
      return <div key={column} ref={element => { if (element) rowRefs.current.set(column, element); else rowRefs.current.delete(column); }} role="group" aria-label={`${column} table column`}>
        <label><input type="checkbox" checked={visible} disabled={column === 'reference'} onChange={event => { if (column !== 'reference') preferences.update({ tableColumns: event.target.checked ? [...preferences.tableColumns, column] : preferences.tableColumns.filter(item => item !== column) }); }} /> {column}</label>
        {visible && <><TocynButton type="button" aria-label={`Move ${column} table column up`} disabled={index === 0} onClick={() => move(index, -1)} onKeyDown={event => { if (event.key === 'ArrowUp') { event.preventDefault(); move(index, -1); } }}>↑</TocynButton>
          <TocynButton type="button" aria-label={`Move ${column} table column down`} disabled={index === preferences.tableColumns.length - 1} onClick={() => move(index, 1)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); move(index, 1); } }}>↓</TocynButton></>}
      </div>;
    })}
    <p role="status" aria-live="polite">{announcement}</p>
  </fieldset>;
}

export function OperatorPreferencesControl() {
  const preferences = useOperatorPreferencesContext();
  const busy = preferences.status === 'loading' || preferences.status === 'saving' || preferences.schemaUnavailable || preferences.status === 'conflict';
  return <section aria-labelledby="workspace-preferences-title" data-tocyn-appearance data-tocyn-preferences>
    <h3 id="workspace-preferences-title">Workspace preferences</h3>
    <fieldset disabled={busy}><label>Density<TocynSelect aria-label="Workspace density" value={preferences.density} onChange={event => preferences.update({ density: event.target.value as OperatorDensity })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></TocynSelect></label>
    <label>Text size<TocynSelect aria-label="Workspace text size" value={preferences.fontScale} onChange={event => preferences.update({ fontScale: event.target.value as OperatorFontScale })}><option value="normal">Standard</option><option value="large">Large</option><option value="larger">Largest</option></TocynSelect></label>
    <label><input type="checkbox" checked={preferences.focusMode} onChange={event => preferences.update({ focusMode: event.target.checked })} /> Focus mode</label>
    <label>Motion<TocynSelect aria-label="Workspace motion" value={preferences.motion} onChange={event => preferences.update({ motion: event.target.value as OperatorMotion })}><option value="system">Use system setting</option><option value="reduced">Reduce motion</option><option value="full">Allow motion</option></TocynSelect></label>
    <label>Navigation<TocynSelect aria-label="Navigation labels" value={preferences.navigation} onChange={event => preferences.update({ navigation: event.target.value as 'compact'|'labelled' })}><option value="compact">Compact</option><option value="labelled">Labelled</option></TocynSelect></label>
    <label>Context panel on opening<TocynSelect aria-label="Context panel default" value={preferences.contextDefault} onChange={event => preferences.update({ contextDefault: event.target.value as 'remember'|'conversation'|'details' })}><option value="remember">Remember previous panel</option><option value="conversation">Conversation</option><option value="details">Details</option></TocynSelect></label>
    <label><input type="checkbox" checked={preferences.shortcutsEnabled} onChange={event => preferences.update({ shortcutsEnabled: event.target.checked })} /> Enable search shortcut</label>
    <label>Activity updates<TocynSelect aria-label="Activity interruption level" value={preferences.interruptionLevel} onChange={event => preferences.update({ interruptionLevel: event.target.value as 'standard'|'quiet' })}><option value="standard">Standard</option><option value="quiet">Quiet — refresh activity manually</option></TocynSelect></label>
    <label><input type="checkbox" checked={preferences.advanceAfterResolve} onChange={event => preferences.update({ advanceAfterResolve: event.target.checked })} /> Advance after resolving a conversation</label>
    <TableColumnsControl preferences={preferences} />
    </fieldset>
    <div><TocynButton type="button" disabled={busy || preferences.status !== 'unsaved'} onClick={() => void preferences.save()}>Save workspace preferences</TocynButton>{(preferences.status === 'error' || preferences.status === 'conflict') && <TocynButton type="button" onClick={preferences.retry}>Retry workspace preferences</TocynButton>}{preferences.status === 'conflict' && <TocynButton type="button" onClick={preferences.restore}>Restore server preferences</TocynButton>}</div>
    <p role="status" aria-live="polite">{preferences.error || (preferences.status === 'saved' ? 'Workspace preferences saved.' : preferences.status === 'saving' ? 'Saving workspace preferences…' : preferences.status === 'unsaved' ? 'Unsaved workspace preferences.' : preferences.status === 'loading' ? 'Restoring workspace preferences…' : '')}</p>
  </section>;
}
