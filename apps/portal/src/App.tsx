import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
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
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { login, logout, setLoading } = useAuthStore();
  const localCaptureRoute = import.meta.env.DEV && window.location.pathname === '/__local/auth-capture';

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
        {LocalAuthCapturePage && <Route path="/__local/auth-capture" element={<Suspense fallback={<p>Loading local capture…</p>}><LocalAuthCapturePage /></Suspense>} />}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/tickets" replace />} />
          <Route path="tickets" element={<RouteContent><TicketListPage /></RouteContent>} />
          <Route path="tickets/:id" element={<RouteContent><TicketDetailPage /></RouteContent>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
