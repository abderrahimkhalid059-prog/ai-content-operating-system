import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceMemberSummary, WorkspaceRole } from '@ai-content-os/contracts';
import { useState } from 'react';
import { apiRequest, ApiClientError } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Loading } from '../../components/loading';
import { useParams } from 'react-router-dom';

const roles: WorkspaceRole[] = [
  'OWNER',
  'ADMIN',
  'EDITOR',
  'REVIEWER',
  'SEO_MANAGER',
  'WRITER',
  'VIEWER',
];

export function MembersPage(): React.JSX.Element {
  const { workspaceId = '' } = useParams<{ workspaceId?: string }>();
  const auth = useAuth();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('VIEWER');
  const [error, setError] = useState<string>();
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => apiRequest<WorkspaceMemberSummary[]>(`/workspaces/${workspaceId}/members`),
  });
  const invalidate = () => client.invalidateQueries({ queryKey: ['members', workspaceId] });
  const add = useMutation({
    mutationFn: () =>
      apiRequest(`/workspaces/${workspaceId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: () => {
      setEmail('');
      return invalidate();
    },
    onError: (cause) =>
      setError(cause instanceof ApiClientError ? cause.message : 'Ajout impossible.'),
  });
  const update = useMutation({
    mutationFn: ({ id, nextRole }: { id: string; nextRole: WorkspaceRole }) =>
      apiRequest(`/workspaces/${workspaceId}/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/workspaces/${workspaceId}/members/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Espace</span>
          <h1>Membres</h1>
        </div>
      </div>
      {auth.can('members.create', workspaceId) && (
        <form
          className="inline-form panel"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Rôle
            <select value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)}>
              {roles.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <button className="primary-button">Ajouter</button>
          {error && <span className="field-error">{error}</span>}
        </form>
      )}
      {members.isPending && <Loading />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>Statut</th>
              <th>Rôle</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.data?.map((member) => (
              <tr key={member.id}>
                <td>
                  <strong>{member.user.displayName ?? member.user.email}</strong>
                  <small>{member.user.email}</small>
                </td>
                <td>{member.user.status}</td>
                <td>
                  {auth.can('members.update', workspaceId) ? (
                    <select
                      aria-label={`Rôle de ${member.user.email}`}
                      value={member.role}
                      onChange={(event) =>
                        update.mutate({
                          id: member.id,
                          nextRole: event.target.value as WorkspaceRole,
                        })
                      }
                    >
                      {roles.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  ) : (
                    member.role
                  )}
                </td>
                <td>
                  {auth.can('members.delete', workspaceId) && (
                    <button
                      className="text-button danger-text"
                      onClick={() => remove.mutate(member.id)}
                    >
                      Retirer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
