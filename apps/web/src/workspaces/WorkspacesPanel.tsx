import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { createWorkspaceSchema } from '@taskflow/shared';
import { useWorkspaceMutations, useWorkspaces } from '../api/workspaces';

/**
 * Lists the signed-in user's workspaces as links and lets them create one, opening it once created.
 * @since REQ-003
 * @updated REQ-007
 */
export function WorkspacesPanel() {
  const navigate = useNavigate();
  const { data: workspaces, isPending, error } = useWorkspaces();
  const { create } = useWorkspaceMutations();
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * Validates the new workspace name, creates it and navigates to it.
   * @since REQ-003
   * @updated REQ-007
   */
  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createWorkspaceSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    setFormError(null);
    create.mutate(parsed.data, {
      onSuccess: (workspace) => navigate(`/w/${workspace.id}`),
      onError: (err) => setFormError(err.message),
    });
  }

  return (
    <section className="card">
      <h2>Workspaces</h2>
      {isPending && <p className="subtitle">Loading…</p>}
      {error && <p className="down">{error.message}</p>}
      {workspaces?.length === 0 && <p className="subtitle">No workspaces yet.</p>}
      <ul className="list">
        {workspaces?.map((workspace) => (
          <li key={workspace.id}>
            <Link className="item" to={`/w/${workspace.id}`}>
              <span>{workspace.name}</span>
              <small>
                {workspace.myRole} · {workspace.memberCount} member
                {workspace.memberCount === 1 ? '' : 's'}
              </small>
            </Link>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={handleCreate} noValidate>
        <input name="name" placeholder="New workspace name" aria-label="Workspace name" />
        <button type="submit" disabled={create.isPending}>
          Create
        </button>
      </form>
      {formError && <p className="down">{formError}</p>}
    </section>
  );
}
