import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContentProfileSummary, WebsiteSummary } from '@ai-content-os/contracts';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';

export function ContentProfilesPage(): React.JSX.Element {
  const { workspaceId = '', websiteId = '' } = useParams<{
    workspaceId?: string;
    websiteId?: string;
  }>();
  const auth = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [tone, setTone] = useState('');
  const [language, setLanguage] = useState('');
  const [locale, setLocale] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [rules, setRules] = useState('{"attributionRequired":true}');
  const websiteBase = `/workspaces/${workspaceId}/websites/${websiteId}`;
  const base = `${websiteBase}/content-profiles`;
  const website = useQuery({
    queryKey: ['website', workspaceId, websiteId],
    queryFn: () => apiRequest<WebsiteSummary>(websiteBase),
  });
  const profiles = useQuery({
    queryKey: ['profiles', workspaceId, websiteId],
    queryFn: () => apiRequest<ContentProfileSummary[]>(base),
  });
  useEffect(() => {
    if (!website.data) return;
    setLanguage((current) => current || website.data.language);
    setLocale((current) => current || website.data.locale || '');
    setCountryCode((current) => {
      if (current) return current;
      const region = website.data.locale
        ?.split('-')
        .slice(1)
        .find((part) => /^[a-z]{2}$/i.test(part));
      return region?.toUpperCase() ?? '';
    });
  }, [website.data]);
  const invalidate = () =>
    client.invalidateQueries({ queryKey: ['profiles', workspaceId, websiteId] });
  const create = useMutation({
    mutationFn: () =>
      apiRequest(base, {
        method: 'POST',
        body: JSON.stringify({
          name,
          language: language.trim().toLowerCase(),
          ...(locale.trim() ? { locale: locale.trim() } : {}),
          ...(countryCode.trim() ? { countryCode: countryCode.trim().toUpperCase() } : {}),
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
          <label>
            Langue
            <input
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              placeholder="fr, ar, en…"
              pattern="[A-Za-z]{2,3}"
              required
            />
          </label>
          <label>
            Locale
            <input
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              placeholder="fr-FR, ar-MA, en-US…"
            />
          </label>
          <label>
            Pays (ISO 3166-1 alpha-2)
            <input
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
              placeholder="FR, MA, US…"
              pattern="[A-Za-z]{2}"
              maxLength={2}
            />
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
