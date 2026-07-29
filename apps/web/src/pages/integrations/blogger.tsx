import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DiscoveredBloggerBlog,
  ExternalLabelSummary,
  ExternalPostSummary,
  IntegrationSummary,
  IntegrationSyncRunSummary,
  IntegrationSystemStatus,
  PublicationOperationResult,
  StartBloggerConnectionResult,
} from '@ai-content-os/contracts';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiClientError, apiRequest } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';

interface SitePage {
  items: DiscoveredBloggerBlog[];
  nextPageToken?: string;
}

const providerErrorMessages: Record<string, string> = {
  BLOGGER_ACCOUNT_UNAUTHORIZED:
    'L’autorisation Google a expiré ou n’est plus valide. Reconnectez le compte.',
  BLOGGER_PERMISSION_DENIED:
    'Google a refusé l’accès à Blogger. Vérifiez le périmètre autorisé et l’activation de l’API.',
  BLOGGER_RATE_LIMITED: 'La limite de requêtes Blogger est atteinte. Réessayez plus tard.',
  BLOGGER_UPSTREAM_UNAVAILABLE:
    'Blogger est temporairement indisponible. Réessayez dans quelques instants.',
};

const errorText = (error: unknown) =>
  error instanceof ApiClientError
    ? (providerErrorMessages[error.body?.error.code ?? ''] ?? error.message)
    : 'L’opération Blogger a échoué.';

