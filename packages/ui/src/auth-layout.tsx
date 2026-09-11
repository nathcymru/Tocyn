import { useEffect, useState, type ReactNode } from 'react';
import { AUTH_SPLASH } from '@luminatick/shared/auth-splash';
import { ProductLogo } from './brand';

type Mode = 'light' | 'dark';
function currentMode(): Mode {
  const configured = document.documentElement.getAttribute('data-tocyn-theme-mode');
  return configured === 'light' || configured === 'dark' ? configured
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
/** One decorative choice per visit, stable through errors and verification steps. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const [choice] = useState(() => {
    // A successful password response intentionally remounts the auth cache boundary.
    // Preserve only the decorative choice for this document/history entry, never identity.
    const prior = window.history.state?.tocynAuthVisual;
    return prior?.document === performance.timeOrigin && typeof prior.choice === 'number'
      && prior.choice >= 0 && prior.choice < 1 ? prior.choice : Math.random();
  });
  const [mode, setMode] = useState<Mode>(currentMode);
  const [wide, setWide] = useState(() => window.matchMedia?.('(min-width: 768px)').matches ?? false);
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
  return <div className="tocyn-auth" data-auth-mode={mode}>
    {wide && <aside className="tocyn-auth-splash" aria-hidden="true"><img src={pool[Math.floor(choice * pool.length)]} alt="" /></aside>}
    <main className="tocyn-auth-main"><div className="tocyn-auth-form">
      <ProductLogo className="tocyn-auth-logo" />{children}
    </div></main>
  </div>;
}
