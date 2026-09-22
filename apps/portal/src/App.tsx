import { p } from './portalStyles';
import { AuthLayout } from '@luminatick/ui/auth-layout';
import { ParkButton, ParkEmptyState } from '@luminatick/ui/park';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuthStore } from './store/authStore';
import { ApiError, portalApi } from './api/client';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { VerifyPage } from './pages/VerifyPage';
import { PortalLoadingSkeleton, RouteContent } from './components/RouteContent';

const TicketListPage = lazy(() => import('./pages/TicketListPage').then(module => ({ default: module.TicketListPage })));
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage').then(module => ({ default: module.TicketDetailPage })));

const LocalAuthCapturePage = import.meta.env.DEV ? lazy(() => import('./pages/LocalAuthCapturePage').then(module => ({ default: module.LocalAuthCapturePage }))) : null;

const BOOTSTRAP_TIMEOUT_MS = 8000;

function ProtectedRoute({ children, bootstrapError, retry }: { children: React.ReactNode; bootstrapError: boolean; retry: () => void }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (bootstrapError && !isAuthenticated) {
    return <ParkEmptyState role="alert" title="Portal could not be loaded" description="Your session could not be checked. Try again." className={p.appLoading} action={<ParkButton type="button" onClick={retry}>Retry loading portal</ParkButton>} />;
  }

  if (isLoading) {
    return <PortalLoadingSkeleton label="Loading portal…" className={p.appLoading} />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { login, logout, setLoading } = useAuthStore();
  const [bootstrapError, setBootstrapError] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const attemptRef = useRef(0);
  const localCaptureRoute = import.meta.env.DEV && window.location.pathname === '/__local/auth-capture';

  useLayoutEffect(() => {
    // Park palette aliases are defined on html. A dark child shell alone can
    // retain light outline and plain button colours against dark surfaces.
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    const darkPreference = window.matchMedia?.('(prefers-color-scheme: dark)');
    const sync = () => {
      const configured = root.getAttribute('data-tocyn-theme-mode');
      root.classList.toggle('dark', configured === 'dark' || (configured !== 'light' && Boolean(darkPreference?.matches)));
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-tocyn-theme-mode'] });
    darkPreference?.addEventListener('change', sync);
    sync();
    return () => {
      observer.disconnect();
      darkPreference?.removeEventListener('change', sync);
      root.classList.toggle('dark', wasDark);
    };
  }, []);

  useEffect(() => {
    if (localCaptureRoute) {
      return;
    }
    const bootstrapGeneration = useAuthStore.getState().authGeneration;
    const attempt = ++attemptRef.current;
    let active = true;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error('Portal session check timed out')); }, BOOTSTRAP_TIMEOUT_MS);
    });
    const current = () => active && attempt === attemptRef.current && useAuthStore.getState().authGeneration === bootstrapGeneration;
    Promise.race([portalApi.get<{ user: { id: string; name: string; email: string } }>('/auth/me', { signal: controller.signal }), deadline])
      .then((data) => {
        if (current()) login(data.user);
      })
      .catch((error: unknown) => {
        if (!current()) return;
        if (error instanceof ApiError && error.status === 401) logout();
        else setBootstrapError(true);
      })
      .finally(() => {
        clearTimeout(timeout);
      });
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [localCaptureRoute, login, logout, setLoading, bootstrapAttempt]);

  const retryBootstrap = () => {
    setBootstrapError(false);
    setLoading(true);
    setBootstrapAttempt(attempt => attempt + 1);
  };

  return (
    <BrowserRouter>
      <Routes>
        {LocalAuthCapturePage && <Route path="/__local/auth-capture" element={<Suspense fallback={<PortalLoadingSkeleton label="Loading local capture…" className={p.routeLoading} />}><LocalAuthCapturePage /></Suspense>} />}
        <Route path="/login" element={<AuthLayout><LoginPage /></AuthLayout>} />
        <Route path="/verify" element={<AuthLayout><VerifyPage /></AuthLayout>} />
        
        <Route path="/" element={<ProtectedRoute bootstrapError={bootstrapError} retry={retryBootstrap}><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/tickets" replace />} />
          <Route path="tickets" element={<RouteContent><TicketListPage /></RouteContent>} />
          <Route path="tickets/:id" element={<RouteContent><TicketDetailPage /></RouteContent>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
