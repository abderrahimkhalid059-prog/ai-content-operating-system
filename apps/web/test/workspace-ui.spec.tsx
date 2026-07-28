import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MembersPage } from '../src/pages/workspaces/members';
import { WebsiteFormPage } from '../src/pages/websites/website-form';
import type * as ApiClientModule from '../src/api/client';

vi.mock('../src/auth/auth-context', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../src/api/client', async (original) => {
  const actual = await original<typeof ApiClientModule>();
  return {
    ...actual,
    apiRequest: vi.fn((path: string) =>
      path.includes('/members')
        ? Promise.resolve([
            {
              id: 'm1',
              role: 'EDITOR',
              createdAt: '',
              updatedAt: '',
              user: {
                id: 'u1',
                email: 'editor@test.invalid',
                status: 'ACTIVE',
                mustChangePassword: false,
                createdAt: '',
                updatedAt: '',
              },
            },
          ])
        : Promise.resolve([]),
    ),
  };
});

const wrapper = (element: React.ReactNode, path: string, route: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Route path={route}>{element}</Route>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Workspace administration UI', () => {
  it('shows member role controls when permission is granted', async () => {
    wrapper(<MembersPage />, '/espaces/w1/membres', '/espaces/:workspaceId/membres');
    expect(await screen.findByLabelText('Rôle de editor@test.invalid')).toBeInTheDocument();
  });

  it('renders the validated website form', () => {
    wrapper(
      <WebsiteFormPage />,
      '/espaces/w1/sites/nouveau',
      '/espaces/:workspaceId/sites/nouveau',
    );
    expect(screen.getByRole('heading', { name: 'Nouveau site' })).toBeInTheDocument();
    expect(screen.getByLabelText('Fuseau horaire')).toHaveValue('Africa/Casablanca');
  });
});
