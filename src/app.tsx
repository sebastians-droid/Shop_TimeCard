import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import Layout from '@/pages/_layout';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/sonner';
import ErrorBoundary from '@/components/system/error-boundary';

import HomePage from '@/pages/index';
import ManagerDashboardPage from '@/pages/manager-dashboard';
import NotFoundPage from '@/pages/not-found';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Toaster richColors />
        <Router>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route path="manager" element={<ManagerDashboardPage />} />
              <Route index element={<HomePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Router>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
