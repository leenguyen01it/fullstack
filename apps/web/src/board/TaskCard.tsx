import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '@taskflow/shared';

const SOON_MS = 24 * 60 * 60 * 1000;

/**
 * Renders a draggable task card that opens the editor on click; memoized because every card
 * re-renders while a drag is in progress otherwise.
 * @since REQ-007
 */
export const TaskCard = memo(function TaskCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'task-card placeholder' : 'task-card'}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        listeners?.['onKeyDown']?.(event);
        if (event.key === 'Enter') onOpen(task.id);
      }}
    >
      <TaskCardView task={task} />
    </li>
  );
});

/**
 * Renders the content of a task card: title, due date badge and assignee initials.
 * @since REQ-007
 */
export function TaskCardView({ task, dragging = false }: { task: Task; dragging?: boolean }) {
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const dueClass = due
    ? due.getTime() < Date.now()
      ? 'badge overdue'
      : due.getTime() - Date.now() < SOON_MS
        ? 'badge soon'
        : 'badge'
    : '';

  return (
    <div className={dragging ? 'card-body dragging' : 'card-body'}>
      <span className="card-title">{task.title}</span>
      <span className="card-meta">
        {due && (
          <time className={dueClass} dateTime={task.dueDate!}>
            {due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </time>
        )}
        {task.assignee && (
          <span className="avatar" title={task.assignee.name}>
            {initials(task.assignee.name)}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Returns up to two uppercase initials of a name.
 * @since REQ-007
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
