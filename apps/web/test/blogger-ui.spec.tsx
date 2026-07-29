import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BloggerIntegrationPage } from '../src/pages/integrations/blogger';
import { ApiClientError } from '../src/api/client';
import type * as ApiClientModule from '../src/api/client';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), can: vi.fn(() => true) }));
vi.mock('../src/auth/auth-context', () => ({
  useAuth: () => ({ can: mocks.can }),
}));
vi.mock('../src/api/client', async (original) => {
  const actual = await original<typeof ApiClientModule>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/espaces/w1/sites/s1/integrations/blogger']}>
        <Route path="/espaces/:workspaceId/sites/:websiteId/integrations/blogger">
          <BloggerIntegrationPage />
        </Route>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Administration Blogger', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    mocks.apiRequest.mockReset();
    mocks.can.mockReturnValue(true);
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/integrations/status') {
        return Promise.resolve({
          bloggerMode: 'MOCK',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.endsWith('/integrations/blogger/test-posts') && init?.method === 'POST') {
        return Promise.resolve({
          operationId: 'op1',
          idempotencyKey: 'key',
          status: 'COMPLETED',
          post: {
            id: 'p2',
            externalPostId: 'external-draft',
            externalBlogId: 'blog',
            title: 'Brouillon',
            status: 'DRAFT',
            labels: ['mock'],
            lastImportedAt: new Date().toISOString(),
          },
        });
      }
      if (path.endsWith('/integrations/blogger')) {
        return Promise.resolve({
          id: 'c1',
          workspaceId: 'w1',
          websiteId: 's1',
          provider: 'BLOGGER',
          mode: 'MOCK',
          status: 'CONNECTED',
          externalAccountId: 'mock-google-account-001',
          externalSiteId: 'mock-blog-sports-001',
          externalSiteName: 'Blog sportif Mock',
          externalSiteUrl: 'https://sports-mock.example.test',
          grantedScopes: ['mock:blogger'],
          publicPublishEnabled: false,
          deleteEnabled: false,
          createdAt: '',
          updatedAt: '',
        });
      }
      if (path.endsWith('/external-posts')) {
        return Promise.resolve([
          {
            id: 'p1',
            externalPostId: 'external-1',
            externalBlogId: 'blog',
            title: 'Billet arabe importé',
            status: 'PUBLISHED',
            labels: ['Sport'],
            lastImportedAt: new Date().toISOString(),
          },
        ]);
      }
      if (path.endsWith('/external-labels')) {
        return Promise.resolve([
          {
            id: 'l1',
            name: 'Sport',
            normalizedName: 'sport',
            usageCount: 2,
            lastSeenAt: new Date().toISOString(),
          },
        ]);
      }
      if (path.endsWith('/sync-runs')) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it('shows Mock connection, imported content, labels, and draft-first safety', async () => {
    renderPage();
    expect(await screen.findByText('Mode MOCK')).toBeInTheDocument();
    expect(screen.getByText(/Publication publique bloquée/)).toBeInTheDocument();
    expect(await screen.findByText('Billet arabe importé')).toBeInTheDocument();
    expect(await screen.findByText('Sport · 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Créer le brouillon' }));
    expect(await screen.findByRole('button', { name: 'Publier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Supprimer le test' })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/accessToken|refreshToken|encryptedCredentials/);
  });

  it('renders the Live mode warning state without exposing credentials', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/integrations/status') {
        return Promise.resolve({
          bloggerMode: 'LIVE',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.endsWith('/integrations/blogger')) {
        return Promise.resolve({
          id: 'c2',
          workspaceId: 'w1',
          websiteId: 's1',
          provider: 'BLOGGER',
          mode: 'LIVE',
          status: 'CONNECTED',
          externalSiteId: 'safe-blog-id',
          externalSiteName: 'Blog réel',
          grantedScopes: ['blogger'],
          publicPublishEnabled: false,
          deleteEnabled: false,
          createdAt: '',
          updatedAt: '',
        });
      }
      return Promise.resolve([]);
    });
    renderPage();
    expect(await screen.findByText('Mode LIVE')).toBeInTheDocument();
    expect(screen.getByText(/suppression bloquée/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('client-secret');
  });

  it('renders a blog returned by live discovery', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/integrations/status') {
        return Promise.resolve({
          bloggerMode: 'LIVE',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.endsWith('/integrations/blogger/sites')) {
        return Promise.resolve({
          items: [
            {
              id: '123456789',
              name: 'Test Blog',
              url: 'https://example.blogspot.com/',
            },
          ],
        });
      }
      if (path.endsWith('/integrations/blogger')) {
        return Promise.resolve({
          id: 'c-live',
          workspaceId: 'w1',
          websiteId: 's1',
          provider: 'BLOGGER',
          mode: 'LIVE',
          status: 'CONNECTED',
          externalAccountId: 'google-account',
          grantedScopes: ['https://www.googleapis.com/auth/blogger'],
          publicPublishEnabled: false,
          deleteEnabled: false,
          createdAt: '',
          updatedAt: '',
        });
      }
      return Promise.resolve([]);
    });

    renderPage();

    expect(await screen.findByText('Test Blog')).toBeInTheDocument();
    expect(screen.getByText('https://example.blogspot.com/')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnecter Blogger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Déconnecter' })).toBeInTheDocument();
  });

  it('keeps recovery controls visible when discovery requires reauthorization', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/integrations/status') {
        return Promise.resolve({
          bloggerMode: 'LIVE',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.endsWith('/integrations/blogger/sites')) {
        return Promise.reject(
          new ApiClientError('unsafe upstream detail', 401, {
            success: false,
            error: {
              code: 'BLOGGER_ACCOUNT_UNAUTHORIZED',
              message: 'unsafe upstream detail',
              details: [],
              requestId: 'safe-request-id',
            },
            timestamp: '2026-07-28T00:00:00.000Z',
            path: '/safe-path',
          }),
        );
      }
      if (path.endsWith('/integrations/blogger')) {
        return Promise.resolve({
          id: 'c-live',
          workspaceId: 'w1',
          websiteId: 's1',
          provider: 'BLOGGER',
          mode: 'LIVE',
          status: 'CONNECTED',
          grantedScopes: ['https://www.googleapis.com/auth/blogger'],
          publicPublishEnabled: false,
          deleteEnabled: false,
          createdAt: '',
          updatedAt: '',
        });
      }
      return Promise.resolve([]);
    });

    renderPage();

    expect(
      await screen.findByText(
        'L’autorisation Google a expiré ou n’est plus valide. Reconnectez le compte.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('AUTORISATION EXPIRÉE')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Reconnecter Blogger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Déconnecter' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('unsafe upstream detail');
    expect(document.body.textContent).not.toMatch(/accessToken|refreshToken|client-secret/);
  });

  it('renders expired recovery actions and invalidates queries before explicit reconnect', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/integrations/status') {
        return Promise.resolve({
          bloggerMode: 'LIVE',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.endsWith('/integrations/blogger/connect') && init?.method === 'POST') {
        return Promise.resolve({
          authorizationUrl: '#oauth',
          expiresAt: '2026-07-29T01:00:00.000Z',
        });
      }
      if (path.endsWith('/integrations/blogger')) {
        return Promise.resolve({
          id: 'c-expired',
          workspaceId: 'w1',
          websiteId: 's1',
          provider: 'BLOGGER',
          mode: 'LIVE',
          status: 'EXPIRED',
          externalAccountId: 'google-account',
          grantedScopes: ['https://www.googleapis.com/auth/blogger'],
          lastErrorCode: 'BLOGGER_ACCOUNT_UNAUTHORIZED',
          publicPublishEnabled: false,
          deleteEnabled: false,
          createdAt: '',
          updatedAt: '',
        });
      }
      return Promise.resolve([]);
    });

    renderPage(client);

    expect((await screen.findAllByText('AUTORISATION EXPIRÉE')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnecter Blogger' }));
    await waitFor(() => {
      const reconnectCall = mocks.apiRequest.mock.calls.find(
        ([path, init]) =>
          String(path).endsWith('/integrations/blogger/connect') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(reconnectCall).toBeTruthy();
      const reconnectBody = (reconnectCall?.[1] as RequestInit | undefined)?.body;
      expect(reconnectBody).toEqual(expect.any(String));
      expect(JSON.parse(reconnectBody as string)).toMatchObject({
        replaceExisting: true,
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['integration-status'],
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['blogger-integration', 'w1', 's1'],
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['blogger-sites', 'w1', 's1'],
      });
    });
    expect(document.body.textContent).not.toMatch(/accessToken|refreshToken|encryptedCredentials/);
  });

  it('disconnects locally and clears stale connection data without provider access', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    let disconnected = false;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/integrations/status') {
        return Promise.resolve({
          bloggerMode: 'LIVE',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.endsWith('/integrations/blogger') && init?.method === 'DELETE') {
        disconnected = true;
        return Promise.resolve(undefined);
      }
      if (path.endsWith('/integrations/blogger')) {
        if (disconnected) {
          return Promise.reject(new ApiClientError('Connexion Blogger introuvable.', 404));
        }
        return Promise.resolve({
          id: 'c-expired',
          workspaceId: 'w1',
          websiteId: 's1',
          provider: 'BLOGGER',
          mode: 'LIVE',
          status: 'EXPIRED',
          grantedScopes: [],
          publicPublishEnabled: false,
          deleteEnabled: false,
          createdAt: '',
          updatedAt: '',
        });
      }
      return Promise.resolve([]);
    });

    renderPage(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Déconnecter' }));

    expect(
      await screen.findByRole('button', { name: 'Démarrer la connexion' }),
    ).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['blogger-integration', 'w1', 's1'],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['blogger-sites', 'w1', 's1'],
    });
    expect(document.body.textContent).not.toMatch(/accessToken|refreshToken|encryptedCredentials/);
  });

  it('invalidates and refetches integration and discovery data after OAuth', async () => {
    window.history.replaceState({}, '', '/?blogger=connected');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const refetch = vi.spyOn(client, 'refetchQueries');
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/integrations/status') {
        return Promise.resolve({
          bloggerMode: 'LIVE',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.endsWith('/integrations/blogger/sites')) return Promise.resolve({ items: [] });
      if (path.endsWith('/integrations/blogger')) {
        return Promise.resolve({
          id: 'c-live',
          workspaceId: 'w1',
          websiteId: 's1',
          provider: 'BLOGGER',
          mode: 'LIVE',
          status: 'CONNECTED',
          grantedScopes: ['https://www.googleapis.com/auth/blogger'],
          publicPublishEnabled: false,
          deleteEnabled: false,
          createdAt: '',
          updatedAt: '',
        });
      }
      return Promise.resolve([]);
    });

    renderPage(client);

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['blogger-integration', 'w1', 's1'],
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['blogger-sites', 'w1', 's1'],
      });
      expect(refetch).toHaveBeenCalledWith({
        queryKey: ['blogger-integration', 'w1', 's1'],
      });
      expect(refetch).toHaveBeenCalledWith({
        queryKey: ['blogger-sites', 'w1', 's1'],
      });
    });
  });
});
