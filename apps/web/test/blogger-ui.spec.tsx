import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import type { CurrentBloggerTestPublication } from '@ai-content-os/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BloggerIntegrationPage } from '../src/pages/integrations/blogger';
import { ApiClientError } from '../src/api/client';
import type * as ApiClientModule from '../src/api/client';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  can: vi.fn<(permission: string, workspaceId?: string) => boolean>(() => true),
}));
type TestCurrentPublication = Omit<CurrentBloggerTestPublication, 'status'> & {
  status: CurrentBloggerTestPublication['status'] | 'draft';
};

let currentTestPublication: TestCurrentPublication | null;
let systemStatus: {
  bloggerMode: 'MOCK' | 'LIVE';
  publicPublishEnabled: boolean;
  deleteEnabled: boolean;
};
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
    currentTestPublication = null;
    systemStatus = {
      bloggerMode: 'MOCK',
      publicPublishEnabled: false,
      deleteEnabled: false,
    };
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/integrations/status') {
        return Promise.resolve(systemStatus);
      }
      if (
        path.endsWith('/integrations/blogger/test-publication/current') &&
        (init?.method ?? 'GET') === 'GET'
      ) {
        return Promise.resolve(currentTestPublication);
      }
      if (path.endsWith('/integrations/blogger/test-posts') && init?.method === 'POST') {
        expect(init.body).toEqual(expect.any(String));
        const body = JSON.parse(init.body as string) as {
          title: string;
          htmlContent: string;
          labels: string[];
        };
        currentTestPublication = {
          publicationId: 'op1',
          externalPostId: 'external-draft',
          title: body.title,
          htmlContent: body.htmlContent,
          labels: body.labels,
          status: 'DRAFT',
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:00:00.000Z',
        };
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
    expect(await screen.findByRole('button', { name: 'Mettre à jour' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer le brouillon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer le test' })).not.toBeInTheDocument();
    expect(screen.getByText('Brouillon créé avec succès.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/accessToken|refreshToken|encryptedCredentials/);
  });

  it('rehydrates the active draft after a fresh page render without creating another draft', async () => {
    currentTestPublication = {
      publicationId: 'publication-persisted',
      externalPostId: 'provider-draft-persisted',
      title: 'Titre Blogger mis à jour',
      htmlContent: '<p>HTML Blogger mis à jour</p>',
      labels: ['persisté', 'validation'],
      status: 'DRAFT',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    };

    renderPage();

    expect(await screen.findByDisplayValue('Titre Blogger mis à jour')).toBeInTheDocument();
    expect(screen.getByDisplayValue('<p>HTML Blogger mis à jour</p>')).toBeInTheDocument();
    expect(screen.getByDisplayValue('persisté, validation')).toBeInTheDocument();
    expect(screen.getByText('Brouillon de test récupéré.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer le brouillon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer le test' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publier' })).not.toBeInTheDocument();
    expect(
      mocks.apiRequest.mock.calls.filter(
        ([path, init]) =>
          String(path).endsWith('/integrations/blogger/test-posts') &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toHaveLength(0);
  });

  it('treats a lowercase recovered draft as active and shows delete only when enabled', async () => {
    systemStatus.deleteEnabled = true;
    currentTestPublication = {
      publicationId: 'publication-lowercase',
      externalPostId: 'provider-draft-lowercase',
      title: 'Brouillon lowercase récupéré',
      htmlContent: '<p>Contenu lowercase</p>',
      labels: ['lowercase'],
      status: 'draft',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    };

    renderPage();

    expect(await screen.findByDisplayValue('Brouillon lowercase récupéré')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer le test' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer le brouillon' })).not.toBeInTheDocument();
    expect(
      mocks.apiRequest.mock.calls.filter(
        ([path, init]) =>
          String(path).endsWith('/integrations/blogger/test-posts') &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/accessToken|refreshToken|encryptedCredentials/);
  });

  it('shows publish only when the server flag and user permission explicitly allow it', async () => {
    systemStatus.publicPublishEnabled = true;
    currentTestPublication = {
      publicationId: 'publication-publishable',
      externalPostId: 'provider-draft-publishable',
      title: 'Brouillon publiable récupéré',
      htmlContent: '<p>Contenu publiable</p>',
      labels: ['publication'],
      status: 'DRAFT',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    };

    renderPage();

    expect(await screen.findByDisplayValue('Brouillon publiable récupéré')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publier' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer le test' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer le brouillon' })).not.toBeInTheDocument();
  });

  it('keeps update visible but hides delete when the user lacks delete permission', async () => {
    systemStatus.deleteEnabled = true;
    mocks.can.mockImplementation(
      (permission: string) => permission !== 'providerPublishing.delete',
    );
    currentTestPublication = {
      publicationId: 'publication-permission',
      externalPostId: 'provider-draft-permission',
      title: 'Brouillon avec permission limitée',
      htmlContent: '<p>Contenu protégé</p>',
      labels: ['permission'],
      status: 'DRAFT',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    };

    renderPage();

    expect(
      await screen.findByDisplayValue('Brouillon avec permission limitée'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer le test' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer le brouillon' })).not.toBeInTheDocument();
  });

  it('updates and deletes only through the server-resolved current publication', async () => {
    currentTestPublication = {
      publicationId: 'publication-current',
      externalPostId: 'provider-draft-current',
      title: 'Brouillon récupéré',
      htmlContent: '<p>Contenu récupéré</p>',
      labels: ['récupéré'],
      status: 'DRAFT',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    };
    const fallback = mocks.apiRequest.getMockImplementation() as (
      path: string,
      init?: RequestInit,
    ) => Promise<unknown>;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/integrations/status') {
        return Promise.resolve({
          bloggerMode: 'MOCK',
          publicPublishEnabled: false,
          deleteEnabled: true,
        });
      }
      if (
        path.endsWith('/integrations/blogger/test-publication/current') &&
        init?.method === 'PATCH'
      ) {
        expect(init.body).toEqual(expect.any(String));
        const body = JSON.parse(init.body as string) as {
          title: string;
          htmlContent: string;
          labels: string[];
        };
        currentTestPublication = {
          ...currentTestPublication!,
          title: body.title,
          htmlContent: body.htmlContent,
          labels: body.labels,
          updatedAt: '2026-07-29T02:00:00.000Z',
        };
        return Promise.resolve({
          operationId: 'update-operation',
          idempotencyKey: 'update-key',
          status: 'COMPLETED',
        });
      }
      if (
        path.endsWith('/integrations/blogger/test-publication/current') &&
        init?.method === 'DELETE'
      ) {
        currentTestPublication = null;
        return Promise.resolve(undefined);
      }
      return fallback(path, init);
    });

    renderPage();
    const titleInput = await screen.findByDisplayValue('Brouillon récupéré');
    fireEvent.change(titleInput, { target: { value: 'Brouillon récupéré et modifié' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));

    expect(await screen.findByText('Brouillon mis à jour avec succès.')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Brouillon récupéré et modifié')).toBeInTheDocument();
    const updateCall = mocks.apiRequest.mock.calls.find(
      ([path, init]) =>
        String(path).endsWith('/integrations/blogger/test-publication/current') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(String(updateCall?.[0])).not.toContain('provider-draft-current');

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le test' }));
    expect(await screen.findByText('Brouillon de test supprimé avec succès.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Créer le brouillon' })).toBeInTheDocument();
    const deleteCall = mocks.apiRequest.mock.calls.find(
      ([path, init]) =>
        String(path).endsWith('/integrations/blogger/test-publication/current') &&
        (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(String(deleteCall?.[0])).not.toContain('provider-draft-current');
  });

  it('offers a clean create path after the API reconciles a provider-side deletion', async () => {
    const safeMessage =
      'Le brouillon de test n’existe plus dans Blogger. Son état local a été réconcilié.';
    const fallback = mocks.apiRequest.getMockImplementation() as (
      path: string,
      init?: RequestInit,
    ) => Promise<unknown>;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (
        path.endsWith('/integrations/blogger/test-publication/current') &&
        (init?.method ?? 'GET') === 'GET'
      ) {
        return Promise.reject(
          new ApiClientError(safeMessage, 410, {
            success: false,
            error: {
              code: 'BLOGGER_POST_NOT_FOUND',
              message: safeMessage,
              details: [],
              requestId: 'safe-request-id',
            },
            timestamp: '2026-07-29T00:00:00.000Z',
            path: '/safe-path',
          }),
        );
      }
      return fallback(path, init);
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(safeMessage);
    expect(screen.getByRole('button', { name: 'Créer le brouillon' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mettre à jour' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/token|secret|credential/i);
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
      if (path.endsWith('/integrations/blogger/test-publication/current')) {
        return Promise.resolve(null);
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
