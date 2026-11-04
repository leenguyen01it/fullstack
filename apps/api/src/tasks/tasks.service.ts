import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canDeleteTask,
  generateKeyBetween,
  type CreateTaskInput,
  type CursorPage,
  type MoveTaskInput,
  type Task,
  type TaskSearchQuery,
  type UpdateTaskInput,
} from '@taskflow/shared';
import type { Prisma } from '../generated/prisma/client';
import { BoardCacheService } from '../cache/board-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Membership } from '../workspaces/workspace.types';
import { decodeTaskCursor, encodeTaskCursor } from './task-cursor';
import { TASK_SELECT, toTask } from './task.mapper';

const TASK_WITH_BOARD_SELECT = { ...TASK_SELECT, column: { select: { boardId: true } } } as const;

/**
 * Creates, searches, reads, edits, moves and deletes the tasks of a workspace, invalidating the cached
 * board after every write.
 * @since REQ-004
 * @updated REQ-005
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boardCache: BoardCacheService,
  ) {}

  /**
   * Returns one cursor page of the workspace's tasks, newest first, optionally filtered by a
   * case-insensitive title substring, board and assignee.
   * @since REQ-004
   */
  async search(workspaceId: string, query: TaskSearchQuery): Promise<CursorPage<Task>> {
    const after = query.cursor ? decodeTaskCursor(query.cursor) : null;
    const where: Prisma.TaskWhereInput = {
      workspaceId,
      ...(query.q && { title: { contains: escapeLike(query.q), mode: 'insensitive' } }),
      ...(query.boardId && { column: { boardId: query.boardId } }),
      ...(query.assigneeId && { assigneeId: query.assigneeId }),
      ...(after && {
        OR: [
          { createdAt: { lt: after.createdAt } },
          { createdAt: after.createdAt, id: { lt: after.id } },
        ],
      }),
    };

    const rows = await this.prisma.task.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: TASK_WITH_BOARD_SELECT,
    });

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => toTask(row, row.column.boardId)),
      nextCursor: rows.length > query.limit && last ? encodeTaskCursor(last) : null,
    };
  }

  /**
   * Creates a task at the end of a column of this workspace, recorded as created by the actor.
   * @since REQ-004
   * @updated REQ-005
   */
  async create(actor: Membership, input: CreateTaskInput): Promise<Task> {
    const { workspaceId } = actor;
    if (input.assigneeId) await this.assertMember(workspaceId, input.assigneeId);

    const id = await this.prisma.serializable(async (tx) => {
      const column = await tx.boardColumn.findFirst({
        where: { id: input.columnId, board: { workspaceId } },
        select: { id: true },
      });
      if (!column) throw fieldError('columnId', 'Column not found in this workspace');

      const last = await tx.task.findFirst({
        where: { columnId: column.id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const task = await tx.task.create({
        data: {
          workspaceId,
          columnId: column.id,
          title: input.title,
          description: input.description ?? null,
          assigneeId: input.assigneeId ?? null,
          dueDate: input.dueDate ?? null,
          creatorId: actor.userId,
          position: generateKeyBetween(last?.position ?? null, null),
        },
        select: { id: true },
      });
      return task.id;
    });
    return this.refreshed(workspaceId, id);
  }

  /**
   * Returns one task of the workspace.
   * @since REQ-004
   */
  async get(workspaceId: string, taskId: string): Promise<Task> {
    const row = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      select: TASK_WITH_BOARD_SELECT,
    });
    if (!row) throw new NotFoundException('Task not found');
    return toTask(row, row.column.boardId);
  }

  /**
   * Applies a partial edit when the client's version is current (optimistic locking) and bumps the version;
   * throws 409 when someone else changed the task first.
   * @since REQ-004
   * @updated REQ-005
   */
  async update(workspaceId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const { version, ...changes } = input;
    if (changes.assigneeId) await this.assertMember(workspaceId, changes.assigneeId);

    const updated = await this.prisma.task.updateMany({
      where: { id: taskId, workspaceId, version },
      data: { ...changes, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      const exists = await this.prisma.task.count({ where: { id: taskId, workspaceId } });
      if (!exists) throw new NotFoundException('Task not found');
      throw new ConflictException('Task was modified by someone else, reload and try again');
    }
    return this.refreshed(workspaceId, taskId);
  }

  /**
   * Moves a task to a column of the same board, right after another task (or to the top),
   * writing only the moved row; runs serializable and retries on conflicts.
   * @since REQ-004
   * @updated REQ-005
   */
  async move(workspaceId: string, taskId: string, input: MoveTaskInput): Promise<Task> {
    if (input.afterTaskId === taskId)
      throw fieldError('afterTaskId', 'A task cannot be placed after itself');

    await this.prisma.serializable(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, workspaceId },
        select: { column: { select: { boardId: true } } },
      });
      if (!task) throw new NotFoundException('Task not found');

      const column = await tx.boardColumn.findFirst({
        where: { id: input.columnId, boardId: task.column.boardId },
        select: { id: true },
      });
      if (!column) throw fieldError('columnId', 'Column is not on the same board as the task');

      let before: string | null = null;
      if (input.afterTaskId) {
        const after = await tx.task.findFirst({
          where: { id: input.afterTaskId, columnId: column.id },
          select: { position: true },
        });
        if (!after) throw fieldError('afterTaskId', 'Task is not in the target column');
        before = after.position;
      }

      const next = await tx.task.findFirst({
        where: {
          columnId: column.id,
          id: { not: taskId },
          ...(before !== null && { position: { gt: before } }),
        },
        orderBy: { position: 'asc' },
        select: { position: true },
      });

      await tx.task.update({
        where: { id: taskId },
        data: { columnId: column.id, position: generateKeyBetween(before, next?.position ?? null) },
      });
    });
    return this.refreshed(workspaceId, taskId);
  }

  /**
   * Deletes a task; members may delete only the tasks they created.
   * @since REQ-004
   * @updated REQ-005
   */
  async remove(actor: Membership, taskId: string): Promise<void> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: actor.workspaceId },
      select: { creatorId: true, column: { select: { boardId: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (!canDeleteTask(actor.role, task.creatorId === actor.userId)) {
      throw new ForbiddenException('Members can delete only the tasks they created');
    }
    await this.prisma.task.deleteMany({ where: { id: taskId, workspaceId: actor.workspaceId } });
    await this.boardCache.invalidate(task.column.boardId);
  }

  /**
   * Invalidates the cached board of a task that was just written and returns the task.
   * @since REQ-005
   */
  private async refreshed(workspaceId: string, taskId: string): Promise<Task> {
    const task = await this.get(workspaceId, taskId);
    await this.boardCache.invalidate(task.boardId);
    return task;
  }

  /**
   * Throws 400 unless the user is a member of the workspace.
   * @since REQ-004
   */
  private async assertMember(workspaceId: string, userId: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { userId: true },
    });
    if (!member) throw fieldError('assigneeId', 'Assignee must be a member of this workspace');
  }
}

/**
 * Builds a 400 error in the shared validation format for one field.
 * @since REQ-004
 */
function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({ message: 'Validation failed', errors: { [field]: [message] } });
}

/**
 * Escapes LIKE wildcards so user input matches literally.
 * @since REQ-004
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
