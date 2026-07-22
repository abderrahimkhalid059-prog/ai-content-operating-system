import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceSummary } from '@ai-content-os/contracts';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { apiRequest } from '../../api/client';
import { Loading } from '../../components/loading';

const schema = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
type FormValues = z.infer<typeof schema>;

export function WorkspacesPage(): React.JSX.Element {
  const client = useQueryClient();
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => apiRequest<WorkspaceSummary[]>('/workspaces'),
  });
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const create = useMutation({
    mutationFn: (values: FormValues) =>
      apiRequest<WorkspaceSummary>('/workspaces', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      form.reset();
      return client.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Organisation</span>
          <h1>Espaces de travail</h1>
        </div>
      </div>
      <div className="two-column">
        <div>
          {workspaces.isPending && <Loading />}
          <div className="card-list">
            {workspaces.data?.map((workspace) => (
              <Link
                className="panel linked-card"
                key={workspace.id}
                to={`/espaces/${workspace.id}`}
              >
                <div>
                  <strong>{workspace.name}</strong>
                  <p>{workspace.slug}</p>
                </div>
                <span className="role-badge">{workspace.role}</span>
              </Link>
            ))}
          </div>
        </div>
        <article className="panel">
          <h2>Créer un espace</h2>
          <form
            className="stack-form"
            onSubmit={(event) => void form.handleSubmit((values) => create.mutate(values))(event)}
          >
            <label>
              Nom
              <input {...form.register('name')} />
            </label>
            <label>
              Slug
              <input {...form.register('slug')} placeholder="mon-espace" />
            </label>
            {create.isError && <div className="inline-error">Création impossible.</div>}
            <button className="primary-button">Créer</button>
          </form>
        </article>
      </div>
    </section>
  );
}
