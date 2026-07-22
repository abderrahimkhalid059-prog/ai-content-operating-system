import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionsPage } from '../src/pages/auth/sessions';
import type * as ApiClientModule from '../src/api/client';

vi.mock('../src/api/client', async (original) => {
  const actual = await original<typeof ApiClientModule>();
  return {
    ...actual,
    apiRequest: vi.fn(() =>
      Promise.resolve([
        {
          id: 's1',
          current: true,
          expiresAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ]),
    ),
  };
});

describe('Session management UI', () => {
  it('offers revocation for active sessions', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionsPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Session actuelle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Révoquer' })).toBeInTheDocument();
  });
});
