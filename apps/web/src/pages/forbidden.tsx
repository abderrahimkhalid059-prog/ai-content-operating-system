import { Link } from 'react-router-dom';
export function ForbiddenPage(): React.JSX.Element {
  return (
    <section className="not-found">
      <span>403</span>
      <h1>Accès interdit</h1>
      <p>Votre rôle ne permet pas cette opération.</p>
      <Link to="/">Retour à l’accueil</Link>
    </section>
  );
}
