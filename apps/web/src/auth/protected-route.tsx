import type { ReactNode } from 'react';
import type { Permission } from '@ai-content-os/contracts';
import { Redirect, useLocation, useParams } from 'react-router-dom';
import { Loading } from '../components/loading';
import { useAuth } from './auth-context';

export function ProtectedRoute({ children }: { children: ReactNode }): React.JSX.Element {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <Loading />;
  if (!auth.user)
    return <Redirect to={{ pathname: '/connexion', state: { from: location.pathname } }} />;
  if (auth.user.mustChangePassword && location.pathname !== '/profil') {
    return <Redirect to="/profil?mot-de-passe=obligatoire" />;
  }
  return <>{children}</>;
}

export function PermissionRoute({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}): React.JSX.Element {
  const auth = useAuth();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  return auth.can(permission, workspaceId) ? <>{children}</> : <Redirect to="/interdit" />;
}
