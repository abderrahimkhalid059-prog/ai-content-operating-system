import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceSummary } from '@ai-content-os/contracts';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';

export function WorkspaceDetailsPage(): React.JSX.Element {
  const { workspaceId = '' } = useParams();
  const auth = useAuth();
  const client = useQueryClient();
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => apiRequest<WorkspaceSummary>(`/workspaces/${workspaceId}`),
  });
  const deactivate = useMutation({
    mutationFn: () => apiRequest<void>(`/workspaces/${workspaceId}/deactivate`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workspaces'] }),
  });
  if (workspace.isPending) return <Loading />;
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Espace</span>
          <h1>{workspace.data?.name}</h1>
        </div>
        {auth.can('workspace.deactivate', workspaceId) && (
          <button className="danger-button" onClick={() => deactivate.mutate()}>
            Désactiver
          </button>
        )}
      </div>
      <div className="stat-grid">
        <Link className="panel linked-card" to={`/espaces/${workspaceId}/membres`}>
          <div>
            <strong>Membres</strong>
            <p>Rôles et accès</p>
          </div>
        </Link>
        <Link className="panel linked-card" to={`/espaces/${workspaceId}/sites`}>
          <div>
            <strong>Sites</strong>
            <p>Configuration multi-site</p>
          </div>
        </Link>
        <article className="panel">
          <strong>Votre rôle</strong>
          <p>{workspace.data?.role}</p>
        </article>
      </div>
    </section>
  );
}
