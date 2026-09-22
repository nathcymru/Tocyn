import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AUTH_SPLASH } from '@luminatick/shared/auth-splash';
import { ProductLogo } from './brand';
import { authShell } from './styles/generated/recipes';

type Mode = 'light' | 'dark';
const AuthMode = createContext<Mode>('light');
export function AuthLogo({ className }: { className?: string }) {
  return <ProductLogo mode={useContext(AuthMode)} className={className} />;
}
function currentMode(): Mode {
  const configured = document.documentElement.getAttribute('data-tocyn-theme-mode');
  return configured === 'light' || configured === 'dark' ? configured
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
/** One decorative choice per visit, stable through errors and verification steps. */
export function AuthLayout({ children, showOuterLogo = true }: { children: ReactNode; showOuterLogo?: boolean }) {
  const [choice] = useState(() => {
    // A successful password response intentionally remounts the auth cache boundary.
    // Preserve only the decorative choice for this document/history entry, never identity.
    const prior = window.history.state?.tocynAuthVisual ?? window.history.state?.usr?.tocynAuthVisual;
    return prior?.document === performance.timeOrigin && typeof prior.choice === 'number'
      && prior.choice >= 0 && prior.choice < 1 ? prior.choice : Math.random();
  });
  const [mode, setMode] = useState<Mode>(currentMode);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    try { window.history.replaceState({ ...window.history.state, tocynAuthVisual: { document: performance.timeOrigin, choice } }, ''); } catch { /* Decoration cannot prevent authentication. */ }
    const theme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const size = window.matchMedia?.('(min-width: 768px)');
    const update = () => { setMode(currentMode()); setWide(size?.matches ?? false); };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tocyn-theme-mode'] });
    theme?.addEventListener('change', update); size?.addEventListener('change', update); update();
    return () => { observer.disconnect(); theme?.removeEventListener('change', update); size?.removeEventListener('change', update); };
  }, [choice]);
  const pool = AUTH_SPLASH[mode];
  const styles = authShell();
  return <AuthMode.Provider value={mode}><div className={[styles.root, mode === 'dark' ? 'dark' : ''].filter(Boolean).join(' ')} data-auth-mode={mode} data-tocyn-theme-mode={mode}>
    {wide && <aside className={styles.splash} aria-hidden="true"><img className={styles.image} src={pool[Math.floor(choice * pool.length)]} alt="" /></aside>}
    <main className={styles.main}><div className={styles.form}>
      {showOuterLogo && <ProductLogo mode={mode} className={styles.logo} />}{children}
    </div></main>
  </div></AuthMode.Provider>;
}
