import { NavLink, Outlet } from 'react-router-dom';

export function AppLayout(): React.JSX.Element {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">AI</span>
          <span>Content OS</span>
        </div>
        <nav aria-label="Navigation principale">
          <NavLink to="/" end>
            Tableau de bord
          </NavLink>
          <NavLink to="/systeme">État du système</NavLink>
        </nav>
        <div className="sidebar-note">Fondation · Phase 0</div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div>
            <span className="eyebrow">Espace de travail</span>
            <strong>Console d’administration</strong>
          </div>
          <span className="environment-badge">Développement</span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
