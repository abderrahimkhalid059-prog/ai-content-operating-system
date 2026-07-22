import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../src/pages/auth/login';

vi.mock('../src/auth/auth-context', () => ({
  useAuth: () => ({ user: undefined, loading: false, login: vi.fn() }),
}));

describe('Login screen', () => {
  it('renders accessible credential fields without public registration', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse e-mail')).toBeInTheDocument();
    expect(screen.queryByText(/inscription/i)).not.toBeInTheDocument();
  });
});
