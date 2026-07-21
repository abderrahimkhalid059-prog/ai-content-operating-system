import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/app-layout';
import { ErrorBoundary } from './components/error-boundary';
import { DashboardPage } from './pages/dashboard';
import { NotFoundPage } from './pages/not-found';
import { SystemStatusPage } from './pages/system-status';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });

export function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="systeme" element={<SystemStatusPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
