import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  canDeleteTask,
  updateTaskSchema,
  type Task,
  type Workspace,
  type WorkspaceMember,
} from '@taskflow/shared';
import { boardKeys, useTaskMutations } from '../api/boards';
import { ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';

/**
 * Edits a task in a modal dialog with optimistic locking: it sends the version it was opened with and,
 * on 409, explains the conflict and offers to reload the latest version instead of overwriting it.
 * @since REQ-007
 */
export function TaskEditor({
  workspace,
  boardId,
  task,
  members,
  onClose,
}: {
  workspace: Workspace;
  boardId: string;
  task: Task;
  members: WorkspaceMember[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { update, remove } = useTaskMutations(workspace.id, boardId);
  const [error, setError] = useState<string | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const conflict = conflictVersion === task.version;
  const canDelete = canDeleteTask(workspace.myRole, task.creatorId === user?.id);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  /**
   * Validates the form and saves it against the version the editor was opened with.
   * @since REQ-007
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const dueDate = String(data.get('dueDate') ?? '');
    const parsed = updateTaskSchema.safeParse({
      version: task.version,
      title: data.get('title'),
      description: String(data.get('description') ?? '') || null,
      assigneeId: String(data.get('assigneeId') ?? '') || null,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setError(null);
    update.mutate(
      { taskId: task.id, ...parsed.data },
      {
        onSuccess: onClose,
        onError: (err) => {
          if (err instanceof ApiRequestError && err.status === 409)
            setConflictVersion(task.version);
          else setError(err.message);
        },
      },
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      onClose={onClose}
      aria-labelledby="task-editor-title"
    >
      <form key={task.version} className="form" onSubmit={handleSubmit} noValidate>
        <h2 id="task-editor-title">Edit task</h2>
        {conflict && (
          <div className="conflict" role="alert">
            <p>This task was changed by someone else while you were editing.</p>
            <button
              type="button"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardId) })
              }
            >
              Reload latest version
            </button>
          </div>
        )}
        <label className="field">
          <span>Title</span>
          <input name="title" defaultValue={task.title} required />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea name="description" rows={4} defaultValue={task.description ?? ''} />
        </label>
        <label className="field">
          <span>Assignee</span>
          <select name="assigneeId" defaultValue={task.assignee?.id ?? ''}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Due date</span>
          <input name="dueDate" type="datetime-local" defaultValue={toLocalInput(task.dueDate)} />
        </label>
        {error && <p className="down">{error}</p>}
        <div className="row">
          <button type="submit" disabled={update.isPending || conflict}>
            Save
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          {canDelete && (
            <button
              type="button"
              className="danger push-right"
              disabled={remove.isPending}
              onClick={() => remove.mutate(task.id, { onSuccess: onClose })}
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

/**
 * Converts an ISO timestamp to the local "YYYY-MM-DDTHH:mm" value a datetime-local input expects.
 * @since REQ-007
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
