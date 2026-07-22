import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/auth-context';
import { PermissionRoute, ProtectedRoute } from './auth/protected-route';
import { AppLayout } from './components/app-layout';
import { ErrorBoundary } from './components/error-boundary';
import { ContentProfilesPage } from './pages/content-profiles/content-profiles';
import { DashboardPage } from './pages/dashboard';
import { ForbiddenPage } from './pages/forbidden';
import { LoginPage } from './pages/auth/login';
import { ProfilePage } from './pages/auth/profile';
import { SessionsPage } from './pages/auth/sessions';
import { NotFoundPage } from './pages/not-found';
import { SystemStatusPage } from './pages/system-status';
import { UsersPage } from './pages/users/users';
import { MembersPage } from './pages/workspaces/members';
import { WorkspaceDetailsPage } from './pages/workspaces/workspace-details';
import { WorkspacesPage } from './pages/workspaces/workspaces';
import { WebsiteFormPage } from './pages/websites/website-form';
import { WebsitesPage } from './pages/websites/websites';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

export function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/connexion" element={<LoginPage />} />
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="profil" element={<ProfilePage />} />
                <Route path="securite/sessions" element={<SessionsPage />} />
                <Route path="espaces" element={<WorkspacesPage />} />
                <Route path="espaces/:workspaceId" element={<WorkspaceDetailsPage />} />
                <Route
                  path="espaces/:workspaceId/membres"
                  element={
                    <PermissionRoute permission="members.read">
                      <MembersPage />
                    </PermissionRoute>
                  }
                />
                <Route
                  path="espaces/:workspaceId/sites"
                  element={
                    <PermissionRoute permission="websites.read">
                      <WebsitesPage />
                    </PermissionRoute>
                  }
                />
                <Route
                  path="espaces/:workspaceId/sites/nouveau"
                  element={
                    <PermissionRoute permission="websites.create">
                      <WebsiteFormPage />
                    </PermissionRoute>
                  }
                />
                <Route
                  path="espaces/:workspaceId/sites/:websiteId"
                  element={
                    <PermissionRoute permission="websites.read">
                      <WebsiteFormPage />
                    </PermissionRoute>
                  }
                />
                <Route
                  path="espaces/:workspaceId/sites/:websiteId/profils-editoriaux"
                  element={
                    <PermissionRoute permission="contentProfiles.read">
                      <ContentProfilesPage />
                    </PermissionRoute>
                  }
                />
                <Route
                  path="utilisateurs"
                  element={
                    <PermissionRoute permission="users.read">
                      <UsersPage />
                    </PermissionRoute>
                  }
                />
                <Route path="systeme" element={<SystemStatusPage />} />
                <Route path="interdit" element={<ForbiddenPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
