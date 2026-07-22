import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../src/components/app-layout';
import { DashboardPage } from '../src/pages/dashboard';

vi.mock('../src/auth/auth-context', () => ({
  useAuth: () => ({
    user: {
      email: 'owner@test.invalid',
      displayName: 'Owner',
      workspaces: [{ id: 'w1', name: 'Espace', permissions: ['users.read'] }],
    },
    selectedWorkspaceId: 'w1',
    selectWorkspace: vi.fn(),
    logout: vi.fn(),
  }),
}));

describe('Application shell', () => {
  it('renders permission-aware French navigation and the Phase 1 dashboard', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('navigation', { name: /principale/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Bienvenue/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Utilisateurs' })).toBeInTheDocument();
  });
});
