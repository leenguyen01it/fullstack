import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Workspace, WorkspaceMember } from '@taskflow/shared';
import { useTaskSearch } from '../api/tasks';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

/**
 * Searches the workspace's tasks by title and assignee, querying 300 ms after typing stops and loading
 * the next cursor page when the end of the list scrolls into view.
 * @since REQ-007
 */
export function TaskSearch({
  workspace,
  members,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
}) {
  const [q, setQ] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const debouncedQ = useDebouncedValue(q.trim(), 300);
  const search = useTaskSearch(workspace.id, {
    q: debouncedQ,
    ...(assigneeId && { assigneeId }),
  });
  const sentinelRef = useRef<HTMLLIElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = search;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const tasks = search.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="card">
      <h2>Tasks</h2>
      <div className="row">
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search task titles"
          aria-label="Search task titles"
        />
        <select
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
          aria-label="Filter by assignee"
        >
          <option value="">Anyone</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
      </div>
      {search.isPending && <p className="subtitle">Searching…</p>}
      {search.error && <p className="down">{search.error.message}</p>}
      {search.isSuccess && tasks.length === 0 && <p className="subtitle">No matching tasks.</p>}
      <ul className="list results">
        {tasks.map((task) => (
          <li key={task.id}>
            <Link className="item" to={`/w/${workspace.id}/b/${task.boardId}`}>
              <span>{task.title}</span>
              <small>
                {task.assignee?.name ?? 'Unassigned'}
                {task.dueDate && ` · due ${new Date(task.dueDate).toLocaleDateString()}`}
              </small>
            </Link>
          </li>
        ))}
        {hasNextPage && (
          <li ref={sentinelRef} className="subtitle">
            {isFetchingNextPage ? 'Loading more…' : ' '}
          </li>
        )}
      </ul>
    </section>
  );
}
