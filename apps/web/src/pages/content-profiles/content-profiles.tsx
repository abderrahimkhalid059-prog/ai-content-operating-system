import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContentProfileSummary } from '@ai-content-os/contracts';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';

export function ContentProfilesPage(): React.JSX.Element {
  const { workspaceId = '', websiteId = '' } = useParams();
  const auth = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [tone, setTone] = useState('');
  const [rules, setRules] = useState('{"attributionRequired":true}');
  const base = `/workspaces/${workspaceId}/websites/${websiteId}/content-profiles`;
  const profiles = useQuery({
    queryKey: ['profiles', workspaceId, websiteId],
    queryFn: () => apiRequest<ContentProfileSummary[]>(base),
  });
  const invalidate = () =>
    client.invalidateQueries({ queryKey: ['profiles', workspaceId, websiteId] });
  const create = useMutation({
    mutationFn: () =>
      apiRequest(base, {
        method: 'POST',
        body: JSON.stringify({
          name,
          language: 'ar',
          locale: 'ar-MA',
          countryCode: 'MA',
          tone,
          editorialRules: JSON.parse(rules) as unknown,
          prohibitedTopics: [],
          isDefault: false,
        }),
      }),
    onSuccess: () => {
      setName('');
      setTone('');
      return invalidate();
    },
  });
  const setDefault = useMutation({
    mutationFn: (id: string) => apiRequest(`${base}/${id}/set-default`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest<void>(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Configuration</span>
          <h1>Profils éditoriaux</h1>
        </div>
      </div>
      {auth.can('contentProfiles.create', workspaceId) && (
        <form
          className="panel form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            Nom
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Ton
            <input value={tone} onChange={(event) => setTone(event.target.value)} required />
          </label>
          <label className="span-two">
            Règles JSON
            <textarea value={rules} onChange={(event) => setRules(event.target.value)} />
          </label>
          <button className="primary-button">Ajouter</button>
        </form>
      )}
      {profiles.isPending && <Loading />}
      <div className="card-list">
        {profiles.data?.map((profile) => (
          <article className="panel session-card" key={profile.id}>
            <div>
              <strong>
                {profile.name}{' '}
                {profile.isDefault && <span className="status-pill active">Par défaut</span>}
              </strong>
              <p>
                {profile.language} · {profile.tone}
              </p>
            </div>
            <div className="button-row">
              {auth.can('contentProfiles.update', workspaceId) &&
                !profile.isDefault &&
                profile.status === 'ACTIVE' && (
                  <button
                    className="secondary-button"
                    onClick={() => setDefault.mutate(profile.id)}
                  >
                    Définir par défaut
                  </button>
                )}
              {auth.can('contentProfiles.delete', workspaceId) && (
                <button className="danger-button" onClick={() => remove.mutate(profile.id)}>
                  Désactiver
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
