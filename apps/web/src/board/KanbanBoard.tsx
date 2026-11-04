import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { BoardDetail, Task, Workspace, WorkspaceMember } from '@taskflow/shared';
import { useMoveTask } from '../api/boards';
import { KanbanColumn } from './KanbanColumn';
import { TaskCardView } from './TaskCard';
import { TaskEditor } from './TaskEditor';

type Draft = Record<string, string[]>;

/**
 * Renders a board's columns with drag-and-drop between and within columns: while dragging it keeps a
 * local draft of the order, and on drop sends the move (task id, column, task to land after) which is
 * applied optimistically.
 * @since REQ-007
 */
export function KanbanBoard({
  workspace,
  board,
  members,
}: {
  workspace: Workspace;
  board: BoardDetail;
  members: WorkspaceMember[];
}) {
  const move = useMoveTask(workspace.id, board.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const tasksById = useMemo(
    () => new Map(board.columns.flatMap((column) => column.tasks).map((task) => [task.id, task])),
    [board],
  );

  const columns = useMemo(
    () =>
      draft
        ? board.columns.map((column) => ({
            ...column,
            tasks: (draft[column.id] ?? [])
              .map((id) => tasksById.get(id))
              .filter((task): task is Task => task !== undefined),
          }))
        : board.columns,
    [board, draft, tasksById],
  );

  const openTask = useCallback((taskId: string) => setOpenTaskId(taskId), []);

  /**
   * Starts a drag: snapshots the current order into the draft.
   * @since REQ-007
   */
  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setDraft(
      Object.fromEntries(board.columns.map((column) => [column.id, column.tasks.map((t) => t.id)])),
    );
  }

  /**
   * Moves the dragged task into another column of the draft while hovering over it.
   * @since REQ-007
   */
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over || !draft) return;
    const from = findColumn(draft, String(active.id));
    const to = findColumn(draft, String(over.id));
    if (!from || !to || from === to) return;
    setDraft((current) => {
      if (!current) return current;
      const source = current[from]!.filter((id) => id !== active.id);
      const target = [...current[to]!];
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id));
      return { ...current, [from]: source, [to]: target };
    });
  }

  /**
   * Finishes a drag: computes the final position and sends the move when it changed.
   * @since REQ-007
   */
  function handleDragEnd({ active, over }: DragEndEvent) {
    const taskId = String(active.id);
    const current = draft;
    setActiveId(null);
    setDraft(null);
    if (!over || !current) return;

    const columnId = findColumn(current, taskId);
    if (!columnId) return;
    let order = current[columnId]!;
    const oldIndex = order.indexOf(taskId);
    const overIndex = order.indexOf(String(over.id));
    if (overIndex >= 0 && overIndex !== oldIndex) order = arrayMove(order, oldIndex, overIndex);

    const index = order.indexOf(taskId);
    const afterTaskId = index > 0 ? order[index - 1]! : null;
    const original = board.columns.find((column) => column.id === columnId)?.tasks ?? [];
    const originalIndex = original.findIndex((t) => t.id === taskId);
    const unchanged =
      originalIndex >= 0 &&
      (originalIndex > 0 ? original[originalIndex - 1]!.id : null) === afterTaskId;
    if (unchanged) return;

    move.mutate({ taskId, columnId, afterTaskId });
  }

  const activeTask = activeId ? tasksById.get(activeId) : undefined;
  const openedTask = openTaskId ? tasksById.get(openTaskId) : undefined;

  return (
    <>
      {move.isError && (
        <p className="down" role="status">
          Could not move the task: {move.error.message}. The board was restored.
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerFirst}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setDraft(null);
        }}
      >
        <div className="kanban">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              workspace={workspace}
              boardId={board.id}
              column={column}
              onOpenTask={openTask}
            />
          ))}
        </div>
        <DragOverlay>{activeTask ? <TaskCardView task={activeTask} dragging /> : null}</DragOverlay>
      </DndContext>

      {openedTask && (
        <TaskEditor
          key={openedTask.id}
          workspace={workspace}
          boardId={board.id}
          task={openedTask}
          members={members}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </>
  );
}

/**
 * Returns the column that holds the id, which is either a column id or a task id.
 * @since REQ-007
 */
function findColumn(draft: Draft, id: string): string | undefined {
  if (id in draft) return id;
  return Object.keys(draft).find((columnId) => draft[columnId]!.includes(id));
}

/**
 * Picks the droppable under the pointer first, falling back to the closest corners when the pointer is
 * between targets (or during keyboard dragging, which has no pointer).
 * @since REQ-007
 */
const pointerFirst: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCorners(args);
};
