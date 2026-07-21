export function DashboardPage(): React.JSX.Element {
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Vue d’ensemble</span>
          <h1>Tableau de bord</h1>
        </div>
      </div>
      <div className="welcome-card">
        <div className="welcome-icon">0</div>
        <div>
          <h2>Fondation prête à être étendue</h2>
          <p>
            Les fonctionnalités métier seront ajoutées dans les prochaines phases. Cette console
            présente uniquement l’infrastructure de base.
          </p>
        </div>
      </div>
      <div className="stat-grid">
        <article>
          <span>Sites configurés</span>
          <strong>—</strong>
          <small>Disponible en Phase 1</small>
        </article>
        <article>
          <span>Traitements actifs</span>
          <strong>—</strong>
          <small>Aucun traitement métier</small>
        </article>
        <article>
          <span>État plateforme</span>
          <strong className="text-success">Fondation</strong>
          <small>Contrôlez les dépendances système</small>
        </article>
      </div>
    </section>
  );
}
