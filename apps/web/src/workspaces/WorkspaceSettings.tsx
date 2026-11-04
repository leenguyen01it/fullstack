import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { hasWorkspacePermission, updateWorkspaceSchema, type Workspace } from '@taskflow/shared';
import { useWorkspaceMutations } from '../api/workspaces';

/**
 * Shows the rename and delete actions the user's role allows for a workspace; deleting asks for a
 * second click and returns to the home page.
 * @since REQ-003
 * @updated REQ-007
 */
export function WorkspaceSettings({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();
  const { rename, remove } = useWorkspaceMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canRename = hasWorkspacePermission(workspace.myRole, 'workspace:update');
  const canDelete = hasWorkspacePermission(workspace.myRole, 'workspace:delete');
  const mutationError = rename.error ?? remove.error;
  if (!canRename && !canDelete) return null;

  /**
   * Validates and submits the new workspace name.
   * @since REQ-003
   * @updated REQ-007
   */
  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = updateWorkspaceSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (parsed.success) rename.mutate({ id: workspace.id, ...parsed.data });
  }

  return (
    <section className="card">
      <h2>Settings</h2>
      {canRename && (
        <form className="row" onSubmit={handleRename} noValidate key={workspace.name}>
          <input name="name" defaultValue={workspace.name} aria-label="Rename workspace" />
          <button type="submit" disabled={rename.isPending}>
            Rename
          </button>
        </form>
      )}
      {mutationError && <p className="down">{mutationError.message}</p>}
      {canDelete && (
        <div className="row">
          {confirmDelete ? (
            <>
              <button
                type="button"
                className="danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(workspace.id, { onSuccess: () => navigate('/', { replace: true }) })
                }
              >
                Confirm delete
              </button>
              <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="secondary" onClick={() => setConfirmDelete(true)}>
              Delete workspace
            </button>
          )}
        </div>
      )}
    </section>
  );
}
