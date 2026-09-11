import * as React from 'react';
import { createTocynThemeScope } from '@luminatick/ui';
import { TocynButton } from '@luminatick/ui/primitives';
import { useOperatorTheme, type OperatorThemeMode } from '../../hooks/useOperatorTheme';

type ThemeContextValue = ReturnType<typeof useOperatorTheme>;
const ThemeContext = React.createContext<ThemeContextValue | null>(null);
export function useOperatorThemeContext() { const value = React.useContext(ThemeContext); if (!value) throw new Error('Operator theme context is unavailable'); return value; }

export function OperatorThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useOperatorTheme();
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
      {children}
    </>}
  </ThemeContext.Provider>;
}

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
