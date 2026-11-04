import type { Task } from '@taskflow/shared';

/**
 * Selects the task columns needed to build the shared Task shape.
 * @since REQ-004
 */
export const TASK_SELECT = {
  id: true,
  columnId: true,
  title: true,
  description: true,
  position: true,
  version: true,
  creatorId: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, name: true } },
} as const;

/**
 * Describes a task row loaded with TASK_SELECT.
 * @since REQ-004
 */
export type TaskRow = {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: string;
  version: number;
  creatorId: string | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignee: { id: string; name: string } | null;
};

/**
 * Converts a task row of the given board into the shared Task shape.
 * @since REQ-004
 */
export function toTask(row: TaskRow, boardId: string): Task {
  return {
    id: row.id,
    boardId,
    columnId: row.columnId,
    title: row.title,
    description: row.description,
    position: row.position,
    version: row.version,
    assignee: row.assignee,
    creatorId: row.creatorId,
    dueDate: row.dueDate?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
