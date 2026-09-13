import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiConfigurationSummary,
  AiProviderDescriptor,
  AiProviderTestResult,
  AiRunSummary,
} from '@ai-content-os/contracts';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';

interface FormState {
  providerKey: string;
  model: string;
  credential: string;
  timeoutMs: string;
  maxRetries: string;
  monthlyTokenLimit: string;
}

const emptyForm: FormState = {
  providerKey: 'mock',
  model: 'mock-v1',
  credential: '',
  timeoutMs: '10000',
  maxRetries: '2',
  monthlyTokenLimit: '',
};

export function AiInfrastructurePage(): React.JSX.Element {
  const { workspaceId = '' } = useParams<{ workspaceId?: string }>();
  const auth = useAuth();
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [notice, setNotice] = useState('');
  const base = `/workspaces/${workspaceId}/ai`;
  const providers = useQuery({
    queryKey: ['ai-providers', workspaceId],
    queryFn: () => apiRequest<AiProviderDescriptor[]>(`${base}/providers`),
  });
  const configurations = useQuery({
    queryKey: ['ai-configurations', workspaceId],
    queryFn: () => apiRequest<AiConfigurationSummary[]>(`${base}/configurations`),
  });
  const runs = useQuery({
    queryKey: ['ai-runs', workspaceId],
    queryFn: () => apiRequest<AiRunSummary[]>(`${base}/runs?limit=20`),
  });
  const workspaceConfiguration = configurations.data?.find(
    (configuration) => configuration.scope === 'WORKSPACE',
  );

  useEffect(() => {
    if (!workspaceConfiguration) return;
    setForm({
      providerKey: workspaceConfiguration.providerKey,
      model: workspaceConfiguration.model,
      credential: '',
      timeoutMs: String(workspaceConfiguration.timeoutMs),
      maxRetries: String(workspaceConfiguration.maxRetries),
      monthlyTokenLimit: workspaceConfiguration.monthlyTokenLimit?.toString() ?? '',
    });
  }, [workspaceConfiguration]);

  const save = useMutation({
    mutationFn: () =>
      apiRequest<AiConfigurationSummary>(`${base}/configurations`, {
        method: 'PUT',
        body: JSON.stringify({
          scope: 'WORKSPACE',
          providerKey: form.providerKey,
          model: form.model,
          ...(form.credential ? { credential: form.credential } : {}),
          timeoutMs: Number(form.timeoutMs),
          maxRetries: Number(form.maxRetries),
          ...(form.monthlyTokenLimit ? { monthlyTokenLimit: Number(form.monthlyTokenLimit) } : {}),
        }),
      }),
    onSuccess: async () => {
      setForm((current) => ({ ...current, credential: '' }));
      setNotice('Configuration IA enregistrée.');
      await client.invalidateQueries({ queryKey: ['ai-configurations', workspaceId] });
    },
  });
  const test = useMutation({
    mutationFn: () => {
      if (!workspaceConfiguration?.id) throw new Error('Enregistrez d’abord la configuration.');
      return apiRequest<AiProviderTestResult>(
        `${base}/configurations/${workspaceConfiguration.id}/test`,
        { method: 'POST' },
      );
    },
    onSuccess: async () => {
      setNotice('Test du fournisseur réussi.');
      await client.invalidateQueries({ queryKey: ['ai-runs', workspaceId] });
    },
  });

  if (providers.isPending || configurations.isPending || runs.isPending) return <Loading />;
  const error = save.error ?? test.error ?? configurations.error ?? runs.error ?? providers.error;
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Phase 4A · Administration</span>
          <h1>Infrastructure IA</h1>
          <p>Configuration fournisseur neutre, limites et observabilité.</p>
        </div>
      </div>

      <article className="panel">
        <h2>Configuration par défaut de l’espace</h2>
        <p>
          Les futurs réglages de profil priment sur ceux du site, puis sur cette valeur d’espace.
        </p>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice('');
            save.mutate();
          }}
        >
          <label>
            Fournisseur
            <select
              value={form.providerKey}
              onChange={(event) =>
                setForm((current) => ({ ...current, providerKey: event.target.value }))
              }
              disabled={!auth.can('ai.config.update', workspaceId)}
            >
              {providers.data?.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modèle
            <input
              value={form.model}
              maxLength={160}
              onChange={(event) =>
                setForm((current) => ({ ...current, model: event.target.value }))
              }
              disabled={!auth.can('ai.config.update', workspaceId)}
            />
          </label>
          <label>
            Nouvel identifiant fournisseur
            <input
              type="password"
              autoComplete="new-password"
              value={form.credential}
              placeholder={
                workspaceConfiguration?.hasCredential
                  ? `Identifiant enregistré ${workspaceConfiguration.credentialHint ?? ''}`
                  : 'Aucun identifiant enregistré'
              }
              onChange={(event) =>
                setForm((current) => ({ ...current, credential: event.target.value }))
              }
              disabled={!auth.can('ai.config.update', workspaceId)}
            />
          </label>
          <label>
            Délai maximal (ms)
            <input
              type="number"
              min="50"
              max="120000"
              value={form.timeoutMs}
              onChange={(event) =>
                setForm((current) => ({ ...current, timeoutMs: event.target.value }))
              }
              disabled={!auth.can('ai.config.update', workspaceId)}
            />
          </label>
          <label>
            Nouvelles tentatives
            <input
              type="number"
              min="0"
              max="5"
              value={form.maxRetries}
              onChange={(event) =>
                setForm((current) => ({ ...current, maxRetries: event.target.value }))
              }
              disabled={!auth.can('ai.config.update', workspaceId)}
            />
          </label>
          <label>
            Limite mensuelle de jetons
            <input
              type="number"
              min="0"
              value={form.monthlyTokenLimit}
              placeholder="Non définie"
              onChange={(event) =>
                setForm((current) => ({ ...current, monthlyTokenLimit: event.target.value }))
              }
              disabled={!auth.can('ai.config.update', workspaceId)}
            />
          </label>
          <div className="button-row">
            {auth.can('ai.config.update', workspaceId) && (
              <button type="submit" disabled={save.isPending}>
                Enregistrer
              </button>
            )}
            {workspaceConfiguration?.id && auth.can('ai.config.test', workspaceId) && (
              <button
                type="button"
                className="secondary-button"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                Tester le fournisseur
              </button>
            )}
          </div>
        </form>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error instanceof Error ? error.message : 'Erreur IA.'}</p>}
      </article>

      <article className="panel">
        <h2>Exécutions récentes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Opération</th>
                <th>Fournisseur / modèle</th>
                <th>État</th>
                <th>Jetons</th>
                <th>Tentatives</th>
                <th>Démarrage</th>
              </tr>
            </thead>
            <tbody>
              {runs.data?.map((run) => (
                <tr key={run.id}>
                  <td>{run.operation}</td>
                  <td>{`${run.providerKey} / ${run.model}`}</td>
                  <td>{run.status}</td>
                  <td>{run.totalTokens ?? '—'}</td>
                  <td>{run.retryCount + 1}</td>
                  <td>{new Date(run.startedAt).toLocaleString()}</td>
                </tr>
              ))}
              {!runs.data?.length && (
                <tr>
                  <td colSpan={6}>Aucune exécution enregistrée.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <p className="safety-note">
        Cette page teste uniquement l’infrastructure. Les contenus et réponses brutes ne sont pas
        conservés.
      </p>
    </section>
  );
}
