import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Switch } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../src/auth/protected-route';

vi.mock('../src/auth/auth-context', () => ({
  useAuth: () => ({ user: undefined, loading: false, can: vi.fn() }),
}));

describe('Protected routes', () => {
  it('redirects unauthenticated users to the login page', () => {
    render(
      <MemoryRouter initialEntries={['/secret']}>
        <Switch>
          <Route path="/secret">
            <ProtectedRoute>
              <span>secret</span>
            </ProtectedRoute>
          </Route>
          <Route path="/connexion">
            <span>connexion cible</span>
          </Route>
        </Switch>
      </MemoryRouter>,
    );
    expect(screen.getByText('connexion cible')).toBeInTheDocument();
  });
});
