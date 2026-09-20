import { p } from './portalStyles';
import { AuthLayout } from '@luminatick/ui/auth-layout';
import { ParkEmptyState } from '@luminatick/ui/park';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useLayoutEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { portalApi } from './api/client';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { VerifyPage } from './pages/VerifyPage';
import { RouteContent } from './components/RouteContent';

const TicketListPage = lazy(() => import('./pages/TicketListPage').then(module => ({ default: module.TicketListPage })));
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage').then(module => ({ default: module.TicketDetailPage })));

const LocalAuthCapturePage = import.meta.env.DEV ? lazy(() => import('./pages/LocalAuthCapturePage').then(module => ({ default: module.LocalAuthCapturePage }))) : null;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <ParkEmptyState role="status" title="Loading portal…" headingLevel={false} aria-busy="true" className={p.appLoading} />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { login, logout, setLoading } = useAuthStore();
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
    let active = true;
    portalApi.get<{ user: { id: string; name: string; email: string } }>('/auth/me')
      .then((data) => {
        if (active && useAuthStore.getState().authGeneration === bootstrapGeneration) login(data.user);
      })
      .catch(() => {
        if (active && useAuthStore.getState().authGeneration === bootstrapGeneration) logout();
      })
      .finally(() => {
        if (active && useAuthStore.getState().authGeneration === bootstrapGeneration) setLoading(false);
      });
    return () => { active = false; };
  }, [localCaptureRoute, login, logout, setLoading]);

  return (
    <BrowserRouter>
      <Routes>
        {LocalAuthCapturePage && <Route path="/__local/auth-capture" element={<Suspense fallback={<ParkEmptyState role="status" title="Loading local capture…" headingLevel={false} aria-busy="true" className={p.routeLoading} />}><LocalAuthCapturePage /></Suspense>} />}
        <Route path="/login" element={<AuthLayout><LoginPage /></AuthLayout>} />
        <Route path="/verify" element={<AuthLayout><VerifyPage /></AuthLayout>} />
        
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/tickets" replace />} />
          <Route path="tickets" element={<RouteContent><TicketListPage /></RouteContent>} />
          <Route path="tickets/:id" element={<RouteContent><TicketDetailPage /></RouteContent>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
