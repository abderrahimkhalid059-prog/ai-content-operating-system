import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiClientError } from '../../api/client';
import { useAuth } from '../../auth/auth-context';

const schema = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
  password: z.string().min(1, 'Le mot de passe est requis.'),
});
type LoginForm = z.infer<typeof schema>;

export function LoginPage(): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string>();
  const form = useForm<LoginForm>({ resolver: zodResolver(schema) });
  if (!auth.loading && auth.user) return <Navigate to="/" replace />;

  const submit = form.handleSubmit(async (values) => {
    setError(undefined);
    try {
      await auth.login(values.email, values.password);
      const from = (location.state as { from?: unknown } | null)?.from;
      void navigate(typeof from === 'string' ? from : '/', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Connexion impossible.');
    }
  });

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand login-brand">
          <span className="brand-mark">AI</span>
          <span>Content OS</span>
        </div>
        <span className="eyebrow">Administration privée</span>
        <h1>Connexion</h1>
        <p>Accédez à vos espaces et sites avec votre compte administrateur.</p>
        <form onSubmit={(event) => void submit(event)} className="stack-form">
          <label>
            Adresse e-mail
            <input type="email" autoComplete="username" {...form.register('email')} />
          </label>
          {form.formState.errors.email && (
            <small className="field-error">{form.formState.errors.email.message}</small>
          )}
          <label>
            Mot de passe
            <input type="password" autoComplete="current-password" {...form.register('password')} />
          </label>
          {form.formState.errors.password && (
            <small className="field-error">{form.formState.errors.password.message}</small>
          )}
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button" disabled={form.formState.isSubmitting}>
            Se connecter
          </button>
        </form>
      </section>
    </main>
  );
}
