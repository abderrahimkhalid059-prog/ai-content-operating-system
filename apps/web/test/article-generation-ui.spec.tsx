import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AiGenerationCandidateSummary, ContentItemSummary } from '@ai-content-os/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../src/api/client';
import type * as ApiClientModule from '../src/api/client';
import { ArticleGenerationPanel } from '../src/pages/contents/article-generation-panel';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
  can: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('../src/api/client', async (original) => {
  const actual = await original<typeof ApiClientModule>();
  return { ...actual, apiRequest: mocks.apiRequest };
});
vi.mock('../src/auth/auth-context', () => ({ useAuth: () => ({ can: mocks.can }) }));

const item: ContentItemSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  websiteId: '33333333-3333-4333-8333-333333333333',
  contentProfileId: '44444444-4444-4444-8444-444444444444',
  title: 'Article existant',
  slug: 'article-existant',
  htmlContent: '<p>Version actuelle.</p>',
  plainTextContent: 'Version actuelle.',
  language: 'fr',
  labels: [],
  wordCount: 2,
  estimatedReadingMinutes: 1,
  editorialStatus: 'DRAFT',
  publicationStatus: 'NOT_PUBLISHED',
  version: 3,
  createdByUserId: '55555555-5555-4555-8555-555555555555',
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:00.000Z',
};

const candidate: AiGenerationCandidateSummary = {
  id: '66666666-6666-4666-8666-666666666666',
  workspaceId: item.workspaceId,
  websiteId: item.websiteId,
  contentItemId: item.id,
  contentProfileId: item.contentProfileId!,
  aiRunId: '77777777-7777-4777-8777-777777777777',
  status: 'READY',
  baseRevisionNumber: 3,
  draft: {
    title: 'Brouillon contrôlé',
    bodyHtml: '<script>secret()</script><p>Texte affiché comme texte.</p>',
    suggestedLabels: ['validation'],
    warnings: ['Relire les faits.'],
  },
  providerKey: 'mock',
  model: 'mock-v1',
  promptIdentifier: 'article.draft',
  promptVersion: 1,
  createdByUserId: item.createdByUserId,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
};

function renderPanel(onApplied = vi.fn(() => Promise.resolve())): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ArticleGenerationPanel
        workspaceId={item.workspaceId}
        websiteId={item.websiteId}
        item={item}
        contentProfileId={item.contentProfileId!}
        onApplied={onApplied}
      />
    </QueryClientProvider>,
  );
}

async function generatePreview(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Sujet'), { target: { value: 'Sujet contrôlé' } });
  fireEvent.click(screen.getByRole('button', { name: 'Générer un brouillon' }));
  expect(await screen.findByText('Brouillon contrôlé')).toBeInTheDocument();
}

describe('Génération d’article contrôlée Phase 4B', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.can.mockReturnValue(true);
    mocks.apiRequest.mockResolvedValue(candidate);
  });

  it('shows a durable-safe preview without updating content or creating a revision', async () => {
    renderPanel();
    await generatePreview();
    const generationCall = mocks.apiRequest.mock.calls[0];
    expect(generationCall?.[0]).toContain('/ai-generations');
    expect(generationCall?.[1]?.method).toBe('POST');
    if (typeof generationCall?.[1]?.body !== 'string') {
      throw new Error('The generation request must have a JSON body.');
    }
    expect(JSON.parse(generationCall[1].body)).toMatchObject({
      expectedVersion: 3,
      contentProfileId: item.contentProfileId,
      topic: 'Sujet contrôlé',
    });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(candidate.draft!.bodyHtml)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('provider-secret');
  });

  it('clears the unsaved preview and shows a distinct saved state after explicit Apply', async () => {
    const onApplied = vi.fn(() => Promise.resolve());
    mocks.apiRequest.mockImplementation((path) => {
      if (path.endsWith('/apply')) {
        return Promise.resolve({
          candidateId: candidate.id,
          contentItemId: item.id,
          status: 'APPLIED',
          revisionNumber: 4,
          aiRunId: candidate.aiRunId,
        });
      }
      return Promise.resolve(candidate);
    });
    renderPanel(onApplied);
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser ce brouillon' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    const applyCall = mocks.apiRequest.mock.calls.find(([path]) => path.endsWith('/apply'));
    expect(applyCall?.[0]).toBe(
      `/workspaces/${item.workspaceId}/websites/${item.websiteId}/contents/${item.id}/ai-generations/${candidate.id}/apply`,
    );
    expect(applyCall?.[1]).toEqual({ method: 'POST' });
    expect(
      await screen.findByText('Brouillon IA appliqué et enregistré comme version 4.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Aperçu IA non enregistré')).not.toBeInTheDocument();
    expect(screen.queryByText('Brouillon contrôlé')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Utiliser ce brouillon' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Générer un brouillon' })).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
  });

  it('discards the durable preview before offering an explicit regeneration', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path.endsWith('/discard')) return Promise.resolve({ ...candidate, status: 'DISCARDED' });
      return Promise.resolve(candidate);
    });
    renderPanel();
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: 'Régénérer' }));
    await waitFor(() => {
      expect(mocks.apiRequest.mock.calls.some(([path]) => path.endsWith('/discard'))).toBe(true);
    });
    expect(await screen.findByRole('button', { name: 'Générer un brouillon' })).toBeInTheDocument();
  });

  it('shows the normalized API error without rendering secrets', async () => {
    mocks.apiRequest.mockRejectedValue(
      new ApiClientError('L’opération du fournisseur IA a échoué.', 502, {
        success: false,
        error: {
          code: 'AI_PROVIDER_ERROR',
          message: 'L’opération du fournisseur IA a échoué.',
          details: [],
          requestId: 'safe-correlation',
        },
        timestamp: item.updatedAt,
        path: '/safe',
      }),
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText('Sujet'), { target: { value: 'Sujet contrôlé' } });
    fireEvent.click(screen.getByRole('button', { name: 'Générer un brouillon' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'L’opération du fournisseur IA a échoué.',
    );
    expect(document.body.textContent).not.toMatch(/token|credential|provider-secret/i);
  });

  it('hides all generation controls without generation permission', () => {
    mocks.can.mockReturnValue(false);
    renderPanel();
    expect(screen.queryByRole('heading', { name: 'Générer avec l’IA' })).not.toBeInTheDocument();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
