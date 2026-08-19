import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ContentItemSummary, ContentPublicationSummary } from '@ai-content-os/contracts';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from '../src/api/client';
import { ContentReviewPanel } from '../src/pages/contents/content-review-panel';
import { ReviewCenterPage } from '../src/pages/contents/review-center';

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
  id: 'content-3b',
  workspaceId: 'workspace-3b',
  websiteId: 'website-3b',
  title: 'Guide relu',
  slug: 'guide-relu',
  excerpt: 'Résumé éditorial',
  htmlContent: '<h1>Guide</h1><p>Corps sûr.</p>',
  plainTextContent: 'Guide Corps sûr.',
  language: 'fr',
  labels: ['blogger'],
  wordCount: 3,
  estimatedReadingMinutes: 1,
  editorialStatus: 'READY_TO_PUBLISH',
  publicationStatus: 'NOT_PUBLISHED',
  version: 7,
  createdByUserId: 'author-1',
  assignedToUserId: 'writer-1',
  createdAt: '2026-08-19T10:00:00.000Z',
  updatedAt: '2026-08-19T11:00:00.000Z',
};

function renderPanel(value: ContentItemSummary = item) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ContentReviewPanel workspaceId="workspace-3b" websiteId="website-3b" item={value} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderCenter() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/espaces/workspace-3b/sites/website-3b/centre-revision']}>
        <Route path="/espaces/:workspaceId/sites/:websiteId/centre-revision">
          <ReviewCenterPage />
        </Route>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function publication(
  overrides: Partial<ContentPublicationSummary> = {},
): ContentPublicationSummary {
  return {
    contentItemId: item.id,
    provider: 'BLOGGER',
    connectionStatus: 'CONNECTED',
    externalDraftExists: false,
    currentRevisionNumber: item.version,
    synchronization: 'NOT_CONNECTED',
    publicPublishEnabled: false,
    deleteEnabled: false,
    ...overrides,
  };
}

