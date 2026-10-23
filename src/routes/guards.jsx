import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PageLoader } from '../components/ui/Feedback';
import SetupRequired from '../pages/SetupRequired';

export function ProtectedRoute() {
  const { configured, session, loading } = useAuth();
  const location = useLocation();
  if (!configured) return <SetupRequired />;
  if (loading) return <PageLoader label="Checking your session…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { session, loading, recovery } = useAuth();
  if (loading) return <PageLoader label="Loading…" />;
  if (session && !recovery) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
