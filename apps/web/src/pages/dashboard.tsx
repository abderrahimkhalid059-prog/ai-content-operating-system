import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

export function DashboardPage(): React.JSX.Element {
  const auth = useAuth();
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Vue d’ensemble</span>
          <h1>Bienvenue, {auth.user?.displayName ?? 'administrateur'}</h1>
        </div>
      </div>
      <div className="welcome-card">
        <div className="welcome-icon">01</div>
        <div>
          <h2>Votre plateforme multi-site est prête</h2>
          <p>
            Sélectionnez un espace, gérez ses membres, ses sites et leurs profils éditoriaux depuis
            une console isolée par tenant.
          </p>
        </div>
      </div>
      <div className="stat-grid">
        <Link className="panel linked-card" to="/espaces">
          <div>
            <span>Espaces accessibles</span>
            <strong>{auth.user?.workspaces.length ?? 0}</strong>
            <small>Changer de contexte en toute sécurité</small>
          </div>
        </Link>
        {auth.selectedWorkspaceId && (
          <Link className="panel linked-card" to={`/espaces/${auth.selectedWorkspaceId}/sites`}>
            <div>
              <span>Sites</span>
              <strong>Gérer</strong>
              <small>Configuration générique Phase 1</small>
            </div>
          </Link>
        )}
        <Link className="panel linked-card" to="/securite/sessions">
          <div>
            <span>Sécurité</span>
            <strong>Sessions</strong>
            <small>Consulter et révoquer vos accès</small>
          </div>
        </Link>
      </div>
    </section>
  );
}