describe('Centre de révision et handoff Blogger Phase 3B', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.can.mockReturnValue(true);
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.endsWith('/comments') || path.endsWith('/reviews')) return Promise.resolve([]);
      if (path.endsWith('/publication')) return Promise.resolve(publication());
      if (path.endsWith('/members') || path.endsWith('/content-profiles'))
        return Promise.resolve([]);
      if (path.includes('/review-center?')) {
        return Promise.resolve({
          data: [item],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          queueCounts: {
            TO_WRITE: 1,
            IN_REVIEW: 2,
            CHANGES_REQUESTED: 3,
            APPROVED: 4,
            READY_TO_PUBLISH: 5,
          },
        });
      }
      return Promise.resolve({});
    });
  });

  it('renders the five review queues, filters, and content navigation', async () => {
    renderCenter();
    expect(await screen.findByRole('heading', { name: 'Centre de révision' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /À rédiger/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /En relecture/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Modifications demandées/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Approuvés/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Prêts à publier/ })).toBeInTheDocument();
    expect(await screen.findByText('Guide relu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ouvrir le contenu' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Rechercher'), { target: { value: 'guide' } });
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith(expect.stringContaining('search=guide')),
    );
  });

  it('shows explicit empty and error states for the review center', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.endsWith('/members') || path.endsWith('/content-profiles'))
        return Promise.resolve([]);
      if (path.includes('/review-center?')) {
        return Promise.resolve({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          queueCounts: {
            TO_WRITE: 0,
            IN_REVIEW: 0,
            CHANGES_REQUESTED: 0,
            APPROVED: 0,
            READY_TO_PUBLISH: 0,
          },
        });
      }
      return Promise.resolve([]);
    });
    const rendered = renderCenter();
    expect(await screen.findByText('Aucun contenu dans cette file.')).toBeInTheDocument();
    rendered.unmount();
    mocks.apiRequest.mockImplementation((path: string) =>
      path.includes('/review-center?') ? Promise.reject(new Error('safe')) : Promise.resolve([]),
    );
    renderCenter();
    expect(
      await screen.findByText('Le Centre de révision est temporairement indisponible.'),
    ).toBeInTheDocument();
  });

  it('creates and resolves internal comments against the persisted API', async () => {
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/publication')) return Promise.resolve(publication());
      if (path.endsWith('/reviews')) return Promise.resolve([]);
      if (path.endsWith('/comments') && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({ message: 'Relire la conclusion.' });
        return Promise.resolve({
          id: 'comment-1',
          contentItemId: item.id,
          authorUserId: 'reviewer-1',
          message: 'Relire la conclusion.',
          status: 'OPEN',
          createdAt: item.updatedAt,
          updatedAt: item.updatedAt,
        });
      }
      if (path.includes('/comments/comment-1/resolve')) {
        return Promise.resolve({ status: 'RESOLVED' });
      }
      if (path.endsWith('/comments')) {
        return Promise.resolve([
          {
            id: 'comment-1',
            contentItemId: item.id,
            authorUserId: 'reviewer-1',
            authorDisplayName: 'Relecteur',
            message: 'Relire la conclusion.',
            status: 'OPEN',
            createdAt: item.updatedAt,
            updatedAt: item.updatedAt,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Ajouter un commentaire'), {
      target: { value: 'Relire la conclusion.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Commenter' }));
    expect(await screen.findByText('Commentaire ajouté.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Résoudre' }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/comments/comment-1/resolve'),
        { method: 'POST' },
      ),
    );
  });

  it('binds approve and request-changes controls to the loaded revision and permissions', async () => {
    const inReview = { ...item, editorialStatus: 'IN_REVIEW' as const, version: 8 };
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/comments') || (path.endsWith('/reviews') && !init))
        return Promise.resolve([]);
      if (path.endsWith('/publication')) return Promise.resolve(publication());
      if (path.endsWith('/reviews') && init?.method === 'POST') {
        const payload = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(payload.reviewedRevisionNumber).toBe(8);
        return Promise.resolve({
          id: 'review-1',
          contentItemId: item.id,
          reviewerUserId: 'reviewer-1',
          decision: payload.decision,
          reviewedRevisionNumber: 8,
          createdAt: item.updatedAt,
        });
      }
      return Promise.resolve([]);
    });
    renderPanel(inReview);
    expect(await screen.findByRole('button', { name: 'Approuver cette version' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Demander des modifications' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note de décision'), {
      target: { value: 'Ajouter une référence.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Demander des modifications' }));
    expect(await screen.findByText('Modifications demandées.')).toBeInTheDocument();
  });

  it('creates a Blogger draft explicitly and rehydrates the synchronized state', async () => {
    let state = publication();
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/comments') || path.endsWith('/reviews')) return Promise.resolve([]);
      if (path.endsWith('/publication/blogger/draft') && init?.method === 'POST') {
        const payload = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(payload.expectedRevision).toBe(7);
        expect(payload).not.toHaveProperty('externalPostId');
        state = publication({
          associationId: 'association-1',
          bindingStatus: 'ACTIVE',
          externalDraftExists: true,
          synchronizedRevisionNumber: 7,
          synchronization: 'SYNCHRONIZED',
        });
        return Promise.resolve(state);
      }
      if (path.endsWith('/publication')) return Promise.resolve(state);
      return Promise.resolve([]);
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Créer le brouillon Blogger' }));
    expect(await screen.findByText('Le brouillon Blogger est synchronisé.')).toBeInTheDocument();
    expect(await screen.findByText('À jour')).toBeInTheDocument();
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument();
  });

  it('shows out-of-sync state and updates the same server-resolved draft without an external ID', async () => {
    let state = publication({
      associationId: 'association-1',
      bindingStatus: 'ACTIVE',
      externalDraftExists: true,
      synchronizedRevisionNumber: 6,
      synchronization: 'OUT_OF_SYNC',
    });
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/comments') || path.endsWith('/reviews')) return Promise.resolve([]);
      if (path.endsWith('/publication/blogger/draft') && init?.method === 'PATCH') {
        const payload = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(payload).not.toHaveProperty('externalPostId');
        state = publication({
          associationId: 'association-1',
          bindingStatus: 'ACTIVE',
          externalDraftExists: true,
          synchronizedRevisionNumber: 7,
          synchronization: 'SYNCHRONIZED',
        });
        return Promise.resolve(state);
      }
      if (path.endsWith('/publication')) return Promise.resolve(state);
      return Promise.resolve([]);
    });
    renderPanel();
    expect(await screen.findByText('À mettre à jour')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour le brouillon Blogger' }));
    expect(await screen.findByText('Le brouillon Blogger est synchronisé.')).toBeInTheDocument();
  });

  it('rehydrates publication after refresh, hides unsafe actions, and never renders secrets', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.endsWith('/comments') || path.endsWith('/reviews')) return Promise.resolve([]);
      if (path.endsWith('/publication')) {
        return Promise.resolve({
          ...publication({
            associationId: 'association-1',
            bindingStatus: 'ACTIVE',
            externalDraftExists: true,
            synchronizedRevisionNumber: 7,
            synchronization: 'SYNCHRONIZED',
          }),
          accessToken: 'secret-token',
          encryptedCredentials: 'secret-ciphertext',
        });
      }
      return Promise.resolve([]);
    });
    mocks.can.mockImplementation((permission: string) =>
      ['contents.comments.read', 'contents.reviews.read', 'contents.publication.read'].includes(
        permission,
      ),
    );
    renderPanel();
    expect(await screen.findByText('À jour')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Créer le brouillon Blogger' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Mettre à jour le brouillon Blogger' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-ciphertext')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publier|Supprimer/ })).not.toBeInTheDocument();
  });
});
