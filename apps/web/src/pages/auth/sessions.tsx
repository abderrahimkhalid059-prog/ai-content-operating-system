import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionSummary } from '@ai-content-os/contracts';
import { apiRequest } from '../../api/client';
import { Loading } from '../../components/loading';

export function SessionsPage(): React.JSX.Element {
  const client = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiRequest<SessionSummary[]>('/auth/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Sécurité</span>
          <h1>Sessions actives</h1>
        </div>
      </div>
      {sessions.isPending && <Loading />}
      {sessions.isError && <div className="inline-error">Chargement impossible.</div>}
      <div className="card-list">
        {sessions.data?.map((session) => (
          <article className="panel session-card" key={session.id}>
            <div>
              <strong>
                {session.current ? 'Session actuelle' : (session.userAgent ?? 'Navigateur inconnu')}
              </strong>
              <p>
                {session.ipAddress ?? 'Adresse non disponible'} · dernière activité{' '}
                {new Date(session.lastUsedAt).toLocaleString('fr-FR')}
              </p>
            </div>
            <button className="danger-button" onClick={() => revoke.mutate(session.id)}>
              Révoquer
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
