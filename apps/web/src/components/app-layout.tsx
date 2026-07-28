import type { ReactNode } from 'react';
import { NavLink, useHistory } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

export function AppLayout({ children }: { children: ReactNode }): React.JSX.Element {
  const auth = useAuth();
  const history = useHistory();
  const selected = auth.selectedWorkspaceId;
  const canManageUsers =
    auth.user?.workspaces.some((workspace) => workspace.permissions.includes('users.read')) ??
    false;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">AI</span>
          <span>Content OS</span>
        </div>
        <nav aria-label="Navigation principale">
          <NavLink to="/" exact>
            Accueil
          </NavLink>
          <NavLink to="/espaces">Espaces</NavLink>
          {selected && (
            <>
              <NavLink to={`/espaces/${selected}/membres`}>Membres</NavLink>
              <NavLink to={`/espaces/${selected}/sites`}>Sites</NavLink>
            </>
          )}
          {canManageUsers && <NavLink to="/utilisateurs">Utilisateurs</NavLink>}
          <NavLink to="/profil">Mon profil</NavLink>
          <NavLink to="/securite/sessions">Sessions</NavLink>
          <NavLink to="/systeme">Système</NavLink>
        </nav>
        <div className="sidebar-note">Identité, multi-site & Blogger · Phase 2</div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="workspace-picker">
            <span className="eyebrow">Espace de travail</span>
            <select
              aria-label="Espace de travail sélectionné"
              value={selected ?? ''}
              onChange={(event) => {
                auth.selectWorkspace(event.target.value);
                history.push(`/espaces/${event.target.value}`);
              }}
            >
              {auth.user?.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
          <div className="user-menu">
            <div>
              <strong>{auth.user?.displayName ?? auth.user?.email}</strong>
              <small>{auth.user?.email}</small>
            </div>
            <button className="secondary-button" onClick={() => void auth.logout()}>
              Déconnexion
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
