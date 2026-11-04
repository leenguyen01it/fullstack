import { useState } from 'react';
import type { FormEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  createTaskSchema,
  hasWorkspacePermission,
  type BoardColumn,
  type Workspace,
} from '@taskflow/shared';
import { useBoardMutations, useTaskMutations } from '../api/boards';
import { TaskCard } from './TaskCard';

/**
 * Renders one column as a drop target with its sortable task cards, an inline form to add a task at
 * the end, and a delete action for empty columns when the user may manage the board.
 * @since REQ-007
 */
export function KanbanColumn({
  workspace,
  boardId,
  column,
  onOpenTask,
}: {
  workspace: Workspace;
  boardId: string;
  column: BoardColumn;
  onOpenTask: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const { create } = useTaskMutations(workspace.id, boardId);
  const { removeColumn } = useBoardMutations(workspace.id);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasWorkspacePermission(workspace.myRole, 'board:update');

  /**
   * Validates the title and creates the task at the end of this column.
   * @since REQ-007
   */
  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = createTaskSchema.safeParse({
      columnId: column.id,
      title: new FormData(form).get('title'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid title');
      return;
    }
    setError(null);
    create.mutate(parsed.data, {
      onSuccess: () => form.reset(),
      onError: (err) => setError(err.message),
    });
  }

  return (
    <section className={isOver ? 'column over' : 'column'} aria-label={column.name}>
      <header className="column-header">
        <h3>
          {column.name} <small>{column.tasks.length}</small>
        </h3>
        {canManage && column.tasks.length === 0 && (
          <button
            type="button"
            className="icon"
            aria-label={`Delete column ${column.name}`}
            disabled={removeColumn.isPending}
            onClick={() => removeColumn.mutate({ boardId, columnId: column.id })}
          >
            ×
          </button>
        )}
      </header>
      <SortableContext items={column.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="cards">
          {column.tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </ul>
      </SortableContext>
      <form className="add-task" onSubmit={handleAdd} noValidate>
        <input name="title" placeholder="Add a task" aria-label={`New task in ${column.name}`} />
      </form>
      {error && <p className="down">{error}</p>}
    </section>
  );
}