export function BloggerIntegrationPage(): React.JSX.Element {
  const { workspaceId = '', websiteId = '' } = useParams<{
    workspaceId?: string;
    websiteId?: string;
  }>();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const base = `/workspaces/${workspaceId}/websites/${websiteId}`;
  const integrationKey = useMemo(
    () => ['blogger-integration', workspaceId, websiteId] as const,
    [websiteId, workspaceId],
  );
  const sitesKey = useMemo(
    () => ['blogger-sites', workspaceId, websiteId] as const,
    [websiteId, workspaceId],
  );
  const [title, setTitle] = useState('Brouillon de validation Blogger');
  const [htmlContent, setHtmlContent] = useState(
    '<p>Contenu de test sans publication autonome.</p>',
  );
  const [labels, setLabels] = useState('validation, mock');
  const [lastPost, setLastPost] = useState<ExternalPostSummary>();
  const status = useQuery({
    queryKey: ['integration-status'],
    queryFn: () => apiRequest<IntegrationSystemStatus>('/integrations/status'),
  });
  const integration = useQuery({
    queryKey: integrationKey,
    queryFn: () => apiRequest<IntegrationSummary>(`${base}/integrations/blogger`),
    retry: false,
  });
  const sites = useQuery({
    queryKey: sitesKey,
    queryFn: () =>
      apiRequest<SitePage>(`${base}/integrations/blogger/sites`, {
        cache: 'no-store',
      }),
    enabled: Boolean(
      integration.data && integration.data.status !== 'EXPIRED' && !integration.data.externalSiteId,
    ),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const posts = useQuery({
    queryKey: ['external-posts', workspaceId, websiteId],
    queryFn: () => apiRequest<ExternalPostSummary[]>(`${base}/external-posts`),
    enabled: Boolean(integration.data?.externalSiteId),
  });
  const externalLabels = useQuery({
    queryKey: ['external-labels', workspaceId, websiteId],
    queryFn: () => apiRequest<ExternalLabelSummary[]>(`${base}/external-labels`),
    enabled: Boolean(integration.data?.externalSiteId),
  });
  const runs = useQuery({
    queryKey: ['blogger-sync-runs', workspaceId, websiteId],
    queryFn: () =>
      apiRequest<IntegrationSyncRunSummary[]>(`${base}/integrations/blogger/sync-runs`),
    enabled: Boolean(integration.data?.externalSiteId),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === 'PENDING' || run.status === 'RUNNING')
        ? 1_000
        : false,
  });
  const authorizationError =
    sites.error instanceof ApiClientError &&
    ['BLOGGER_ACCOUNT_UNAUTHORIZED', 'INTEGRATION_CONNECTION_EXPIRED'].includes(
      sites.error.body?.error.code ?? '',
    );
  const reauthorizationRequired = integration.data?.status === 'EXPIRED' || authorizationError;
  const refreshConnectionState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['integration-status'] }),
      queryClient.invalidateQueries({ queryKey: integrationKey }),
      queryClient.invalidateQueries({ queryKey: sitesKey }),
    ]);
  };
  const refreshAll = async () => {
    await Promise.all([
      refreshConnectionState(),
      queryClient.invalidateQueries({ queryKey: ['external-posts', workspaceId, websiteId] }),
      queryClient.invalidateQueries({ queryKey: ['external-labels', workspaceId, websiteId] }),
      queryClient.invalidateQueries({
        queryKey: ['blogger-sync-runs', workspaceId, websiteId],
      }),
    ]);
  };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('blogger') !== 'connected') return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: integrationKey }),
      queryClient.invalidateQueries({ queryKey: sitesKey }),
    ]).then(() =>
      Promise.all([
        queryClient.refetchQueries({ queryKey: integrationKey }),
        queryClient.refetchQueries({ queryKey: sitesKey }),
      ]),
    );
  }, [integrationKey, queryClient, sitesKey]);
  useEffect(() => {
    if (!authorizationError) return;
    void queryClient.invalidateQueries({ queryKey: integrationKey });
  }, [authorizationError, integrationKey, queryClient]);
  const connect = useMutation({
    mutationFn: () =>
      apiRequest<StartBloggerConnectionResult>(`${base}/integrations/blogger/connect`, {
        method: 'POST',
        body: JSON.stringify({
          redirectAfter: `/espaces/${workspaceId}/sites/${websiteId}/integrations/blogger`,
          replaceExisting: Boolean(integration.data),
        }),
      }),
    onSuccess: async (result) => {
      await refreshConnectionState();
      window.location.assign(result.authorizationUrl);
    },
  });
  const selectSite = useMutation({
    mutationFn: (externalSiteId: string) =>
      apiRequest<IntegrationSummary>(`${base}/integrations/blogger/select-site`, {
        method: 'POST',
        body: JSON.stringify({ externalSiteId }),
      }),
    onSuccess: refreshAll,
  });
  const action = useMutation({
    mutationFn: (path: string) => apiRequest<unknown>(`${base}${path}`, { method: 'POST' }),
    onSuccess: refreshAll,
  });
  const disconnect = useMutation({
    mutationFn: () => apiRequest<void>(`${base}/integrations/blogger`, { method: 'DELETE' }),
    onSuccess: async () => {
      queryClient.setQueryData<IntegrationSummary | null>(integrationKey, null);
      queryClient.removeQueries({ queryKey: sitesKey });
      await refreshConnectionState();
    },
  });
  const createDraft = useMutation({
    mutationFn: () =>
      apiRequest<PublicationOperationResult>(`${base}/integrations/blogger/test-posts`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          htmlContent,
          labels: labels
            .split(',')
            .map((label) => label.trim())
            .filter(Boolean),
          idempotencyKey: `ui-create-${crypto.randomUUID()}`,
        }),
      }),
    onSuccess: async (result) => {
      setLastPost(result.post);
      await refreshAll();
    },
  });
  const publish = useMutation({
    mutationFn: (postId: string) =>
      apiRequest<PublicationOperationResult>(
        `${base}/integrations/blogger/test-posts/${encodeURIComponent(postId)}/publish`,
        {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey: `ui-publish-${crypto.randomUUID()}` }),
        },
      ),
    onSuccess: async (result) => {
      setLastPost(result.post);
      await refreshAll();
    },
  });
  const updateDraft = useMutation({
    mutationFn: (postId: string) =>
      apiRequest<PublicationOperationResult>(
        `${base}/integrations/blogger/test-posts/${encodeURIComponent(postId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title,
            htmlContent,
            labels: labels
              .split(',')
              .map((label) => label.trim())
              .filter(Boolean),
            idempotencyKey: `ui-update-${crypto.randomUUID()}`,
          }),
        },
      ),
    onSuccess: async (result) => {
      setLastPost(result.post);
      await refreshAll();
    },
  });
  const remove = useMutation({
    mutationFn: (postId: string) =>
      apiRequest<void>(`${base}/integrations/blogger/test-posts/${encodeURIComponent(postId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ idempotencyKey: `ui-delete-${crypto.randomUUID()}` }),
      }),
    onSuccess: async () => {
      setLastPost(undefined);
      await refreshAll();
    },
  });
  const mutationError =
    connect.error ??
    selectSite.error ??
    action.error ??
    disconnect.error ??
    createDraft.error ??
    updateDraft.error ??
    publish.error ??
    remove.error;
  if (status.isPending || integration.isPending) return <Loading />;
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Intégration de publication</span>
          <h1>Blogger</h1>
        </div>
        <Link className="secondary-button" to={`/espaces/${workspaceId}/sites/${websiteId}`}>
          Retour au site
        </Link>
      </div>
      <div className="safety-banner" role="status">
        <strong>Mode {status.data?.bloggerMode ?? '—'}</strong>
        <span>
          Publication publique {status.data?.publicPublishEnabled ? 'autorisée' : 'bloquée'} ·
          suppression {status.data?.deleteEnabled ? 'autorisée' : 'bloquée'}
        </span>
      </div>
      {!integration.data && (
        <div className="panel">
          <h2>Connecter un compte Google</h2>
          <p>Le mode Mock simule OAuth sans envoyer de secret ni contacter Google.</p>
          {auth.can('integrations.connect', workspaceId) && (
            <button className="primary-button" onClick={() => connect.mutate()}>
              Démarrer la connexion
            </button>
          )}
        </div>
      )}
      {integration.data && (
        <>
          <div className="status-grid">
            <article className="status-card">
              <span className="eyebrow">État</span>
              <h2>{reauthorizationRequired ? 'AUTORISATION EXPIRÉE' : integration.data.status}</h2>
              <p>{integration.data.externalSiteName ?? 'Blog à sélectionner'}</p>
            </article>
            <article className="status-card">
              <span className="eyebrow">Compte externe</span>
              <h2>{integration.data.externalAccountId ?? '—'}</h2>
              <p>Les jetons ne sont jamais exposés dans cette interface.</p>
            </article>
            <article className="status-card">
              <span className="eyebrow">Dernière synchronisation</span>
              <h2>
                {integration.data.lastSuccessfulSyncAt
                  ? new Date(integration.data.lastSuccessfulSyncAt).toLocaleString('fr-FR')
                  : 'Jamais'}
              </h2>
              <p>{integration.data.lastErrorCode ?? 'Aucune erreur active'}</p>
            </article>
          </div>
          <div className="panel section-gap">
            <h2>Contrôles de connexion</h2>
            {reauthorizationRequired && (
              <p role="status">
                <strong>AUTORISATION EXPIRÉE</strong> · Reconnectez Blogger pour rétablir l’accès
                Google.
              </p>
            )}
            {authorizationError && (
              <div className="inline-error" role="alert">
                {errorText(sites.error)}
              </div>
            )}
            <div className="button-row">
              {auth.can('integrations.connect', workspaceId) && (
                <button
                  className="primary-button"
                  disabled={connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  Reconnecter Blogger
                </button>
              )}
              {integration.data.externalSiteId && !reauthorizationRequired && (
                <>
                  <button
                    className="secondary-button"
                    onClick={() => action.mutate('/integrations/blogger/test')}
                  >
                    Tester
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => action.mutate('/integrations/blogger/refresh')}
                  >
                    Simuler le renouvellement
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => action.mutate('/integrations/blogger/sync')}
                  >
                    Importer maintenant
                  </button>
                </>
              )}
              {auth.can('integrations.disconnect', workspaceId) && (
                <button
                  className="danger-button"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  Déconnecter
                </button>
              )}
            </div>
          </div>
          {!integration.data.externalSiteId && !reauthorizationRequired && (
            <div className="panel section-gap">
              <h2>Sélectionner un blog</h2>
              {(sites.isPending || sites.isFetching) && (
                <p role="status">Recherche des blogs Blogger…</p>
              )}
              {!sites.isFetching && sites.isError && (
                <div className="inline-error" role="alert">
                  {errorText(sites.error)}
                </div>
              )}
              {!sites.isFetching && sites.isSuccess && sites.data.items.length === 0 && (
                <p>Aucun blog Blogger n’a été trouvé pour ce compte Google.</p>
              )}
              {!sites.isFetching &&
                sites.data?.items.map((site) => (
                  <div className="selection-row" key={site.id}>
                    <div>
                      <strong>{site.name}</strong>
                      <small>{site.url}</small>
                    </div>
                    <button className="primary-button" onClick={() => selectSite.mutate(site.id)}>
                      Sélectionner
                    </button>
                  </div>
                ))}
            </div>
          )}
          {integration.data.externalSiteId && (
            <>
              <div className="panel section-gap">
                <h2>Billets importés</h2>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Titre</th>
                        <th>État</th>
                        <th>Libellés</th>
                        <th>Mis à jour</th>
                      </tr>
                    </thead>
                    <tbody>
                      {posts.data?.map((post) => (
                        <tr key={post.id}>
                          <td>{post.title}</td>
                          <td>{post.status}</td>
                          <td>{post.labels.join(', ')}</td>
                          <td>
                            {post.updatedExternallyAt
                              ? new Date(post.updatedExternallyAt).toLocaleString('fr-FR')
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="panel section-gap">
                <h2>Libellés Blogger</h2>
                <div className="chip-row">
                  {externalLabels.data?.map((label) => (
                    <span className="status-pill" key={label.id}>
                      {label.name} · {label.usageCount}
                    </span>
                  ))}
                </div>
              </div>
              <div className="panel section-gap">
                <h2>Publication de test contrôlée</h2>
                <p className="muted-copy">
                  La création reste en brouillon. Publier ou supprimer exige le garde-fou serveur
                  correspondant.
                </p>
                <div className="form-grid">
                  <label>
                    Titre
                    <input value={title} onChange={(event) => setTitle(event.target.value)} />
                  </label>
                  <label>
                    Libellés
                    <input value={labels} onChange={(event) => setLabels(event.target.value)} />
                  </label>
                  <label className="span-two">
                    HTML
                    <textarea
                      value={htmlContent}
                      onChange={(event) => setHtmlContent(event.target.value)}
                    />
                  </label>
                  <div className="button-row span-two">
                    <button className="primary-button" onClick={() => createDraft.mutate()}>
                      Créer le brouillon
                    </button>
                    {lastPost && (
                      <>
                        <button
                          className="secondary-button"
                          onClick={() => updateDraft.mutate(lastPost.externalPostId)}
                        >
                          Mettre à jour
                        </button>
                        <button
                          className="secondary-button"
                          disabled={!status.data?.publicPublishEnabled}
                          onClick={() => publish.mutate(lastPost.externalPostId)}
                        >
                          Publier
                        </button>
                        <button
                          className="danger-button"
                          disabled={!status.data?.deleteEnabled}
                          onClick={() => remove.mutate(lastPost.externalPostId)}
                        >
                          Supprimer le test
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="panel section-gap">
                <h2>Historique des synchronisations</h2>
                {runs.data?.map((run) => (
                  <p key={run.id}>
                    <strong>{run.status}</strong> · {run.itemsProcessed} traité(s) · corrélation{' '}
                    {run.correlationId}
                  </p>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {mutationError && (
        <div className="inline-error section-gap" role="alert">
          {errorText(mutationError)}
        </div>
      )}
    </section>
  );
}
