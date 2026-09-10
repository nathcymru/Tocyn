import React, { lazy } from 'react';
import { RouteContent } from './components/RouteContent';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { SettingsLayout } from './components/layout/SettingsLayout';
import { LoginPage } from './pages/LoginPage';
import { MfaPage } from './pages/MfaPage';
const TicketListPage = lazy(() => import('./pages/TicketListPage').then(module => ({ default: module.TicketListPage })));
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage').then(module => ({ default: module.TicketDetailPage })));
const ApiKeyPage = lazy(() => import('./pages/ApiKeyPage').then(module => ({ default: module.ApiKeyPage })));
const AutomationPage = lazy(() => import('./pages/AutomationPage').then(module => ({ default: module.AutomationPage })));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage').then(module => ({ default: module.KnowledgePage })));
const KnowledgeEditorPage = lazy(() => import('./pages/KnowledgeEditorPage').then(module => ({ default: module.KnowledgeEditorPage })));
const EmailChannelPage = lazy(() => import('./pages/EmailChannelPage').then(module => ({ default: module.EmailChannelPage })));
const WidgetChannelPage = lazy(() => import('./pages/WidgetChannelPage').then(module => ({ default: module.WidgetChannelPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then(module => ({ default: module.UsersPage })));
const GroupsPage = lazy(() => import('./pages/GroupsPage').then(module => ({ default: module.GroupsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));
const AgentPermissionsPage = lazy(() => import('./pages/AgentPermissionsPage').then(module => ({ default: module.AgentPermissionsPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })));
const TicketFieldsPage = lazy(() => import('./pages/TicketFieldsPage').then(module => ({ default: module.TicketFieldsPage })));
const FiltersSettingsPage = lazy(() => import('./pages/FiltersSettingsPage').then(module => ({ default: module.FiltersSettingsPage })));
import { SecurityProfilePage } from './pages/SecurityProfilePage';
const UsagePage = lazy(() => import('./pages/UsagePage').then(module => ({ default: module.UsagePage })));
import { useAuthStore } from './store/authStore';

function ProtectedRoute({ children, requireMfa = true }: { children: React.ReactNode, requireMfa?: boolean }) {
  const { token, mfaRequired, user } = useAuthStore();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireMfa && mfaRequired) {
    return <Navigate to="/mfa" replace />;
  }

  // MFA Enforcement: Force agents and admins to set up MFA
  if (user && ['agent', 'admin'].includes(user.role) && !user.mfa_enabled) {
    if (location.pathname !== '/profile/security' && location.pathname !== '/mfa') {
      return <Navigate to="/profile/security" replace />;
    }
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/mfa"
          element={
            <ProtectedRoute requireMfa={false}>
              <MfaPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<RouteContent><DashboardPage /></RouteContent>} />
          <Route path="tickets" element={<RouteContent><TicketListPage /></RouteContent>} />
          <Route path="tickets/:id" element={<RouteContent><TicketDetailPage /></RouteContent>} />
          <Route path="knowledge" element={<RouteContent><KnowledgePage /></RouteContent>} />
          <Route path="knowledge/new" element={<RouteContent><KnowledgeEditorPage /></RouteContent>} />
          <Route path="knowledge/edit/:id" element={<RouteContent><KnowledgeEditorPage /></RouteContent>} />
          <Route path="profile/security" element={<SecurityProfilePage />} />

          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<RouteContent><SettingsPage /></RouteContent>} />
            <Route path="agent-permissions" element={<RouteContent><AgentPermissionsPage /></RouteContent>} />
            <Route path="users" element={<RouteContent><UsersPage /></RouteContent>} />
            <Route path="groups" element={<RouteContent><GroupsPage /></RouteContent>} />
            <Route path="ticket-fields" element={<RouteContent><TicketFieldsPage /></RouteContent>} />
            <Route path="filters" element={<RouteContent><FiltersSettingsPage /></RouteContent>} />
            <Route path="automations" element={<RouteContent><AutomationPage /></RouteContent>} />
            <Route path="api-keys" element={<RouteContent><ApiKeyPage /></RouteContent>} />
            <Route path="usage" element={<RouteContent><UsagePage /></RouteContent>} />
            <Route path="channels/email" element={<RouteContent><EmailChannelPage /></RouteContent>} />
            <Route path="channels/widget" element={<RouteContent><WidgetChannelPage /></RouteContent>} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
