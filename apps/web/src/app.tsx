import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Switch } from 'react-router-dom';
import { AuthProvider } from './auth/auth-context';
import { PermissionRoute, ProtectedRoute } from './auth/protected-route';
import { AppLayout } from './components/app-layout';
import { ErrorBoundary } from './components/error-boundary';
import { ContentProfilesPage } from './pages/content-profiles/content-profiles';
import {
  ContentEditorPage,
  ContentListPage,
  ContentRevisionsPage,
} from './pages/contents/content-ui';
import { ReviewCenterPage } from './pages/contents/review-center';
import { DashboardPage } from './pages/dashboard';
import { ForbiddenPage } from './pages/forbidden';
import { LoginPage } from './pages/auth/login';
import { ProfilePage } from './pages/auth/profile';
import { SessionsPage } from './pages/auth/sessions';
import { NotFoundPage } from './pages/not-found';
import { SystemStatusPage } from './pages/system-status';
import { BloggerIntegrationPage } from './pages/integrations/blogger';
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
            <Switch>
              <Route exact path="/connexion">
                <LoginPage />
              </Route>
              <Route>
                <ProtectedRoute>
                  <AppLayout>
                    <Switch>
                      <Route exact path="/">
                        <DashboardPage />
                      </Route>
                      <Route exact path="/profil">
                        <ProfilePage />
                      </Route>
                      <Route exact path="/securite/sessions">
                        <SessionsPage />
                      </Route>
                      <Route exact path="/espaces">
                        <WorkspacesPage />
                      </Route>
                      <Route exact path="/espaces/:workspaceId">
                        <WorkspaceDetailsPage />
                      </Route>
                      <Route exact path="/espaces/:workspaceId/membres">
                        <PermissionRoute permission="members.read">
                          <MembersPage />
                        </PermissionRoute>
                      </Route>
                      <Route exact path="/espaces/:workspaceId/sites">
                        <PermissionRoute permission="websites.read">
                          <WebsitesPage />
                        </PermissionRoute>
                      </Route>
                      <Route exact path="/espaces/:workspaceId/sites/nouveau">
                        <PermissionRoute permission="websites.create">
                          <WebsiteFormPage />
                        </PermissionRoute>
                      </Route>
                      <Route exact path="/espaces/:workspaceId/sites/:websiteId">
                        <PermissionRoute permission="websites.read">
                          <WebsiteFormPage />
                        </PermissionRoute>
                      </Route>
                      <Route exact path="/espaces/:workspaceId/sites/:websiteId/profils-editoriaux">
                        <PermissionRoute permission="contentProfiles.read">
                          <ContentProfilesPage />
                        </PermissionRoute>
                      </Route>
                      <Route exact path="/espaces/:workspaceId/sites/:websiteId/contenus">
                        <PermissionRoute permission="contents.read">
                          <ContentListPage />
                        </PermissionRoute>
                      </Route>
                      <Route exact path="/espaces/:workspaceId/sites/:websiteId/centre-revision">
                        <PermissionRoute permission="contents.read">
                          <ReviewCenterPage />
                        </PermissionRoute>
                      </Route>
                      <Route exact path="/espaces/:workspaceId/sites/:websiteId/contenus/nouveau">
                        <PermissionRoute permission="contents.create">
                          <ContentEditorPage />
                        </PermissionRoute>
                      </Route>
                      <Route
                        exact
                        path="/espaces/:workspaceId/sites/:websiteId/contenus/:contentId/versions"
                      >
                        <PermissionRoute permission="contents.revisions.read">
                          <ContentRevisionsPage />
                        </PermissionRoute>
                      </Route>
                      <Route
                        exact
                        path="/espaces/:workspaceId/sites/:websiteId/contenus/:contentId"
                      >
                        <PermissionRoute permission="contents.read">
                          <ContentEditorPage />
                        </PermissionRoute>
                      </Route>
                      <Route
                        exact
                        path="/espaces/:workspaceId/sites/:websiteId/integrations/blogger"
                      >
                        <PermissionRoute permission="integrations.read">
                          <BloggerIntegrationPage />
                        </PermissionRoute>
                      </Route>
                      {[
                        '/espaces/:workspaceId/sites/:websiteId/integrations',
                        '/espaces/:workspaceId/sites/:websiteId/integrations/blogger/selection',
                        '/espaces/:workspaceId/sites/:websiteId/contenu-externe',
                        '/espaces/:workspaceId/sites/:websiteId/libelles-externes',
                        '/espaces/:workspaceId/sites/:websiteId/test-publication',
                      ].map((path) => (
                        <Route exact key={path} path={path}>
                          <PermissionRoute permission="integrations.read">
                            <BloggerIntegrationPage />
                          </PermissionRoute>
                        </Route>
                      ))}
                      <Route exact path="/utilisateurs">
                        <PermissionRoute permission="users.read">
                          <UsersPage />
                        </PermissionRoute>
                      </Route>
                      <Route exact path="/systeme">
                        <SystemStatusPage />
                      </Route>
                      <Route exact path="/interdit">
                        <ForbiddenPage />
                      </Route>
                      <Route>
                        <NotFoundPage />
                      </Route>
                    </Switch>
                  </AppLayout>
                </ProtectedRoute>
              </Route>
            </Switch>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
