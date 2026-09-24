import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import Layout from '@/pages/_layout';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/sonner';
import ErrorBoundary from '@/components/system/error-boundary';

import HomePage from '@/pages/index';
import TimecardPage from '@/pages/timecard';
import ManagerDashboardPage from '@/pages/manager-dashboard';
import MechanicLogPage from '@/pages/mechanic-log';
import AdminPage from '@/pages/admin';
import NotFoundPage from '@/pages/not-found';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Toaster richColors />
        <Router>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="timecard" element={<TimecardPage />} />
              <Route path="mechanic-log" element={<MechanicLogPage />} />
              <Route path="manager" element={<ManagerDashboardPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Router>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
