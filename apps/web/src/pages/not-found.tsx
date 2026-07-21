import { Link } from 'react-router-dom';

export function NotFoundPage(): React.JSX.Element {
  return (
    <section className="not-found">
      <span>404</span>
      <h1>Page introuvable</h1>
      <p>Cette page n’existe pas ou a été déplacée.</p>
      <Link to="/">Retour au tableau de bord</Link>
    </section>
  );
}
