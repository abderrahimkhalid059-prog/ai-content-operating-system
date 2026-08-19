import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type {
  ContentProfileSummary,
  ReviewCenterQueue,
  ReviewCenterResponse,
  WorkspaceMemberSummary,
} from '@ai-content-os/contracts';
import { apiRequest } from '../../api/client';
import { Loading } from '../../components/loading';

const queues: Array<{ value: ReviewCenterQueue; label: string }> = [
  { value: 'TO_WRITE', label: 'À rédiger' },
  { value: 'IN_REVIEW', label: 'En relecture' },
  { value: 'CHANGES_REQUESTED', label: 'Modifications demandées' },
  { value: 'APPROVED', label: 'Approuvés' },
  { value: 'READY_TO_PUBLISH', label: 'Prêts à publier' },
];

const statusLabels: Record<string, string> = {
  IDEA: 'Idée',
  RESEARCHING: 'Recherche',
  OUTLINED: 'Plan',
  DRAFT: 'Brouillon',
  IN_REVIEW: 'En relecture',
  CHANGES_REQUESTED: 'Modifications demandées',
  APPROVED: 'Approuvé',
  READY_TO_PUBLISH: 'Prêt à publier',
};

export function ReviewCenterPage(): React.JSX.Element {
  const { workspaceId = '', websiteId = '' } = useParams<{
    workspaceId: string;
    websiteId: string;
  }>();
  const [queue, setQueue] = useState<ReviewCenterQueue>('IN_REVIEW');
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [contentProfileId, setContentProfileId] = useState('');
  const [updatedFrom, setUpdatedFrom] = useState('');
  const [page, setPage] = useState(1);
  const params = useMemo(() => {
    const value = new URLSearchParams({ queue, page: String(page), pageSize: '20' });
    if (search.trim()) value.set('search', search.trim());
    if (language.trim()) value.set('language', language.trim());
    if (createdBy) value.set('createdBy', createdBy);
    if (assignedTo) value.set('assignedTo', assignedTo);
    if (contentProfileId) value.set('contentProfileId', contentProfileId);
    if (updatedFrom) value.set('updatedFrom', new Date(`${updatedFrom}T00:00:00`).toISOString());
    return value.toString();
  }, [assignedTo, contentProfileId, createdBy, language, page, queue, search, updatedFrom]);
  const center = useQuery({
    queryKey: [
      'review-center',
      workspaceId,
      websiteId,
      queue,
      page,
      search,
      language,
      createdBy,
      assignedTo,
      contentProfileId,
      updatedFrom,
    ],
    queryFn: () =>
      apiRequest<ReviewCenterResponse>(
        `/workspaces/${workspaceId}/websites/${websiteId}/review-center?${params}`,
      ),
  });
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => apiRequest<WorkspaceMemberSummary[]>(`/workspaces/${workspaceId}/members`),
  });
  const profiles = useQuery({
    queryKey: ['profiles', workspaceId, websiteId],
    queryFn: () =>
      apiRequest<ContentProfileSummary[]>(
        `/workspaces/${workspaceId}/websites/${websiteId}/content-profiles`,
      ),
  });
  const resetPage = (): void => setPage(1);
  const memberName = (userId?: string): string =>
    members.data?.find((entry) => entry.user.id === userId)?.user.displayName ??
    members.data?.find((entry) => entry.user.id === userId)?.user.email ??
    'Non assigné';
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Workflow éditorial humain</span>
          <h1>Centre de révision</h1>
          <p>Relisez, commentez et approuvez une version précise avant tout handoff Blogger.</p>
        </div>
        <Link
          className="secondary-button"
          to={`/espaces/${workspaceId}/sites/${websiteId}/contenus`}
        >
          Tous les contenus
        </Link>
      </div>

      <div className="review-queue-tabs" role="tablist" aria-label="Files de révision">
        {queues.map((entry) => (
          <button
            type="button"
            role="tab"
            aria-selected={queue === entry.value}
            className={queue === entry.value ? 'queue-tab active' : 'queue-tab'}
            key={entry.value}
            onClick={() => {
              setQueue(entry.value);
              resetPage();
            }}
          >
            {entry.label}
            <span>{center.data?.queueCounts[entry.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="panel review-filters">
        <label>
          Rechercher
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
            placeholder="Titre, slug ou résumé"
          />
        </label>
        <label>
          Langue
          <input
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              resetPage();
            }}
            placeholder="fr"
            maxLength={3}
          />
        </label>
        <label>
          Auteur
          <select
            value={createdBy}
            onChange={(event) => {
              setCreatedBy(event.target.value);
              resetPage();
            }}
          >
            <option value="">Tous</option>
            {members.data?.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.displayName ?? member.user.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigné à
          <select
            value={assignedTo}
            onChange={(event) => {
              setAssignedTo(event.target.value);
              resetPage();
            }}
          >
            <option value="">Tous</option>
            {members.data?.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.displayName ?? member.user.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Profil éditorial
          <select
            value={contentProfileId}
            onChange={(event) => {
              setContentProfileId(event.target.value);
              resetPage();
            }}
          >
            <option value="">Tous</option>
            {profiles.data?.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modifié depuis
          <input
            type="date"
            value={updatedFrom}
            onChange={(event) => {
              setUpdatedFrom(event.target.value);
              resetPage();
            }}
          />
        </label>
      </div>

      {center.isPending && <Loading />}
      {center.isError && (
        <div className="inline-error" role="alert">
          Le Centre de révision est temporairement indisponible.
        </div>
      )}
      {center.data?.data.length === 0 && (
        <div className="panel empty-state">Aucun contenu dans cette file.</div>
      )}
      <div className="review-card-grid">
        {center.data?.data.map((item) => (
          <article className="panel review-center-card" key={item.id}>
            <div className="section-heading">
              <span className="status-pill">{statusLabels[item.editorialStatus]}</span>
              <span>Version {item.version}</span>
            </div>
            <h2>{item.title}</h2>
            <p>{item.excerpt ?? 'Aucun résumé.'}</p>
            <dl>
              <div>
                <dt>Auteur</dt>
                <dd>{memberName(item.createdByUserId)}</dd>
              </div>
              <div>
                <dt>Assigné à</dt>
                <dd>{memberName(item.assignedToUserId)}</dd>
              </div>
              <div>
                <dt>Langue</dt>
                <dd>{item.language.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Modification</dt>
                <dd>{new Date(item.updatedAt).toLocaleString('fr-FR')}</dd>
              </div>
            </dl>
            <div className="button-row">
              <Link
                className="primary-button"
                to={`/espaces/${workspaceId}/sites/${websiteId}/contenus/${item.id}`}
              >
                Ouvrir le contenu
              </Link>
              <Link
                className="secondary-button"
                to={`/espaces/${workspaceId}/sites/${websiteId}/contenus/${item.id}/versions`}
              >
                Historique
              </Link>
            </div>
          </article>
        ))}
      </div>
      {center.data && center.data.pagination.totalPages > 1 && (
        <div className="pagination-controls">
          <button
            type="button"
            className="secondary-button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Précédent
          </button>
          <span>
            Page {page} sur {center.data.pagination.totalPages}
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={page >= center.data.pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Suivant
          </button>
        </div>
      )}
    </section>
  );
}
