import { Link, useNavigate, useParams } from 'react-router';
import { hasWorkspacePermission } from '@taskflow/shared';
import { ApiRequestError } from '../api/client';
import { useMembers, useWorkspace } from '../api/workspaces';
import { BoardsList } from '../boards/BoardsList';
import { TaskSearch } from '../tasks/TaskSearch';
import { InvitationsPanel } from '../workspaces/InvitationsPanel';
import { MembersPanel } from '../workspaces/MembersPanel';
import { WorkspaceSettings } from '../workspaces/WorkspaceSettings';
import { NotFoundPage } from './NotFoundPage';

/**
 * Shows one workspace: its boards, task search, members, invitations and settings.
 * @since REQ-007
 */
export function WorkspacePage() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const { data: workspace, isPending, error } = useWorkspace(workspaceId);
  const { data: members = [] } = useMembers(workspaceId);

  if (isPending) return <p className="subtitle">Loading workspace…</p>;
  if (error instanceof ApiRequestError && error.status === 404)
    return <NotFoundPage what="Workspace" />;
  if (error || !workspace) return <p className="down">{error?.message}</p>;

  return (
    <div key={workspace.id}>
      <nav className="breadcrumb">
        <Link to="/">Workspaces</Link> / <span>{workspace.name}</span>
      </nav>
      <h2 className="page-title">
        {workspace.name} <small className="subtitle">you are {workspace.myRole}</small>
      </h2>
      <BoardsList workspace={workspace} />
      <TaskSearch workspace={workspace} members={members} />
      <section className="card">
        <h2>People</h2>
        <MembersPanel workspace={workspace} onLeft={() => navigate('/', { replace: true })} />
        {hasWorkspacePermission(workspace.myRole, 'member:add') && (
          <InvitationsPanel workspace={workspace} />
        )}
      </section>
      <WorkspaceSettings workspace={workspace} />
    </div>
  );
}
