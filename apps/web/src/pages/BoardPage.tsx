import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { columnInputSchema, hasWorkspacePermission } from '@taskflow/shared';
import { useBoard, useBoardMutations } from '../api/boards';
import { ApiRequestError } from '../api/client';
import { useMembers, useWorkspace } from '../api/workspaces';
import { KanbanBoard } from '../board/KanbanBoard';
import { NotFoundPage } from './NotFoundPage';

/**
 * Shows a board as a Kanban with actions to add a column and, for managers, delete the board;
 * loaded as a separate chunk because it pulls in the drag-and-drop library.
 * @since REQ-007
 */
export default function BoardPage() {
  const { workspaceId = '', boardId = '' } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(workspaceId);
  const board = useBoard(workspaceId, boardId);
  const { data: members = [] } = useMembers(workspaceId);
  const { addColumn, remove } = useBoardMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);

  const notFound = [workspace.error, board.error].some(
    (err) => err instanceof ApiRequestError && err.status === 404,
  );
  if (notFound) return <NotFoundPage what="Board" />;
  if (workspace.isPending || board.isPending) return <p className="subtitle">Loading board…</p>;
  if (!workspace.data || !board.data) {
    return <p className="down">{(workspace.error ?? board.error)?.message}</p>;
  }
  const canManage = hasWorkspacePermission(workspace.data.myRole, 'board:update');
  const canDelete = hasWorkspacePermission(workspace.data.myRole, 'board:delete');

  /**
   * Validates the column name and appends the column.
   * @since REQ-007
   */
  function handleAddColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = columnInputSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    setError(null);
    addColumn.mutate(
      { boardId, name: parsed.data.name },
      { onSuccess: () => form.reset(), onError: (err) => setError(err.message) },
    );
  }

  return (
    <div className="board-page">
      <nav className="breadcrumb">
        <Link to="/">Workspaces</Link> / <Link to={`/w/${workspaceId}`}>{workspace.data.name}</Link>{' '}
        / <span>{board.data.name}</span>
      </nav>
      <div className="board-toolbar">
        <h2 className="page-title">{board.data.name}</h2>
        {canManage && (
          <form className="row" onSubmit={handleAddColumn} noValidate>
            <input name="name" placeholder="New column" aria-label="New column name" />
            <button type="submit" disabled={addColumn.isPending}>
              Add column
            </button>
          </form>
        )}
        {canDelete && (
          <button
            type="button"
            className="secondary"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(boardId, {
                onSuccess: () => navigate(`/w/${workspaceId}`, { replace: true }),
              })
            }
          >
            Delete board
          </button>
        )}
      </div>
      {error && <p className="down">{error}</p>}
      <KanbanBoard workspace={workspace.data} board={board.data} members={members} />
    </div>
  );
}
