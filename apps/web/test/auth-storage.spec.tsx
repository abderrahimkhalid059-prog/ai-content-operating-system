import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/auth/auth-context';

function Probe(): React.JSX.Element {
  const auth = useAuth();
  return <span>{auth.loading ? 'chargement' : auth.user?.email}</span>;
}

describe('Authentication storage', () => {
  it('keeps the access token out of localStorage', async () => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'memory-only-token',
              expiresIn: 900,
              user: {
                id: 'u1',
                email: 'owner@test.invalid',
                status: 'ACTIVE',
                mustChangePassword: false,
                createdAt: '',
                updatedAt: '',
                workspaces: [
                  { id: 'w1', name: 'Espace', slug: 'espace', role: 'OWNER', permissions: [] },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('owner@test.invalid')).toBeInTheDocument();
    expect(JSON.stringify(localStorage)).not.toContain('memory-only-token');
    expect(localStorage.getItem('ai-content-os:selected-workspace-id')).toBe('w1');
    vi.unstubAllGlobals();
  });
});
