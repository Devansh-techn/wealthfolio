import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppDataProvider } from './contexts/DataContext';
import { CurrencyProvider } from './contexts/CurrencyContext';
import { ToastProvider } from './contexts/ToastContext';
import { ProtectedRoute, PublicOnlyRoute } from './routes/guards';
import ErrorBoundary from './components/ErrorBoundary';
import { PageLoader } from './components/ui/Feedback';
import Landing from './pages/Landing';
import NotFound from './pages/NotFound';
import { LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage, AuthCallbackPage } from './pages/AuthPages';
import Legal from './pages/Legal';

const AppLayout = lazy(() => import('./layouts/AppLayout'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Assets = lazy(() => import('./pages/Assets'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Screener = lazy(() => import('./pages/Screener'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Goals = lazy(() => import('./pages/Goals'));
const Budget = lazy(() => import('./pages/Budget'));
const Loans = lazy(() => import('./pages/Loans'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));

function Providers({ children }) {
  const { user } = useAuth();
  // Keyed by user id: all cached financial data is discarded the moment the user changes or signs out.
  return (
    <AppDataProvider key={user?.id ?? 'anon'} user={user}>
      <CurrencyProvider>{children}</CurrencyProvider>
    </AppDataProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Providers>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route element={<PublicOnlyRoute />}>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/signup" element={<SignupPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  </Route>
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/auth/callback" element={<AuthCallbackPage />} />
                  <Route path="/disclaimer" element={<Legal page="disclaimer" />} />
                  <Route path="/privacy" element={<Legal page="privacy" />} />
                  <Route path="/terms" element={<Legal page="terms" />} />

                  <Route element={<ProtectedRoute />}>
                    <Route element={<AppLayout />}>
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/portfolio" element={<Portfolio />} />
                      <Route path="/assets" element={<Assets />} />
                      <Route path="/transactions" element={<Transactions />} />
                      <Route path="/screener" element={<Screener />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/goals" element={<Goals />} />
                      <Route path="/budget" element={<Budget />} />
                      <Route path="/loans" element={<Loans />} />
                      <Route path="/watchlist" element={<Watchlist />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/profile" element={<Profile />} />
                    </Route>
                  </Route>
                  <Route path="/home" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Providers>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
