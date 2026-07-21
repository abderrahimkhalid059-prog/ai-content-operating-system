import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatusPage } from '../src/pages/system-status';

describe('System status', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('displays API, PostgreSQL, and Redis health', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'ok',
              timestamp: new Date().toISOString(),
              services: { database: { status: 'up' }, redis: { status: 'up' } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SystemStatusPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getAllByText('Opérationnel')).toHaveLength(3);
  });
});
