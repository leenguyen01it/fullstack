import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';

/**
 * Renders child routes only for a signed-in user: waits while the session is being restored, and
 * otherwise redirects to /login remembering the page to return to.
 * @since REQ-007
 */
export function RequireAuth() {
  const { user, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) return <p className="subtitle">Restoring session…</p>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}
