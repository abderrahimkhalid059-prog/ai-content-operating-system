import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BloggerIntegrationPage } from '../src/pages/integrations/blogger';
import type * as ApiClientModule from '../src/api/client';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), can: vi.fn(() => true) }));
vi.mock('../src/auth/auth-context', () => ({
  useAuth: () => ({ can: mocks.can }),
}));
vi.mock('../src/api/client', async (original) => {
  const actual = await original<typeof ApiClientModule>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
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
});
