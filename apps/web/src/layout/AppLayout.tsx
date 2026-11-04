import { Link, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';

/**
 * Renders the page frame: the TaskFlow header with the signed-in user and sign-out, and the current route.
 * @since REQ-007
 */
export function AppLayout() {
  const auth = useAuth();
  const navigate = useNavigate();

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>
            <Link to="/" className="brand">
              TaskFlow
            </Link>
          </h1>
          <p className="subtitle">Team task management</p>
        </div>
        {auth.user && (
          <div className="user">
            <span>
              {auth.user.name} <small>{auth.user.email}</small>
            </span>
            <button
              type="button"
              onClick={() => void auth.logout().then(() => navigate('/login', { replace: true }))}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
