import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  generateKeyBetween,
  type BoardDetail,
  type BoardInput,
  type BoardSummary,
  type ColumnInput,
  type OffsetPage,
  type OffsetPageQuery,
} from '@taskflow/shared';
import { BoardCacheService, type CachedBoard } from '../cache/board-cache.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TASK_SELECT, toTask } from '../tasks/task.mapper';

const DEFAULT_COLUMNS = ['To do', 'In progress', 'Done'];
const BOARD_SELECT = { id: true, name: true, createdAt: true } as const;
const COLUMN_SELECT = { id: true, name: true, position: true } as const;

/**
 * Creates, lists, reads, renames and deletes boards and manages their columns; serves board details
 * through the board cache and invalidates it after every write.
 * @since REQ-004
 * @updated REQ-005
 */
@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: BoardCacheService,
  ) {}

  /**
   * Returns one offset page of the workspace's boards, newest first, with the total count.
   * @since REQ-004
   */
  async list(
    workspaceId: string,
    { page, pageSize }: OffsetPageQuery,
  ): Promise<OffsetPage<BoardSummary>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.board.count({ where: { workspaceId } }),
      this.prisma.board.findMany({
        where: { workspaceId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: BOARD_SELECT,
      }),
    ]);
    return { items: rows.map(toBoardSummary), total, page, pageSize };
  }

  /**
   * Creates a board with the default columns in one nested write.
   * @since REQ-004
   */
  async create(workspaceId: string, input: BoardInput): Promise<BoardDetail> {
    let position: string | null = null;
    const columns = DEFAULT_COLUMNS.map((name) => {
      position = generateKeyBetween(position, null);
      return { name, position };
    });
    const board = await this.prisma.board.create({
      data: { workspaceId, name: input.name, columns: { create: columns } },
      select: { id: true },
    });
    return this.detail(workspaceId, board.id);
  }

  /**
   * Returns a board with its columns and their tasks, each ordered by position, from the cache when possible.
   * @since REQ-004
   * @updated REQ-005
   */
  async detail(workspaceId: string, boardId: string): Promise<BoardDetail> {
    const board = await this.cache.get(workspaceId, boardId, () => this.load(boardId));
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  /**
   * Loads a board detail from the database together with its workspace id, or null when it does not exist.
   * @since REQ-005
   */
  private async load(boardId: string): Promise<CachedBoard> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: {
        ...BOARD_SELECT,
        workspaceId: true,
        columns: {
          orderBy: { position: 'asc' },
          select: {
            ...COLUMN_SELECT,
            tasks: { orderBy: { position: 'asc' }, select: TASK_SELECT },
          },
        },
      },
    });
    if (!board) return null;
    return {
      workspaceId: board.workspaceId,
      board: {
        ...toBoardSummary(board),
        columns: board.columns.map((column) => ({
          id: column.id,
          name: column.name,
          position: column.position,
          tasks: column.tasks.map((task) => toTask(task, board.id)),
        })),
      },
    };
  }

  /**
   * Renames a board of the workspace.
   * @since REQ-004
   * @updated REQ-005
   */
  async rename(workspaceId: string, boardId: string, input: BoardInput): Promise<BoardSummary> {
    try {
      const row = await this.prisma.board.update({
        where: { id: boardId, workspaceId },
        data: { name: input.name },
        select: BOARD_SELECT,
      });
      await this.cache.invalidate(boardId);
      return toBoardSummary(row);
    } catch (error) {
      throw mapNotFound(error, 'Board not found');
    }
  }

  /**
   * Deletes a board, its columns and their tasks in one transaction.
   * @since REQ-004
   * @updated REQ-005
   */
  async remove(workspaceId: string, boardId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.task.deleteMany({ where: { workspaceId, column: { boardId } } });
        const deleted = await tx.board.deleteMany({ where: { id: boardId, workspaceId } });
        if (deleted.count !== 1) throw new NotFoundException('Board not found');
      });
    } catch (error) {
      throw mapForeignKey(error, 'Board changed while deleting, please retry');
    }
    await this.cache.invalidate(boardId);
  }

  /**
   * Appends a column to the end of a board.
   * @since REQ-004
   * @updated REQ-005
   */
  async addColumn(workspaceId: string, boardId: string, input: ColumnInput) {
    const column = await this.prisma.serializable(async (tx) => {
      const board = await tx.board.findFirst({
        where: { id: boardId, workspaceId },
        select: { id: true },
      });
      if (!board) throw new NotFoundException('Board not found');
      const last = await tx.boardColumn.findFirst({
        where: { boardId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const column = await tx.boardColumn.create({
        data: {
          boardId,
          name: input.name,
          position: generateKeyBetween(last?.position ?? null, null),
        },
        select: COLUMN_SELECT,
      });
      return { ...column, tasks: [] };
    });
    await this.cache.invalidate(boardId);
    return column;
  }

  /**
   * Renames a column of a board in the workspace.
   * @since REQ-004
   * @updated REQ-005
   */
  async renameColumn(workspaceId: string, boardId: string, columnId: string, input: ColumnInput) {
    try {
      const column = await this.prisma.boardColumn.update({
        where: { id: columnId, boardId, board: { workspaceId } },
        data: { name: input.name },
        select: COLUMN_SELECT,
      });
      await this.cache.invalidate(boardId);
      return column;
    } catch (error) {
      throw mapNotFound(error, 'Column not found');
    }
  }

  /**
   * Deletes an empty column; throws 409 while it still has tasks.
   * @since REQ-004
   * @updated REQ-005
   */
  async removeColumn(workspaceId: string, boardId: string, columnId: string): Promise<void> {
    try {
      const deleted = await this.prisma.boardColumn.deleteMany({
        where: { id: columnId, boardId, board: { workspaceId } },
      });
      if (deleted.count !== 1) throw new NotFoundException('Column not found');
    } catch (error) {
      throw mapForeignKey(error, 'Column still has tasks');
    }
    await this.cache.invalidate(boardId);
  }
}

/**
 * Converts a board row into the shared BoardSummary shape.
 * @since REQ-004
 */
function toBoardSummary(row: { id: string; name: string; createdAt: Date }): BoardSummary {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

/**
 * Turns Prisma's "record not found" error into a 404 and returns any other error unchanged.
 * @since REQ-004
 */
function mapNotFound(error: unknown, message: string): unknown {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
    ? new NotFoundException(message)
    : error;
}

/**
 * Turns a foreign key violation into a 409 and returns any other error unchanged.
 * @since REQ-004
 */
function mapForeignKey(error: unknown, message: string): unknown {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
    ? new ConflictException(message)
    : error;
}
