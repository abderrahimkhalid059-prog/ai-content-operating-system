import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppLayout } from '../src/components/app-layout';
import { DashboardPage } from '../src/pages/dashboard';

describe('Application shell', () => {
  it('renders the French navigation and dashboard placeholder', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('navigation', { name: /principale/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument();
  });
});
