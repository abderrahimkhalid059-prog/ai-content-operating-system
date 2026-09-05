import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ContentItemSummary } from '@ai-content-os/contracts';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../src/api/client';
import type * as ApiClientModule from '../src/api/client';
import {
  ContentEditorPage,
  ContentListPage,
  ContentRevisionsPage,
} from '../src/pages/contents/content-ui';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  can: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('../src/api/client', async (original) => {
  const actual = await original<typeof ApiClientModule>();
  return { ...actual, apiRequest: mocks.apiRequest };
});
vi.mock('../src/auth/auth-context', () => ({ useAuth: () => ({ can: mocks.can }) }));

const item: ContentItemSummary = {
  id: 'c1',
  workspaceId: 'w1',
  websiteId: 's1',
  title: 'Guide éditorial',
  slug: 'guide-editorial',
  excerpt: 'Résumé',
  htmlContent: '<p>Contenu sûr et durable.</p>',
  plainTextContent: 'Contenu sûr et durable.',
  language: 'fr',
  locale: 'fr-FR',
  labels: ['seo'],
  wordCount: 4,
  estimatedReadingMinutes: 1,
  editorialStatus: 'DRAFT',
  publicationStatus: 'NOT_PUBLISHED',
  version: 2,
  createdByUserId: 'u1',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T01:00:00.000Z',
};

