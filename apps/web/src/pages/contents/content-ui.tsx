import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContentEditorialStatus,
  ContentItemSummary,
  ContentProfileSummary,
  ContentPublicationStatus,
  ContentRevisionSummary,
  PaginationResponse,
  WebsiteSummary,
  WorkspaceMemberSummary,
} from '@ai-content-os/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useHistory, useParams } from 'react-router-dom';
import { apiRequest, ApiClientError } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';
import { ContentReviewPanel } from './content-review-panel';

const editorialStatuses: ContentEditorialStatus[] = [
  'IDEA',
  'RESEARCHING',
  'OUTLINED',
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'READY_TO_PUBLISH',
  'PUBLISHED',
  'ARCHIVED',
];
const publicationStatuses: ContentPublicationStatus[] = [
  'NOT_PUBLISHED',
  'DRAFT_SENT',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
];
const nextStatuses: Partial<Record<ContentEditorialStatus, ContentEditorialStatus[]>> = {
  IDEA: ['RESEARCHING', 'DRAFT'],
  RESEARCHING: ['OUTLINED', 'DRAFT'],
  OUTLINED: ['DRAFT'],
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: [],
  CHANGES_REQUESTED: ['DRAFT'],
  APPROVED: ['READY_TO_PUBLISH'],
  READY_TO_PUBLISH: ['PUBLISHED'],
  PUBLISHED: [],
  ARCHIVED: [],
};
const editorialLabels: Record<ContentEditorialStatus, string> = {
  IDEA: 'Idée',
  RESEARCHING: 'Recherche',
  OUTLINED: 'Planifié',
  DRAFT: 'Brouillon',
  IN_REVIEW: 'En relecture',
  CHANGES_REQUESTED: 'Modifications demandées',
  APPROVED: 'Approuvé',
  READY_TO_PUBLISH: 'Prêt à publier',
  PUBLISHED: 'Publié',
  ARCHIVED: 'Archivé',
};
const publicationLabels: Record<ContentPublicationStatus, string> = {
  NOT_PUBLISHED: 'Non publié',
  DRAFT_SENT: 'Brouillon envoyé',
  PUBLISHING: 'Publication en cours',
  PUBLISHED: 'Publié',
  FAILED: 'Échec',
};

function useContentRoute() {
  return useParams<{ workspaceId?: string; websiteId?: string; contentId?: string }>();
}

