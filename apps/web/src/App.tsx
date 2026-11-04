import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router';
import { AppLayout } from './layout/AppLayout';
import { RequireAuth } from './layout/RequireAuth';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { WorkspacePage } from './pages/WorkspacePage';

/**
 * Loads the board page as a separate chunk the first time a board is opened.
 * @since REQ-007
 */
const BoardPage = lazy(() => import('./pages/BoardPage'));

/**
 * Declares the app routes: the public login page, and behind authentication the workspace list,
 * a workspace, a board (code-split) and the invitation acceptance page.
 * @since REQ-001
 * @updated REQ-002
 * @updated REQ-003
 * @updated REQ-007
 */
export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route index element={<HomePage />} />
          <Route path="/w/:workspaceId" element={<WorkspacePage />} />
          <Route
            path="/w/:workspaceId/b/:boardId"
            element={
              <Suspense fallback={<p className="subtitle">Loading board…</p>}>
                <BoardPage />
              </Suspense>
            }
          />
          <Route path="/invitations/:token" element={<AcceptInvitationPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
