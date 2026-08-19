import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type {
  ContentCommentSummary,
  ContentItemSummary,
  ContentPublicationSummary,
  ContentReviewDecision,
  ContentReviewSummary,
} from '@ai-content-os/contracts';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';

interface Props {
  workspaceId: string;
  websiteId: string;
  item: ContentItemSummary;
}

const syncLabels: Record<ContentPublicationSummary['synchronization'], string> = {
  NOT_CONNECTED: 'Non connecté',
  DRAFT_CREATED: 'Brouillon créé',
  OUT_OF_SYNC: 'À mettre à jour',
  SYNCHRONIZED: 'À jour',
  ERROR: 'Erreur',
  MISSING: 'Brouillon externe introuvable',
};

const connectionLabels: Record<string, string> = {
  CONNECTED: 'Connecté',
  EXPIRED: 'Autorisation expirée',
  DEGRADED: 'Connexion dégradée',
  PENDING: 'Connexion en attente',
  REVOKED: 'Révoqué',
  DISCONNECTED: 'Non connecté',
};

function actionKey(action: string, contentId: string, revision: number): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `content-${action}-${contentId}-${revision}-${random}`;
}

export function ContentReviewPanel({ workspaceId, websiteId, item }: Props): React.JSX.Element {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const base = `/workspaces/${workspaceId}/websites/${websiteId}/contents/${item.id}`;
  const [comment, setComment] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [notice, setNotice] = useState<string>();
  const comments = useQuery({
    queryKey: ['content-comments', workspaceId, websiteId, item.id],
    queryFn: () => apiRequest<ContentCommentSummary[]>(`${base}/comments`),
    enabled: auth.can('contents.comments.read', workspaceId),
  });
  const reviews = useQuery({
    queryKey: ['content-reviews', workspaceId, websiteId, item.id],
    queryFn: () => apiRequest<ContentReviewSummary[]>(`${base}/reviews`),
    enabled: auth.can('contents.reviews.read', workspaceId),
  });
  const publication = useQuery({
    queryKey: ['content-publication', workspaceId, websiteId, item.id],
    queryFn: () => apiRequest<ContentPublicationSummary>(`${base}/publication`),
    enabled: auth.can('contents.publication.read', workspaceId),
    retry: false,
  });
  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['content', workspaceId, websiteId, item.id] }),
      queryClient.invalidateQueries({ queryKey: ['contents', workspaceId, websiteId] }),
      queryClient.invalidateQueries({ queryKey: ['review-center', workspaceId, websiteId] }),
      queryClient.invalidateQueries({
        queryKey: ['content-comments', workspaceId, websiteId, item.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['content-reviews', workspaceId, websiteId, item.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['content-revisions', workspaceId, websiteId, item.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['content-publication', workspaceId, websiteId, item.id],
      }),
    ]);
  };
  const addComment = useMutation({
    mutationFn: () =>
      apiRequest<ContentCommentSummary>(`${base}/comments`, {
        method: 'POST',
        body: JSON.stringify({ message: comment }),
      }),
    onSuccess: async () => {
      setComment('');
      setNotice('Commentaire ajouté.');
      await invalidate();
    },
  });
  const setCommentStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'resolve' | 'reopen' }) =>
      apiRequest<ContentCommentSummary>(`${base}/comments/${id}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const decide = useMutation({
    mutationFn: (decision: ContentReviewDecision) =>
      apiRequest<ContentReviewSummary>(`${base}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          reviewedRevisionNumber: item.version,
          note: reviewNote || undefined,
        }),
      }),
    onSuccess: async (result) => {
      setReviewNote('');
      setNotice(result.decision === 'APPROVED' ? 'Version approuvée.' : 'Modifications demandées.');
      await invalidate();
    },
  });
  const handoff = useMutation({
    mutationFn: (kind: 'create' | 'update') =>
      apiRequest<ContentPublicationSummary>(`${base}/publication/blogger/draft`, {
        method: kind === 'create' ? 'POST' : 'PATCH',
        body: JSON.stringify({
          expectedRevision: item.version,
          idempotencyKey: actionKey(kind, item.id, item.version),
        }),
      }),
    onSuccess: async (result) => {
      setNotice(
        result.synchronization === 'SYNCHRONIZED'
          ? 'Le brouillon Blogger est synchronisé.'
          : 'État Blogger actualisé.',
      );
      await invalidate();
    },
  });
  const error =
    addComment.error ??
    setCommentStatus.error ??
    decide.error ??
    handoff.error ??
    publication.error;
  const pub = publication.data;
  return (
    <div className="review-publication-grid section-gap">
      <section className="panel stack-form" aria-labelledby="comments-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Discussion interne</span>
            <h2 id="comments-title">Commentaires</h2>
          </div>
          <span className="status-pill">Version {item.version}</span>
        </div>
        {comments.isPending && auth.can('contents.comments.read', workspaceId) && <Loading />}
        {comments.isError && <div className="inline-error">Commentaires indisponibles.</div>}
        {comments.data?.length === 0 && <p className="empty-state">Aucun commentaire.</p>}
        <div className="comment-list">
          {comments.data?.map((entry) => (
            <article className="comment-card" key={entry.id}>
              <div className="section-heading">
                <strong>{entry.authorDisplayName ?? 'Membre'}</strong>
                <span className="status-pill">{entry.status === 'OPEN' ? 'Ouvert' : 'Résolu'}</span>
              </div>
              <p>{entry.message}</p>
              <small>{new Date(entry.createdAt).toLocaleString('fr-FR')}</small>
              {auth.can('contents.comments.resolve', workspaceId) && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setCommentStatus.mutate({
                      id: entry.id,
                      action: entry.status === 'OPEN' ? 'resolve' : 'reopen',
                    })
                  }
                >
                  {entry.status === 'OPEN' ? 'Résoudre' : 'Rouvrir'}
                </button>
              )}
            </article>
          ))}
        </div>
        {auth.can('contents.comments.create', workspaceId) && (
          <div className="stack-form">
            <label>
              Ajouter un commentaire
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={4000}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={!comment.trim() || addComment.isPending}
              onClick={() => addComment.mutate()}
            >
              Commenter
            </button>
          </div>
        )}
      </section>

      <section className="panel stack-form" aria-labelledby="review-title">
        <span className="eyebrow">Décisions immuables</span>
        <h2 id="review-title">Révision</h2>
        {reviews.isPending && auth.can('contents.reviews.read', workspaceId) && <Loading />}
        {reviews.data?.length === 0 && <p className="empty-state">Aucune décision enregistrée.</p>}
        {reviews.data?.map((review) => (
          <article className="review-card" key={review.id}>
            <strong>
              {review.decision === 'APPROVED' ? 'Approuvé' : 'Modifications demandées'} · version{' '}
              {review.reviewedRevisionNumber}
            </strong>
            <small>{review.reviewerDisplayName ?? 'Relecteur'}</small>
            {review.note && <p>{review.note}</p>}
          </article>
        ))}
        {item.editorialStatus === 'IN_REVIEW' &&
          (auth.can('contents.reviews.approve', workspaceId) ||
            auth.can('contents.reviews.requestChanges', workspaceId)) && (
            <div className="stack-form">
              <label>
                Note de décision
                <textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  maxLength={4000}
                />
              </label>
              <div className="button-row">
                {auth.can('contents.reviews.requestChanges', workspaceId) && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!reviewNote.trim() || decide.isPending}
                    onClick={() => decide.mutate('CHANGES_REQUESTED')}
                  >
                    Demander des modifications
                  </button>
                )}
                {auth.can('contents.reviews.approve', workspaceId) && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate('APPROVED')}
                  >
                    Approuver cette version
                  </button>
                )}
              </div>
            </div>
          )}
      </section>

      {auth.can('contents.publication.read', workspaceId) && (
        <section className="panel stack-form publication-panel" aria-labelledby="publication-title">
          <span className="eyebrow">Handoff humain contrôlé</span>
          <h2 id="publication-title">Publication Blogger</h2>
          {publication.isPending && <Loading />}
          {pub && (
            <div className="publication-state-grid">
              <span>Éditorial</span>
              <strong>
                {item.editorialStatus === 'READY_TO_PUBLISH'
                  ? 'Prêt à publier'
                  : item.editorialStatus}
              </strong>
              <span>Connexion</span>
              <strong>{connectionLabels[pub.connectionStatus ?? 'DISCONNECTED']}</strong>
              <span>Brouillon externe</span>
              <strong>{pub.externalDraftExists ? 'Créé' : 'Aucun'}</strong>
              <span>Dernière version synchronisée</span>
              <strong>
                {pub.synchronizedRevisionNumber
                  ? `Version ${pub.synchronizedRevisionNumber}`
                  : 'Aucune'}
              </strong>
              <span>Version interne</span>
              <strong>Version {pub.currentRevisionNumber}</strong>
              <span>Synchronisation</span>
              <strong>{syncLabels[pub.synchronization]}</strong>
            </div>
          )}
          {pub?.synchronization === 'MISSING' && (
            <div className="notice warning">
              Le brouillon Blogger lié est introuvable. Aucune recréation automatique n’a été faite.
            </div>
          )}
          {pub?.connectionStatus === 'EXPIRED' && (
            <Link
              className="secondary-button"
              to={`/espaces/${workspaceId}/sites/${websiteId}/integrations/blogger`}
            >
              Reconnecter Blogger
            </Link>
          )}
          {item.editorialStatus === 'READY_TO_PUBLISH' &&
            pub?.connectionStatus === 'CONNECTED' &&
            !pub.externalDraftExists &&
            pub.synchronization !== 'MISSING' &&
            auth.can('contents.publication.createDraft', workspaceId) && (
              <button
                type="button"
                className="primary-button"
                disabled={handoff.isPending}
                onClick={() => handoff.mutate('create')}
              >
                Créer le brouillon Blogger
              </button>
            )}
          {item.editorialStatus === 'READY_TO_PUBLISH' &&
            pub?.synchronization === 'OUT_OF_SYNC' &&
            auth.can('contents.publication.updateDraft', workspaceId) && (
              <button
                type="button"
                className="primary-button"
                disabled={handoff.isPending}
                onClick={() => handoff.mutate('update')}
              >
                Mettre à jour le brouillon Blogger
              </button>
            )}
          {pub && (
            <p className="muted-copy">
              La publication publique et la suppression externe restent désactivées dans ce flux.
            </p>
          )}
        </section>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error instanceof Error ? error.message : 'Action impossible.'}
        </div>
      )}
    </div>
  );
}
