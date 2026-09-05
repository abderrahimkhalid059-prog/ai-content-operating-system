import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MembersPage } from '../src/pages/workspaces/members';
import { ContentProfilesPage } from '../src/pages/content-profiles/content-profiles';
import { WebsiteFormPage } from '../src/pages/websites/website-form';
import type * as ApiClientModule from '../src/api/client';

vi.mock('../src/auth/auth-context', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../src/api/client', async (original) => {
  const actual = await original<typeof ApiClientModule>();
  return {
    ...actual,
    apiRequest: vi.fn((path: string, init?: RequestInit) => {
      if (path.includes('/members')) {
        return Promise.resolve([
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
        ]);
      }
      if (path.endsWith('/websites/s1')) {
        return Promise.resolve({
          id: 's1',
          workspaceId: 'w1',
          name: 'Technologie Allemagne',
          slug: 'technologie-allemagne',
          platform: 'OTHER',
          language: 'de',
          locale: 'de-DE',
          timezone: 'Europe/Berlin',
          status: 'ACTIVE',
          createdAt: '',
          updatedAt: '',
        });
      }
      if (path.endsWith('/content-profiles') && init?.method === 'POST') {
        return Promise.resolve({});
      }
      return Promise.resolve([]);
    }),
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
    expect(screen.getByLabelText('Langue')).toHaveValue(
      (navigator.language.split('-')[0] || 'en').toLowerCase(),
    );
    expect(screen.getByLabelText('Fuseau horaire')).toHaveValue(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    );
  });

  it('creates an editorial profile with site-derived, customer-editable localization', async () => {
    const { apiRequest } = await import('../src/api/client');
    wrapper(
      <ContentProfilesPage />,
      '/espaces/w1/sites/s1/profils-editoriaux',
      '/espaces/:workspaceId/sites/:websiteId/profils-editoriaux',
    );
    await waitFor(() => expect(screen.getByLabelText('Langue')).toHaveValue('de'));
    expect(screen.getByLabelText('Locale')).toHaveValue('de-DE');
    expect(screen.getByLabelText('Pays (ISO 3166-1 alpha-2)')).toHaveValue('DE');
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Finance UK' } });
    fireEvent.change(screen.getByLabelText('Ton'), { target: { value: 'Analytique' } });
    fireEvent.change(screen.getByLabelText('Langue'), { target: { value: 'en' } });
    fireEvent.change(screen.getByLabelText('Locale'), { target: { value: 'en-GB' } });
    fireEvent.change(screen.getByLabelText('Pays (ISO 3166-1 alpha-2)'), {
      target: { value: 'gb' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/workspaces/w1/websites/s1/content-profiles',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const createCall = vi
      .mocked(apiRequest)
      .mock.calls.find(
        ([path, init]) => path.endsWith('/content-profiles') && init?.method === 'POST',
      );
    const requestBody = createCall?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    const payload: unknown = JSON.parse(requestBody as string);
    expect(payload).toMatchObject({ language: 'en', locale: 'en-GB', countryCode: 'GB' });
  });
});
