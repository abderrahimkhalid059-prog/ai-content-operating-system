import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiRequest, ApiClientError } from '../../api/client';
import { useAuth } from '../../auth/auth-context';

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(12, '12 caractères minimum.')
      .regex(/[A-Za-zÀ-ÿ]/, 'Ajoutez une lettre.')
      .regex(/\d/, 'Ajoutez un chiffre.'),
    confirmation: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    path: ['confirmation'],
    message: 'Les mots de passe diffèrent.',
  });
type PasswordForm = z.infer<typeof schema>;

export function ProfilePage(): React.JSX.Element {
  const auth = useAuth();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const form = useForm<PasswordForm>({ resolver: zodResolver(schema) });
  const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(undefined);
    try {
      await apiRequest<void>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await auth.reload();
      form.reset();
      setMessage('Mot de passe modifié. Les autres sessions ont été révoquées.');
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Modification impossible.');
    }
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Compte</span>
          <h1>Mon profil</h1>
        </div>
      </div>
      {auth.user?.mustChangePassword && (
        <div className="notice warning" role="alert">
          Vous devez choisir un nouveau mot de passe avant de continuer.
        </div>
      )}
      <div className="two-column">
        <article className="panel">
          <h2>Identité</h2>
          <dl className="details-list">
            <dt>Nom</dt>
            <dd>{auth.user?.displayName ?? '—'}</dd>
            <dt>E-mail</dt>
            <dd>{auth.user?.email}</dd>
            <dt>Statut</dt>
            <dd>{auth.user?.status}</dd>
          </dl>
        </article>
        <article className="panel">
          <h2>Modifier le mot de passe</h2>
          <form className="stack-form" onSubmit={(event) => void submit(event)}>
            <label>
              Mot de passe actuel
              <input
                type="password"
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
            </label>
            <label>
              Nouveau mot de passe
              <input
                type="password"
                autoComplete="new-password"
                {...form.register('newPassword')}
              />
            </label>
            <label>
              Confirmation
              <input
                type="password"
                autoComplete="new-password"
                {...form.register('confirmation')}
              />
            </label>
            {Object.values(form.formState.errors)[0]?.message && (
              <small className="field-error">
                {Object.values(form.formState.errors)[0]?.message}
              </small>
            )}
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            {message && <div className="notice success">{message}</div>}
            <button className="primary-button" disabled={form.formState.isSubmitting}>
              Enregistrer
            </button>
          </form>
        </article>
      </div>
    </section>
  );
}