function contentBase(workspaceId: string, websiteId: string): string {
  return `/workspaces/${workspaceId}/websites/${websiteId}/contents`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function ContentListPage(): React.JSX.Element {
  const { workspaceId = '', websiteId = '' } = useContentRoute();
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editorialStatus, setEditorialStatus] = useState('');
  const [publicationStatus, setPublicationStatus] = useState('');
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (search.trim()) query.set('search', search.trim());
  if (editorialStatus) query.set('editorialStatus', editorialStatus);
  if (publicationStatus) query.set('publicationStatus', publicationStatus);
  const contents = useQuery({
    queryKey: [
      'contents',
      workspaceId,
      websiteId,
      page,
      search,
      editorialStatus,
      publicationStatus,
    ],
    queryFn: () =>
      apiRequest<PaginationResponse<ContentItemSummary>>(
        `${contentBase(workspaceId, websiteId)}?${query.toString()}`,
      ),
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Site · Domaine éditorial</span>
          <h1>Contenus</h1>
        </div>
        {auth.can('contents.create', workspaceId) && (
          <Link
            className="primary-button"
            to={`/espaces/${workspaceId}/sites/${websiteId}/contenus/nouveau`}
          >
            Nouveau contenu
          </Link>
        )}
      </div>
      <div className="panel content-filters">
        <label>
          Recherche
          <input
            aria-label="Rechercher un contenu"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Titre, slug ou résumé"
          />
        </label>
        <label>
          Statut éditorial
          <select
            value={editorialStatus}
            onChange={(event) => {
              setEditorialStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous</option>
            {editorialStatuses.map((status) => (
              <option key={status} value={status}>
                {editorialLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Publication
          <select
            value={publicationStatus}
            onChange={(event) => {
              setPublicationStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Toutes</option>
            {publicationStatuses.map((status) => (
              <option key={status} value={status}>
                {publicationLabels[status]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {contents.isPending && <Loading />}
      {contents.isError && (
        <div className="inline-error" role="alert">
          {errorMessage(contents.error, 'Chargement des contenus impossible.')}
        </div>
      )}
      {!contents.isPending && contents.data?.data.length === 0 && (
        <div className="empty-state">Aucun contenu ne correspond à ces critères.</div>
      )}
      {contents.data && contents.data.data.length > 0 && (
        <div className="table-wrap section-gap">
          <table>
            <thead>
              <tr>
                <th>Contenu</th>
                <th>Éditorial</th>
                <th>Publication</th>
                <th>Métriques</th>
                <th>Mis à jour</th>
              </tr>
            </thead>
            <tbody>
              {contents.data.data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to={`/espaces/${workspaceId}/sites/${websiteId}/contenus/${item.id}`}>
                      <strong>{item.title}</strong>
                    </Link>
                    <small>/{item.slug}</small>
                  </td>
                  <td>
                    <span className="status-pill">{editorialLabels[item.editorialStatus]}</span>
                  </td>
                  <td>{publicationLabels[item.publicationStatus]}</td>
                  <td>
                    {item.wordCount} mots · {item.estimatedReadingMinutes} min
                  </td>
                  <td>{new Date(item.updatedAt).toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {contents.data && contents.data.pagination.totalPages > 1 && (
        <nav className="pagination" aria-label="Pagination des contenus">
          <button
            className="secondary-button"
            disabled={page === 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Précédent
          </button>
          <span>
            Page {page} sur {contents.data.pagination.totalPages}
          </span>
          <button
            className="secondary-button"
            disabled={page >= contents.data.pagination.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Suivant
          </button>
        </nav>
      )}
    </section>
  );
}

interface ContentFormState {
  title: string;
  slug: string;
  excerpt: string;
  htmlContent: string;
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  language: string;
  locale: string;
  featuredImageReference: string;
  labels: string;
  contentProfileId: string;
  assignedToUserId: string;
  editorialStatus: 'IDEA' | 'DRAFT';
  changeReason: string;
}

const emptyForm: ContentFormState = {
  title: '',
  slug: '',
  excerpt: '',
  htmlContent: '<p></p>',
  metaTitle: '',
  metaDescription: '',
  canonicalUrl: '',
  language: '',
  locale: '',
  featuredImageReference: '',
  labels: '',
  contentProfileId: '',
  assignedToUserId: '',
  editorialStatus: 'DRAFT',
  changeReason: '',
};

function hydrateForm(item: ContentItemSummary): ContentFormState {
  return {
    title: item.title,
    slug: item.slug,
    excerpt: item.excerpt ?? '',
    htmlContent: item.htmlContent,
    metaTitle: item.metaTitle ?? '',
    metaDescription: item.metaDescription ?? '',
    canonicalUrl: item.canonicalUrl ?? '',
    language: item.language,
    locale: item.locale ?? '',
    featuredImageReference: item.featuredImageReference ?? '',
    labels: item.labels.join(', '),
    contentProfileId: item.contentProfileId ?? '',
    assignedToUserId: item.assignedToUserId ?? '',
    editorialStatus: item.editorialStatus === 'IDEA' ? item.editorialStatus : 'DRAFT',
    changeReason: '',
  };
}

export function ContentEditorPage(): React.JSX.Element {
  const { workspaceId = '', websiteId = '', contentId } = useContentRoute();
  const editing = Boolean(contentId);
  const auth = useAuth();
  const history = useHistory();
  const queryClient = useQueryClient();
  const base = contentBase(workspaceId, websiteId);
  const [form, setForm] = useState<ContentFormState>(emptyForm);
  const [notice, setNotice] = useState<string>();
  const websiteDefaultsApplied = useRef(false);
  const item = useQuery({
    queryKey: ['content', workspaceId, websiteId, contentId],
    queryFn: () => apiRequest<ContentItemSummary>(`${base}/${contentId}`),
    enabled: editing,
  });
  const website = useQuery({
    queryKey: ['website', workspaceId, websiteId],
    queryFn: () => apiRequest<WebsiteSummary>(`/workspaces/${workspaceId}/websites/${websiteId}`),
    enabled: !editing,
  });
  const profiles = useQuery({
    queryKey: ['profiles', workspaceId, websiteId],
    queryFn: () =>
      apiRequest<ContentProfileSummary[]>(
        `/workspaces/${workspaceId}/websites/${websiteId}/content-profiles`,
      ),
  });
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => apiRequest<WorkspaceMemberSummary[]>(`/workspaces/${workspaceId}/members`),
    enabled: auth.can('contents.assign', workspaceId),
  });
  useEffect(() => {
    if (item.data) setForm(hydrateForm(item.data));
  }, [item.data]);
  useEffect(() => {
    if (editing || !website.data || websiteDefaultsApplied.current) return;
    websiteDefaultsApplied.current = true;
    setForm((current) => ({
      ...current,
      language: website.data.language,
      locale: website.data.locale ?? '',
    }));
  }, [editing, website.data]);
  const set = (field: keyof ContentFormState, value: string): void =>
    setForm((current) => ({ ...current, [field]: value }));
  const metrics = useMemo(() => {
    const text = form.htmlContent
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim();
    const words = text ? text.split(/\s+/u).length : 0;
    return { words, minutes: words ? Math.max(1, Math.ceil(words / 225)) : 0 };
  }, [form.htmlContent]);
  const invalidate = async (id: string): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['contents', workspaceId, websiteId] }),
      queryClient.invalidateQueries({ queryKey: ['content', workspaceId, websiteId, id] }),
      queryClient.invalidateQueries({
        queryKey: ['content-revisions', workspaceId, websiteId, id],
      }),
      queryClient.invalidateQueries({ queryKey: ['review-center', workspaceId, websiteId] }),
      queryClient.invalidateQueries({
        queryKey: ['content-publication', workspaceId, websiteId, id],
      }),
    ]);
  };
  const save = useMutation({
    mutationFn: async (): Promise<ContentItemSummary> => {
      const labels = form.labels
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
      const general = {
        title: form.title,
        excerpt: form.excerpt || null,
        htmlContent: form.htmlContent,
        language: form.language,
        locale: form.locale || null,
        featuredImageReference: form.featuredImageReference || null,
        contentProfileId: form.contentProfileId || null,
      };
      const seo = {
        slug: form.slug || form.title,
        metaTitle: form.metaTitle || null,
        metaDescription: form.metaDescription || null,
        canonicalUrl: form.canonicalUrl || null,
        labels,
      };
      if (!editing) {
        return apiRequest<ContentItemSummary>(base, {
          method: 'POST',
          body: JSON.stringify({
            ...general,
            ...seo,
            ...(auth.can('contents.assign', workspaceId) && form.assignedToUserId
              ? { assignedToUserId: form.assignedToUserId }
              : {}),
            editorialStatus: form.editorialStatus,
            changeReason: form.changeReason || undefined,
          }),
        });
      }
      const payload = {
        expectedVersion: item.data?.version,
        ...(auth.can('contents.update', workspaceId) ? general : {}),
        ...(auth.can('contents.seo.update', workspaceId) ? seo : {}),
        ...(auth.can('contents.assign', workspaceId)
          ? { assignedToUserId: form.assignedToUserId || null }
          : {}),
        changeReason: form.changeReason || undefined,
      };
      return apiRequest<ContentItemSummary>(`${base}/${contentId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (result) => {
      await invalidate(result.id);
      setNotice('Contenu enregistré et nouvelle version créée.');
      setForm(hydrateForm(result));
      if (!editing)
        history.replace(`/espaces/${workspaceId}/sites/${websiteId}/contenus/${result.id}`);
    },
  });
  const transition = useMutation({
    mutationFn: (nextStatus: ContentEditorialStatus) =>
      apiRequest<ContentItemSummary>(`${base}/${contentId}/transition`, {
        method: 'POST',
        body: JSON.stringify({
          nextStatus,
          expectedVersion: item.data?.version,
          reason: form.changeReason || undefined,
        }),
      }),
    onSuccess: async (result) => {
      await invalidate(result.id);
      setNotice(`Statut mis à jour : ${editorialLabels[result.editorialStatus]}.`);
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      apiRequest<ContentItemSummary>(`${base}/${contentId}/archive`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: item.data?.version,
          reason: form.changeReason || undefined,
        }),
      }),
    onSuccess: async (result) => {
      await invalidate(result.id);
      setNotice('Contenu archivé.');
    },
  });
  const mutationError = save.error ?? transition.error ?? archive.error;
  const stale =
    mutationError instanceof ApiClientError &&
    mutationError.body?.error.code === 'CONTENT_STALE_UPDATE';
  const canSave = editing
    ? auth.can('contents.update', workspaceId) ||
      auth.can('contents.seo.update', workspaceId) ||
      auth.can('contents.assign', workspaceId)
    : auth.can('contents.create', workspaceId);
  if (editing && item.isPending) return <Loading />;
  if (editing && item.isError) {
    return <div className="inline-error">{errorMessage(item.error, 'Contenu introuvable.')}</div>;
  }
  const persisted = item.data;
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {editing ? `Version ${persisted?.version ?? ''}` : 'Création manuelle'}
          </span>
          <h1>{editing ? 'Éditeur de contenu' : 'Nouveau contenu'}</h1>
        </div>
        <div className="button-row">
          <Link
            className="secondary-button"
            to={`/espaces/${workspaceId}/sites/${websiteId}/contenus`}
          >
            Retour à la liste
          </Link>
          {editing && auth.can('contents.revisions.read', workspaceId) && (
            <Link
              className="secondary-button"
              to={`/espaces/${workspaceId}/sites/${websiteId}/contenus/${contentId}/versions`}
            >
              Historique des versions
            </Link>
          )}
        </div>
      </div>
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {mutationError && (
        <div className="inline-error" role="alert">
          {errorMessage(mutationError, 'Enregistrement impossible.')}
          {stale && (
            <button className="secondary-button" onClick={() => void item.refetch()}>
              Recharger la version actuelle
            </button>
          )}
        </div>
      )}
      {persisted && (
        <div className="content-status-bar panel">
          <span className="status-pill">{editorialLabels[persisted.editorialStatus]}</span>
          <span>{publicationLabels[persisted.publicationStatus]}</span>
          <span>Version {persisted.version}</span>
          <span>
            {persisted.wordCount} mots · {persisted.estimatedReadingMinutes} min
          </span>
        </div>
      )}
      <form
        className="content-editor-layout section-gap"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="panel stack-form">
          <label>
            Titre
            <input
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
              required
              maxLength={300}
            />
          </label>
          <label>
            Résumé
            <textarea
              value={form.excerpt}
              onChange={(event) => set('excerpt', event.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            Contenu HTML
            <textarea
              className="html-editor"
              value={form.htmlContent}
              onChange={(event) => set('htmlContent', event.target.value)}
              required
              maxLength={500000}
            />
          </label>
          <div className="editor-metrics" aria-label="Métriques locales">
            Estimation locale : {metrics.words} mots · {metrics.minutes} min de lecture
          </div>
        </div>
        <aside className="stack-form">
          <div className="panel stack-form">
            <h2>Référencement</h2>
            <label>
              Slug
              <input
                value={form.slug}
                onChange={(event) => set('slug', event.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              Méta-titre
              <input
                value={form.metaTitle}
                onChange={(event) => set('metaTitle', event.target.value)}
                maxLength={70}
              />
            </label>
            <label>
              Méta-description
              <textarea
                value={form.metaDescription}
                onChange={(event) => set('metaDescription', event.target.value)}
                maxLength={180}
              />
            </label>
            <label>
              URL canonique
              <input
                type="url"
                value={form.canonicalUrl}
                onChange={(event) => set('canonicalUrl', event.target.value)}
              />
            </label>
            <label>
              Libellés, séparés par des virgules
              <input value={form.labels} onChange={(event) => set('labels', event.target.value)} />
            </label>
          </div>
          <div className="panel stack-form">
            <h2>Configuration</h2>
            {!editing && (
              <label>
                Statut initial
                <select
                  value={form.editorialStatus}
                  onChange={(event) => set('editorialStatus', event.target.value)}
                >
                  <option value="IDEA">Idée</option>
                  <option value="DRAFT">Brouillon</option>
                </select>
              </label>
            )}
            <div className="two-column">
              <label>
                Langue
                <input
                  value={form.language}
                  onChange={(event) => set('language', event.target.value)}
                  required
                />
              </label>
              <label>
                Locale
                <input
                  value={form.locale}
                  onChange={(event) => set('locale', event.target.value)}
                />
              </label>
            </div>
            <label>
              Image mise en avant
              <input
                value={form.featuredImageReference}
                onChange={(event) => set('featuredImageReference', event.target.value)}
              />
            </label>
            <label>
              Profil éditorial
              <select
                value={form.contentProfileId}
                onChange={(event) => set('contentProfileId', event.target.value)}
              >
                <option value="">Aucun</option>
                {profiles.data
                  ?.filter((profile) => profile.status === 'ACTIVE')
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
              </select>
            </label>
            {auth.can('contents.assign', workspaceId) && (
              <label>
                Assigné à
                <select
                  value={form.assignedToUserId}
                  onChange={(event) => set('assignedToUserId', event.target.value)}
                >
                  <option value="">Personne</option>
                  {members.data
                    ?.filter((member) => member.user.status === 'ACTIVE')
                    .map((member) => (
                      <option key={member.user.id} value={member.user.id}>
                        {member.user.displayName ?? member.user.email}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Motif de la version
              <textarea
                value={form.changeReason}
                onChange={(event) => set('changeReason', event.target.value)}
                maxLength={500}
              />
            </label>
          </div>
          <div className="panel stack-form">
            <h2>Actions</h2>
            {canSave && (
              <button className="primary-button" disabled={save.isPending}>
                {editing ? 'Enregistrer une nouvelle version' : 'Créer le brouillon'}
              </button>
            )}
            {persisted &&
              auth.can('contents.transition', workspaceId) &&
              nextStatuses[persisted.editorialStatus]?.map((status) => (
                <button
                  type="button"
                  className="secondary-button"
                  key={status}
                  onClick={() => transition.mutate(status)}
                >
                  Passer à « {editorialLabels[status]} »
                </button>
              ))}
            {persisted &&
              persisted.editorialStatus !== 'ARCHIVED' &&
              auth.can('contents.archive', workspaceId) && (
                <button type="button" className="danger-button" onClick={() => archive.mutate()}>
                  Archiver
                </button>
              )}
          </div>
        </aside>
      </form>
      {persisted && (
        <ContentReviewPanel workspaceId={workspaceId} websiteId={websiteId} item={persisted} />
      )}
    </section>
  );
}

export function ContentRevisionsPage(): React.JSX.Element {
  const { workspaceId = '', websiteId = '', contentId = '' } = useContentRoute();
  const base = contentBase(workspaceId, websiteId);
  const [selected, setSelected] = useState<number>();
  const revisions = useQuery({
    queryKey: ['content-revisions', workspaceId, websiteId, contentId],
    queryFn: () => apiRequest<ContentRevisionSummary[]>(`${base}/${contentId}/revisions`),
  });
  const detail = revisions.data?.find((revision) => revision.revisionNumber === selected);
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Traçabilité</span>
          <h1>Historique des versions</h1>
        </div>
        <Link
          className="secondary-button"
          to={`/espaces/${workspaceId}/sites/${websiteId}/contenus/${contentId}`}
        >
          Retour à l’éditeur
        </Link>
      </div>
      {revisions.isPending && <Loading />}
      {revisions.isError && (
        <div className="inline-error">
          {errorMessage(revisions.error, 'Historique indisponible.')}
        </div>
      )}
      {revisions.data?.length === 0 && (
        <div className="empty-state">Aucune version disponible.</div>
      )}
      <div className="revision-layout">
        <div className="card-list">
          {revisions.data?.map((revision) => (
            <button
              className="panel revision-card"
              key={revision.id}
              onClick={() => setSelected(revision.revisionNumber)}
            >
              <strong>
                Version {revision.revisionNumber} · {revision.title}
              </strong>
              <span>
                {editorialLabels[revision.editorialStatus]} ·{' '}
                {new Date(revision.changedAt).toLocaleString('fr-FR')}
              </span>
              {revision.changeReason && <small>{revision.changeReason}</small>}
            </button>
          ))}
        </div>
        {detail && (
          <article className="panel revision-preview">
            <span className="eyebrow">Instantané immuable</span>
            <h2>{detail.title}</h2>
            <dl className="details-list">
              <dt>Slug</dt>
              <dd>{detail.slug}</dd>
              <dt>Métriques</dt>
              <dd>
                {detail.wordCount} mots · {detail.estimatedReadingMinutes} min
              </dd>
              <dt>Libellés</dt>
              <dd>{detail.labels.join(', ') || 'Aucun'}</dd>
            </dl>
            <pre>{detail.htmlContent}</pre>
          </article>
        )}
      </div>
    </section>
  );
}
