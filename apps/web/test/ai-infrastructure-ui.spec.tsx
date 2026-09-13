import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiInfrastructurePage } from '../src/pages/ai/ai-infrastructure';
import type * as ApiClientModule from '../src/api/client';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
  can: vi.fn<(permission: string, workspaceId?: string) => boolean>(() => true),
}));

function bodyOf(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(init.body) as Record<string, unknown>;
}

vi.mock('../src/auth/auth-context', () => ({ useAuth: () => ({ can: mocks.can }) }));
vi.mock('../src/api/client', async (original) => {
  const actual = await original<typeof ApiClientModule>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

function renderPage(): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/espaces/w1/ia']}>
        <Route path="/espaces/:workspaceId/ia">
          <AiInfrastructurePage />
        </Route>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Administration de l’infrastructure IA', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.can.mockReturnValue(true);
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/providers')) {
        return Promise.resolve([
          {
            key: 'mock',
            displayName: 'Fournisseur déterministe (mock)',
            requiresCredentials: false,
          },
        ]);
      }
      if (path.endsWith('/configurations') && init?.method === 'PUT') {
        const body = bodyOf(init);
        return Promise.resolve({
          id: 'configuration-1',
          workspaceId: 'w1',
          scope: 'WORKSPACE',
          source: 'WORKSPACE',
          providerKey: body.providerKey,
          model: body.model,
          hasCredential: Boolean(body.credential),
          credentialHint: body.credential ? '••••7890' : undefined,
          timeoutMs: body.timeoutMs,
          maxRetries: body.maxRetries,
          isEnabled: true,
        });
      }
      if (path.endsWith('/configurations')) {
        return Promise.resolve([
          {
            id: 'configuration-1',
            workspaceId: 'w1',
            scope: 'WORKSPACE',
            source: 'WORKSPACE',
            providerKey: 'mock',
            model: 'mock-v1',
            hasCredential: true,
            credentialHint: '••••1234',
            timeoutMs: 10000,
            maxRetries: 2,
            isEnabled: true,
          },
        ]);
      }
      if (path.endsWith('/test') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, run: { id: 'run-2' } });
      }
      if (path.includes('/runs')) {
        return Promise.resolve([
          {
            id: 'run-1',
            workspaceId: 'w1',
            providerKey: 'mock',
            model: 'mock-v1',
            operation: 'CONFIGURATION_TEST',
            promptIdentifier: 'infrastructure.configuration-probe',
            promptVersion: 1,
            correlationId: 'safe-id',
            status: 'COMPLETED',
            startedAt: '2026-09-10T10:00:00.000Z',
            retryCount: 0,
            totalTokens: 19,
          },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it('shows masked configuration and usage without secrets or content actions', async () => {
    renderPage();
    expect(await screen.findByDisplayValue('mock-v1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••1234/)).toBeInTheDocument();
    expect(await screen.findByText('CONFIGURATION_TEST')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/api-key-secret|generate article/i);
  });

  it('replaces credentials only through a write-only password field', async () => {
    renderPage();
    const credential = await screen.findByLabelText('Nouvel identifiant fournisseur');
    expect(credential).toHaveAttribute('type', 'password');
    fireEvent.change(credential, { target: { value: 'new-provider-secret-7890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      const save = mocks.apiRequest.mock.calls.find(
        ([path, init]) => String(path).endsWith('/configurations') && init?.method === 'PUT',
      );
      expect(bodyOf(save?.[1])).toMatchObject({
        scope: 'WORKSPACE',
        credential: 'new-provider-secret-7890',
      });
    });
    expect(await screen.findByText('Configuration IA enregistrée.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('new-provider-secret-7890');
  });

  it('offers only the safe infrastructure test and respects update permission', async () => {
    mocks.can.mockImplementation((permission: string) => permission !== 'ai.config.update');
    renderPage();
    expect(
      await screen.findByRole('button', { name: 'Tester le fournisseur' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
    expect(screen.queryByText(/générer un article/i)).not.toBeInTheDocument();
  });
});
