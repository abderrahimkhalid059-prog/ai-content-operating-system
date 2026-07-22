import { useQuery } from '@tanstack/react-query';
import type { WebsiteSummary } from '@ai-content-os/contracts';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';

export function WebsitesPage(): React.JSX.Element {
  const { workspaceId = '' } = useParams();
  const auth = useAuth();
  const websites = useQuery({
    queryKey: ['websites', workspaceId],
    queryFn: () => apiRequest<WebsiteSummary[]>(`/workspaces/${workspaceId}/websites`),
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Multi-site</span>
          <h1>Sites</h1>
        </div>
        {auth.can('websites.create', workspaceId) && (
          <Link className="primary-button" to={`/espaces/${workspaceId}/sites/nouveau`}>
            Nouveau site
          </Link>
        )}
      </div>
      {websites.isPending && <Loading />}
      {websites.data?.length === 0 && <div className="empty-state">Aucun site configuré.</div>}
      <div className="card-grid">
        {websites.data?.map((website) => (
          <Link
            className="panel linked-card"
            key={website.id}
            to={`/espaces/${workspaceId}/sites/${website.id}`}
          >
            <div>
              <span className="eyebrow">{website.platform}</span>
              <h2>{website.name}</h2>
              <p>
                {website.language} · {website.timezone}
              </p>
            </div>
            <span className={`status-pill ${website.status.toLowerCase()}`}>{website.status}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
