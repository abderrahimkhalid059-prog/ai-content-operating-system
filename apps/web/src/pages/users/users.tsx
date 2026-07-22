import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginationResponse,
  SafeUserSummary,
  TemporaryPasswordResponse,
} from '@ai-content-os/contracts';
import { useState } from 'react';
import { apiRequest, ApiClientError } from '../../api/client';
import { Loading } from '../../components/loading';

export function UsersPage(): React.JSX.Element {
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState<string>();
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiRequest<PaginationResponse<SafeUserSummary>>('/users?page=1&pageSize=100'),
  });
  const invalidate = () => client.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    mutationFn: () =>
      apiRequest<TemporaryPasswordResponse>('/users', {
        method: 'POST',
        body: JSON.stringify({ email, displayName }),
      }),
    onSuccess: (result) => {
      setTemporaryPassword(result.temporaryPassword);
      setEmail('');
      setDisplayName('');
      return invalidate();
    },
  });
  const action = useMutation({
    mutationFn: ({ id, operation }: { id: string; operation: 'deactivate' | 'reactivate' }) =>
      apiRequest<void>(`/users/${id}/${operation}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const reset = useMutation({
    mutationFn: (id: string) =>
      apiRequest<TemporaryPasswordResponse>(`/users/${id}/reset-password`, { method: 'POST' }),
    onSuccess: (result) => setTemporaryPassword(result.temporaryPassword),
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1>Utilisateurs</h1>
        </div>
      </div>
      <form
        className="inline-form panel"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
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
          Nom affiché
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <button className="primary-button">Créer</button>
        {create.isError && (
          <span className="field-error">
            {create.error instanceof ApiClientError ? create.error.message : 'Création impossible.'}
          </span>
        )}
      </form>
      {temporaryPassword && (
        <div className="notice warning" role="status">
          <strong>Mot de passe temporaire — affiché une seule fois</strong>
          <code>{temporaryPassword}</code>
          <button className="text-button" onClick={() => setTemporaryPassword(undefined)}>
            Masquer
          </button>
        </div>
      )}
      {users.isPending && <Loading />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>Statut</th>
              <th>Changement requis</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.data.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.displayName ?? user.email}</strong>
                  <small>{user.email}</small>
                </td>
                <td>{user.status}</td>
                <td>{user.mustChangePassword ? 'Oui' : 'Non'}</td>
                <td>
                  <div className="button-row">
                    <button className="text-button" onClick={() => reset.mutate(user.id)}>
                      Réinitialiser
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() =>
                        action.mutate({
                          id: user.id,
                          operation: user.status === 'ACTIVE' ? 'deactivate' : 'reactivate',
                        })
                      }
                    >
                      {user.status === 'ACTIVE' ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
