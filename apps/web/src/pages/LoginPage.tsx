import { Navigate, useLocation } from 'react-router';
import { AuthForm } from '../auth/AuthForm';
import { useAuth } from '../auth/AuthProvider';

/**
 * Shows the sign-in form, and once signed in returns to the page that required authentication.
 * @since REQ-007
 */
export function LoginPage() {
  const { user, isRestoring } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;

  if (isRestoring) return <p className="subtitle">Restoring session…</p>;
  if (user) return <Navigate to={from ? `${from.pathname}${from.search ?? ''}` : '/'} replace />;
  return <AuthForm />;
}
