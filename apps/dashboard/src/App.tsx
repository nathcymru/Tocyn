import { AuthLayout } from '@luminatick/ui/auth-layout';
import React, { lazy } from 'react';
import { RouteContent } from './components/RouteContent';
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route, Navigate, useLocation } from 'react-router-dom';
const Layout = lazy(() => import('./components/layout/Layout').then(module => ({ default: module.Layout })));
import { SettingsLayout } from './components/layout/SettingsLayout';
import { LoginPage } from './pages/LoginPage';
import { MfaPage } from './pages/MfaPage';
const InboxWorkspacePage = lazy(() => import('./pages/InboxWorkspacePage').then(module => ({ default: module.InboxWorkspacePage })));
const LegacyTicketsRedirect = lazy(() => import('./pages/LegacyTicketsRedirect').then(module => ({ default: module.LegacyTicketsRedirect })));
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
const SecurityProfilePage = lazy(() => import('./pages/SecurityProfilePage').then(module => ({ default: module.SecurityProfilePage })));
const UsagePage = lazy(() => import('./pages/UsagePage').then(module => ({ default: module.UsagePage })));
const SupportStatesPage = lazy(() => import('./pages/SupportStatesPage').then(module => ({ default: module.SupportStatesPage })));
const SlaSettingsPage = lazy(() => import('./pages/SlaSettingsPage').then(module => ({ default: module.SlaSettingsPage })));
import { useAuthStore } from './store/authStore';
import { CollaborationProvider } from './components/CollaborationContext';

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
  const [router] = React.useState(() => createBrowserRouter(createRoutesFromElements(
      <>
        <Route path="/login" element={<AuthLayout><LoginPage /></AuthLayout>} />
        <Route
          path="/mfa"
          element={
            <ProtectedRoute requireMfa={false}>
              <AuthLayout><MfaPage /></AuthLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RouteContent persistent><Layout /></RouteContent>
            </ProtectedRoute>
          }
        >
          <Route index element={<RouteContent><DashboardPage /></RouteContent>} />
          <Route path="inbox/*" element={<RouteContent persistent><InboxWorkspacePage /></RouteContent>} />
          <Route path="tickets" element={<RouteContent><LegacyTicketsRedirect /></RouteContent>} />
          <Route path="tickets/:id" element={<RouteContent><LegacyTicketsRedirect /></RouteContent>} />
          <Route path="knowledge" element={<RouteContent><KnowledgePage /></RouteContent>} />
          <Route path="knowledge/new" element={<RouteContent><KnowledgeEditorPage /></RouteContent>} />
          <Route path="knowledge/edit/:id" element={<RouteContent><KnowledgeEditorPage /></RouteContent>} />
          <Route path="profile/security" element={<RouteContent><SecurityProfilePage /></RouteContent>} />

          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<RouteContent><SettingsPage /></RouteContent>} />
            <Route path="support-states" element={<RouteContent><SupportStatesPage /></RouteContent>} />
            <Route path="sla" element={<RouteContent><SlaSettingsPage /></RouteContent>} />
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
      </>
  )));
  return <CollaborationProvider><RouterProvider router={router} /></CollaborationProvider>;
}
