import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../src/auth/protected-route';

vi.mock('../src/auth/auth-context', () => ({
  useAuth: () => ({ user: undefined, loading: false, can: vi.fn() }),
}));

describe('Protected routes', () => {
  it('redirects unauthenticated users to the login page', () => {
    render(
      <MemoryRouter initialEntries={['/secret']}>
        <Routes>
          <Route
            path="/secret"
            element={
              <ProtectedRoute>
                <span>secret</span>
              </ProtectedRoute>
            }
          />
          <Route path="/connexion" element={<span>connexion cible</span>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('connexion cible')).toBeInTheDocument();
  });
});
