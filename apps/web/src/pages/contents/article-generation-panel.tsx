import { useMutation } from '@tanstack/react-query';
import type {
  AiGenerationApplyResult,
  AiGenerationCandidateSummary,
  ContentItemSummary,
} from '@ai-content-os/contracts';
import { useState } from 'react';
import { apiRequest, ApiClientError } from '../../api/client';
import { useAuth } from '../../auth/auth-context';

interface Props {
  workspaceId: string;
  websiteId: string;
  item: ContentItemSummary;
  contentProfileId: string;
  onApplied: () => Promise<void>;
}

interface BriefState {
  topic: string;
  angle: string;
  targetAudience: string;
  instructions: string;
  approximateLength: string;
}

const emptyBrief: BriefState = {
  topic: '',
  angle: '',
  targetAudience: '',
  instructions: '',
  approximateLength: '',
};

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : 'La génération IA contrôlée a échoué.';
}

export function ArticleGenerationPanel({
  workspaceId,
  websiteId,
  item,
  contentProfileId,
  onApplied,
}: Props): React.JSX.Element | null {
  const auth = useAuth();
  const [brief, setBrief] = useState<BriefState>(emptyBrief);
  const [candidate, setCandidate] = useState<AiGenerationCandidateSummary>();
  const [appliedRevisionNumber, setAppliedRevisionNumber] = useState<number>();
  const base = `/workspaces/${workspaceId}/websites/${websiteId}/contents/${item.id}/ai-generations`;
  const canGenerate = auth.can('contents.ai.generate', workspaceId);
  const canApply = auth.can('contents.ai.apply', workspaceId);
  const set = (field: keyof BriefState, value: string): void =>
    setBrief((current) => ({ ...current, [field]: value }));

  const generate = useMutation({
    mutationFn: () =>
      apiRequest<AiGenerationCandidateSummary>(base, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: item.version,
          contentProfileId,
          topic: brief.topic,
          ...(brief.angle.trim() ? { angle: brief.angle.trim() } : {}),
          ...(brief.targetAudience.trim() ? { targetAudience: brief.targetAudience.trim() } : {}),
          ...(brief.instructions.trim() ? { instructions: brief.instructions.trim() } : {}),
          ...(brief.approximateLength
            ? { approximateLength: Number(brief.approximateLength) }
            : {}),
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
    onMutate: () => setAppliedRevisionNumber(undefined),
    onSuccess: setCandidate,
  });
  const apply = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error('Aucun aperçu IA disponible.');
      return apiRequest<AiGenerationApplyResult>(`${base}/${candidate.id}/apply`, {
        method: 'POST',
      });
    },
    onSuccess: async (result) => {
      setCandidate(undefined);
      setAppliedRevisionNumber(result.revisionNumber);
      await onApplied();
    },
  });
  const discard = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error('Aucun aperçu IA disponible.');
      return apiRequest<AiGenerationCandidateSummary>(`${base}/${candidate.id}/discard`, {
        method: 'POST',
      });
    },
    onSuccess: () => setCandidate(undefined),
  });

  if (!canGenerate) return null;
  const error = generate.error ?? apply.error ?? discard.error;
  return (
    <section className="panel stack-form section-gap" aria-labelledby="ai-generation-title">
      <div>
        <span className="eyebrow">Prévisualisation contrôlée</span>
        <h2 id="ai-generation-title">Générer avec l’IA</h2>
        <p>
          Le résultat reste un aperçu non enregistré jusqu’à l’action « Utiliser ce brouillon ».
        </p>
      </div>
      {appliedRevisionNumber !== undefined && (
        <p className="notice success" role="status">
          Brouillon IA appliqué et enregistré comme version {appliedRevisionNumber}.
        </p>
      )}
      {!candidate && (
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            generate.mutate();
          }}
        >
          {!contentProfileId && (
            <p className="inline-error">Sélectionnez d’abord un profil éditorial actif.</p>
          )}
          <label>
            Sujet
            <input
              value={brief.topic}
              onChange={(event) => set('topic', event.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <label>
            Angle (facultatif)
            <textarea
              value={brief.angle}
              onChange={(event) => set('angle', event.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            Public cible (facultatif)
            <textarea
              value={brief.targetAudience}
              onChange={(event) => set('targetAudience', event.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            Instructions complémentaires (facultatif)
            <textarea
              value={brief.instructions}
              onChange={(event) => set('instructions', event.target.value)}
              maxLength={4000}
            />
          </label>
          <label>
            Longueur approximative (mots)
            <input
              type="number"
              min="100"
              max="5000"
              value={brief.approximateLength}
              onChange={(event) => set('approximateLength', event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={!contentProfileId || generate.isPending}
          >
            {generate.isPending ? 'Génération en cours…' : 'Générer un brouillon'}
          </button>
        </form>
      )}
      {candidate?.draft && (
        <article className="stack-form" aria-label="Aperçu IA non enregistré">
          <div className="notice">Aperçu IA non enregistré</div>
          <h3>{candidate.draft.title}</h3>
          {candidate.draft.excerpt && <p>{candidate.draft.excerpt}</p>}
          <pre>{candidate.draft.bodyHtml}</pre>
          <dl className="details-list">
            <dt>Fournisseur / modèle</dt>
            <dd>{`${candidate.providerKey ?? '—'} / ${candidate.model ?? '—'}`}</dd>
            <dt>Prompt</dt>
            <dd>{`${candidate.promptIdentifier}@${candidate.promptVersion}`}</dd>
            <dt>Version de base</dt>
            <dd>{candidate.baseRevisionNumber}</dd>
            <dt>Libellés suggérés</dt>
            <dd>{candidate.draft.suggestedLabels.join(', ') || 'Aucun'}</dd>
          </dl>
          {candidate.draft.warnings.length > 0 && (
            <ul>
              {candidate.draft.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="button-row">
            {canApply && candidate.status === 'READY' && (
              <button
                type="button"
                className="primary-button"
                disabled={apply.isPending}
                onClick={() => apply.mutate()}
              >
                Utiliser ce brouillon
              </button>
            )}
            {candidate.status === 'READY' && (
              <button
                type="button"
                className="secondary-button"
                disabled={discard.isPending}
                onClick={() => discard.mutate()}
              >
                Annuler / Ignorer
              </button>
            )}
            {candidate.status === 'READY' && (
              <button
                type="button"
                className="secondary-button"
                disabled={discard.isPending}
                onClick={() => discard.mutate()}
              >
                Régénérer
              </button>
            )}
          </div>
        </article>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
    </section>
  );
}
