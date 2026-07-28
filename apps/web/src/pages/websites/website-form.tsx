import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebsitePlatform, WebsiteStatus, WebsiteSummary } from '@ai-content-os/contracts';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useHistory, useParams } from 'react-router-dom';
import { z } from 'zod';
import { apiRequest, ApiClientError } from '../../api/client';
import { Loading } from '../../components/loading';

const schema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  platform: z.enum(['BLOGGER', 'WORDPRESS', 'OTHER']),
  language: z.string().regex(/^[a-z]{2,3}$/i),
  locale: z.string().optional(),
  timezone: z.string().min(1),
  description: z.string().max(1000).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']),
});
type WebsiteFormValues = z.infer<typeof schema>;

export function WebsiteFormPage(): React.JSX.Element {
  const { workspaceId = '', websiteId } = useParams<{
    workspaceId?: string;
    websiteId?: string;
  }>();
  const history = useHistory();
  const client = useQueryClient();
  const editing = Boolean(websiteId);
  const website = useQuery({
    queryKey: ['website', workspaceId, websiteId],
    queryFn: () => apiRequest<WebsiteSummary>(`/workspaces/${workspaceId}/websites/${websiteId}`),
    enabled: editing,
  });
  const form = useForm<WebsiteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      platform: 'OTHER' as WebsitePlatform,
      status: 'DRAFT' as WebsiteStatus,
      language: 'fr',
      timezone: 'Africa/Casablanca',
    },
  });
  useEffect(() => {
    if (website.data)
      form.reset({
        name: website.data.name,
        slug: website.data.slug,
        platform: website.data.platform,
        language: website.data.language,
        locale: website.data.locale ?? '',
        timezone: website.data.timezone,
        description: website.data.description ?? '',
        status: website.data.status,
      });
  }, [form, website.data]);
  const save = useMutation({
    mutationFn: (values: WebsiteFormValues) =>
      apiRequest<WebsiteSummary>(
        editing
          ? `/workspaces/${workspaceId}/websites/${websiteId}`
          : `/workspaces/${workspaceId}/websites`,
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(values) },
      ),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['websites', workspaceId] });
      history.push(`/espaces/${workspaceId}/sites/${result.id}`);
    },
  });
  const deactivate = useMutation({
    mutationFn: () =>
      apiRequest<void>(`/workspaces/${workspaceId}/websites/${websiteId}`, { method: 'DELETE' }),
    onSuccess: () => history.push(`/espaces/${workspaceId}/sites`),
  });
  if (editing && website.isPending) return <Loading />;
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Site</span>
          <h1>{editing ? 'Modifier le site' : 'Nouveau site'}</h1>
        </div>
        {editing && (
          <div className="button-row">
            {website.data?.platform === 'BLOGGER' && (
              <Link
                className="primary-button"
                to={`/espaces/${workspaceId}/sites/${websiteId}/integrations/blogger`}
              >
                Intégration Blogger
              </Link>
            )}
            <Link
              className="secondary-button"
              to={`/espaces/${workspaceId}/sites/${websiteId}/profils-editoriaux`}
            >
              Profils éditoriaux
            </Link>
          </div>
        )}
      </div>
      <form
        className="panel form-grid"
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <label>
          Nom
          <input {...form.register('name')} />
        </label>
        <label>
          Slug
          <input {...form.register('slug')} />
        </label>
        <label>
          Plateforme
          <select {...form.register('platform')}>
            <option>BLOGGER</option>
            <option>WORDPRESS</option>
            <option>OTHER</option>
          </select>
        </label>
        <label>
          Statut
          <select {...form.register('status')}>
            <option>DRAFT</option>
            <option>ACTIVE</option>
            <option>INACTIVE</option>
          </select>
        </label>
        <label>
          Langue
          <input {...form.register('language')} />
        </label>
        <label>
          Locale
          <input {...form.register('locale')} placeholder="ar-MA" />
        </label>
        <label>
          Fuseau horaire
          <input {...form.register('timezone')} />
        </label>
        <label className="span-two">
          Description
          <textarea {...form.register('description')} />
        </label>
        {save.isError && (
          <div className="inline-error span-two" role="alert">
            {save.error instanceof ApiClientError
              ? save.error.message
              : 'Enregistrement impossible.'}
          </div>
        )}
        <div className="form-actions span-two">
          <button className="primary-button">Enregistrer</button>
          {editing && (
            <button type="button" className="danger-button" onClick={() => deactivate.mutate()}>
              Désactiver
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
