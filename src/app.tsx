import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import Layout from '@/pages/_layout';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/sonner';
import ErrorBoundary from '@/components/system/error-boundary';

import HomePage from '@/pages/index';
import NotFoundPage from '@/pages/not-found';

// The kiosk, mechanic, manager, and admin screens are used by different people
// and pull in heavy dependencies (Excel export, speech), so each loads on demand
// instead of shipping in the initial bundle.
const TimecardPage = lazy(() => import('@/pages/timecard'));
const MechanicLogPage = lazy(() => import('@/pages/mechanic-log'));
const ManagerDashboardPage = lazy(() => import('@/pages/manager-dashboard'));
const AdminPage = lazy(() => import('@/pages/admin'));

function RouteFallback() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        Loading…
      </p>
    </main>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Toaster richColors />
        <Router>
          <Suspense fallback={<RouteFallback />}>
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
          </Suspense>
        </Router>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
