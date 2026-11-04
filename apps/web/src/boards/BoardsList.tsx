import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { boardInputSchema, hasWorkspacePermission, type Workspace } from '@taskflow/shared';
import { useBoardMutations, useBoards } from '../api/boards';

const PAGE_SIZE = 10;

/**
 * Lists a workspace's boards with page numbers kept in the URL (?page=), and lets managers create one.
 * @since REQ-007
 */
export function BoardsList({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const { data, isPending, isPlaceholderData, error } = useBoards(workspace.id, page, PAGE_SIZE);
  const { create } = useBoardMutations(workspace.id);
  const [formError, setFormError] = useState<string | null>(null);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  /**
   * Validates the name, creates the board and opens it.
   * @since REQ-007
   */
  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = boardInputSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    setFormError(null);
    create.mutate(parsed.data.name, {
      onSuccess: (board) => navigate(`/w/${workspace.id}/b/${board.id}`),
      onError: (err) => setFormError(err.message),
    });
  }

  return (
    <section className="card">
      <h2>Boards</h2>
      {isPending && <p className="subtitle">Loading…</p>}
      {error && <p className="down">{error.message}</p>}
      {data?.total === 0 && <p className="subtitle">No boards yet.</p>}
      <ul className="list" style={{ opacity: isPlaceholderData ? 0.6 : 1 }}>
        {data?.items.map((board) => (
          <li key={board.id}>
            <Link className="item" to={`/w/${workspace.id}/b/${board.id}`}>
              <span>{board.name}</span>
              <small>{new Date(board.createdAt).toLocaleDateString()}</small>
            </Link>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="row pager" aria-label="Board pages">
          <button
            type="button"
            className="secondary"
            disabled={page <= 1}
            onClick={() => setParams({ page: String(page - 1) })}
          >
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page >= pages}
            onClick={() => setParams({ page: String(page + 1) })}
          >
            Next
          </button>
        </nav>
      )}
      {hasWorkspacePermission(workspace.myRole, 'board:create') && (
        <form className="row" onSubmit={handleCreate} noValidate>
          <input name="name" placeholder="New board name" aria-label="Board name" />
          <button type="submit" disabled={create.isPending}>
            Create board
          </button>
        </form>
      )}
      {formError && <p className="down">{formError}</p>}
    </section>
  );
}