function renderAt(element: React.ReactNode, path: string, route: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Route path={route}>{element}</Route>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Interface de contenu Phase 3A', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.can.mockReturnValue(true);
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.endsWith('/comments') || path.endsWith('/reviews')) return Promise.resolve([]);
      if (path.endsWith('/publication')) {
        return Promise.resolve({
          contentItemId: 'c1',
          provider: 'BLOGGER',
          connectionStatus: 'CONNECTED',
          externalDraftExists: false,
          currentRevisionNumber: 2,
          synchronization: 'NOT_CONNECTED',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.includes('/content-profiles')) return Promise.resolve([]);
      if (path.endsWith('/members')) return Promise.resolve([]);
      if (path.endsWith('/websites/s1')) {
        return Promise.resolve({
          id: 's1',
          workspaceId: 'w1',
          name: 'Tech Deutschland',
          slug: 'tech-deutschland',
          platform: 'OTHER',
          language: 'de',
          locale: 'de-DE',
          timezone: 'Europe/Berlin',
          status: 'ACTIVE',
          createdAt: '',
          updatedAt: '',
        });
      }
      if (path.endsWith('/revisions')) {
        return Promise.resolve([
          {
            id: 'r2',
            contentItemId: 'c1',
            revisionNumber: 2,
            title: item.title,
            slug: item.slug,
            htmlContent: item.htmlContent,
            plainTextContent: item.plainTextContent,
            language: 'fr',
            labels: ['seo'],
            wordCount: 4,
            estimatedReadingMinutes: 1,
            editorialStatus: 'DRAFT',
            publicationStatus: 'NOT_PUBLISHED',
            changedByUserId: 'u1',
            changeReason: 'Correction manuelle',
            changedAt: item.updatedAt,
          },
        ]);
      }
      if (path.includes('?')) {
        return Promise.resolve({
          data: [item],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }
      if (path.endsWith('/c1')) return Promise.resolve(item);
      return Promise.resolve({});
    });
  });

  it('renders the searchable list with separate statuses and metrics', async () => {
    renderAt(
      <ContentListPage />,
      '/espaces/w1/sites/s1/contenus',
      '/espaces/:workspaceId/sites/:websiteId/contenus',
    );
    expect(await screen.findByText('Guide éditorial')).toBeInTheDocument();
    expect(screen.getAllByText('Brouillon')).toHaveLength(2);
    expect(screen.getAllByText('Non publié')).toHaveLength(2);
    expect(screen.getByText('4 mots · 1 min')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Rechercher un contenu'), {
      target: { value: 'guide' },
    });
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith(expect.stringContaining('search=guide')),
    );
  });

  it('hydrates the editor, exposes revision navigation, and computes local metrics', async () => {
    renderAt(
      <ContentEditorPage />,
      '/espaces/w1/sites/s1/contenus/c1',
      '/espaces/:workspaceId/sites/:websiteId/contenus/:contentId',
    );
    expect(await screen.findByDisplayValue('Guide éditorial')).toBeInTheDocument();
    expect(screen.getAllByText('Version 2')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Historique des versions' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Contenu HTML'), {
      target: { value: '<p>Un deux trois quatre cinq.</p>' },
    });
    expect(screen.getByText(/Estimation locale : 5 mots/)).toBeInTheDocument();
  });

  it('uses the selected website localization for a new content item', async () => {
    renderAt(
      <ContentEditorPage />,
      '/espaces/w1/sites/s1/contenus/nouveau',
      '/espaces/:workspaceId/sites/:websiteId/contenus/nouveau',
    );
    await waitFor(() => expect(screen.getByLabelText('Langue')).toHaveValue('de'));
    expect(screen.getByLabelText('Locale')).toHaveValue('de-DE');
  });

  it('sends expectedVersion and displays a safe stale-update recovery', async () => {
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/comments') || path.endsWith('/reviews')) return Promise.resolve([]);
      if (path.endsWith('/publication')) {
        return Promise.resolve({
          contentItemId: 'c1',
          provider: 'BLOGGER',
          connectionStatus: 'CONNECTED',
          externalDraftExists: false,
          currentRevisionNumber: 2,
          synchronization: 'NOT_CONNECTED',
          publicPublishEnabled: false,
          deleteEnabled: false,
        });
      }
      if (path.includes('/content-profiles') || path.endsWith('/members'))
        return Promise.resolve([]);
      if (path.endsWith('/c1') && init?.method === 'PATCH') {
        expect(JSON.parse(init.body as string)).toMatchObject({ expectedVersion: 2 });
        return Promise.reject(
          new ApiClientError('Le contenu a changé. Rechargez-le.', 409, {
            success: false,
            error: {
              code: 'CONTENT_STALE_UPDATE',
              message: 'Le contenu a changé. Rechargez-le.',
              details: [],
              requestId: 'safe-id',
            },
            timestamp: item.updatedAt,
            path: '/safe',
          }),
        );
      }
      if (path.endsWith('/c1')) return Promise.resolve(item);
      return Promise.resolve([]);
    });
    renderAt(
      <ContentEditorPage />,
      '/espaces/w1/sites/s1/contenus/c1',
      '/espaces/:workspaceId/sites/:websiteId/contenus/:contentId',
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enregistrer une nouvelle version' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Le contenu a changé. Rechargez-le.',
    );
    expect(
      screen.getByRole('button', { name: 'Recharger la version actuelle' }),
    ).toBeInTheDocument();
  });

  it('renders immutable revision snapshots without interpreting stored HTML', async () => {
    renderAt(
      <ContentRevisionsPage />,
      '/espaces/w1/sites/s1/contenus/c1/versions',
      '/espaces/:workspaceId/sites/:websiteId/contenus/:contentId/versions',
    );
    fireEvent.click(await screen.findByRole('button', { name: /Version 2/ }));
    expect(screen.getByText('Instantané immuable')).toBeInTheDocument();
    expect(screen.getByText('<p>Contenu sûr et durable.</p>')).toBeInTheDocument();
    expect(document.querySelector('.revision-preview script')).toBeNull();
  });

  it('hides mutations when only read access is granted', async () => {
    mocks.can.mockImplementation((permission: string) =>
      ['contents.read', 'contents.revisions.read'].includes(permission),
    );
    renderAt(
      <ContentEditorPage />,
      '/espaces/w1/sites/s1/contenus/c1',
      '/espaces/:workspaceId/sites/:websiteId/contenus/:contentId',
    );
    expect(await screen.findByDisplayValue('Guide éditorial')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Enregistrer une nouvelle version' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archiver' })).not.toBeInTheDocument();
  });
});
