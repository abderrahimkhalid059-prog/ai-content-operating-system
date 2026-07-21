import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@ai-content-os/contracts';
import { apiRequest } from '../api/client';
import { Loading } from '../components/loading';

export function SystemStatusPage(): React.JSX.Element {
  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: () => apiRequest<HealthResponse>('/health'),
    refetchInterval: 30_000,
    retry: 1,
  });

  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Infrastructure</span>
          <h1>État du système</h1>
        </div>
        <button type="button" className="secondary-button" onClick={() => void health.refetch()}>
          Actualiser
        </button>
      </div>
      {health.isPending && <Loading />}
      {health.isError && (
        <div className="status-panel status-error" role="alert">
          <strong>Service indisponible</strong>
          <span>La vérification de l’infrastructure a échoué.</span>
        </div>
      )}
      {health.data && (
        <div className="status-grid">
          <StatusCard label="API" status={health.data.status === 'ok' ? 'up' : 'down'} />
          <StatusCard
            label="PostgreSQL"
            status={health.data.services?.database?.status ?? 'down'}
          />
          <StatusCard label="Redis" status={health.data.services?.redis?.status ?? 'down'} />
        </div>
      )}
    </section>
  );
}

function StatusCard({
  label,
  status,
}: {
  label: string;
  status: 'up' | 'down';
}): React.JSX.Element {
  const available = status === 'up';
  return (
    <article className="status-card">
      <span className={`status-dot ${available ? 'is-up' : 'is-down'}`} />
      <div>
        <h2>{label}</h2>
        <p>{available ? 'Opérationnel' : 'Indisponible'}</p>
      </div>
    </article>
  );
}
