import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  boardInputSchema,
  columnInputSchema,
  offsetPageQuerySchema,
  type BoardColumn,
  type BoardDetail,
  type BoardInput,
  type BoardSummary,
  type ColumnInput,
  type OffsetPage,
  type OffsetPageQuery,
} from '@taskflow/shared';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentMembership } from '../workspaces/current-membership.decorator';
import { WorkspacePermission } from '../workspaces/workspace-permission.decorator';
import type { Membership } from '../workspaces/workspace.types';
import { BoardsService } from './boards.service';

/**
 * Exposes endpoints for the boards of a workspace and their columns.
 * @since REQ-004
 * @updated REQ-005
 */
@RateLimit('api')
@ApiTags('boards')
@Controller('workspaces/:workspaceId/boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  /**
   * Lists the workspace's boards with offset pagination.
   * @since REQ-004
   */
  @Get()
  @WorkspacePermission('board:read')
  @ApiOkResponse({ description: 'One page of boards, newest first' })
  list(
    @CurrentMembership() membership: Membership,
    @Query(new ZodValidationPipe(offsetPageQuerySchema)) query: OffsetPageQuery,
  ): Promise<OffsetPage<BoardSummary>> {
    return this.boards.list(membership.workspaceId, query);
  }

  /**
   * Creates a board with default columns.
   * @since REQ-004
   */
  @Post()
  @WorkspacePermission('board:create')
  @ApiCreatedResponse({ description: 'Board created' })
  create(
    @CurrentMembership() membership: Membership,
    @Body(new ZodValidationPipe(boardInputSchema)) body: BoardInput,
  ): Promise<BoardDetail> {
    return this.boards.create(membership.workspaceId, body);
  }

  /**
   * Returns a board with its columns and tasks.
   * @since REQ-004
   */
  @Get(':boardId')
  @WorkspacePermission('board:read')
  @ApiOkResponse({ description: 'Board with ordered columns and tasks' })
  detail(
    @CurrentMembership() membership: Membership,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ): Promise<BoardDetail> {
    return this.boards.detail(membership.workspaceId, boardId);
  }

  /**
   * Renames a board.
   * @since REQ-004
   */
  @Patch(':boardId')
  @WorkspacePermission('board:update')
  @ApiOkResponse({ description: 'Board renamed' })
  rename(
    @CurrentMembership() membership: Membership,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body(new ZodValidationPipe(boardInputSchema)) body: BoardInput,
  ): Promise<BoardSummary> {
    return this.boards.rename(membership.workspaceId, boardId, body);
  }

  /**
   * Deletes a board with its columns and tasks.
   * @since REQ-004
   */
  @Delete(':boardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @WorkspacePermission('board:delete')
  @ApiNoContentResponse({ description: 'Board deleted' })
  remove(
    @CurrentMembership() membership: Membership,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ): Promise<void> {
    return this.boards.remove(membership.workspaceId, boardId);
  }

  /**
   * Appends a column to a board.
   * @since REQ-004
   */
  @Post(':boardId/columns')
  @WorkspacePermission('board:update')
  @ApiCreatedResponse({ description: 'Column added at the end' })
  addColumn(
    @CurrentMembership() membership: Membership,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body(new ZodValidationPipe(columnInputSchema)) body: ColumnInput,
  ): Promise<BoardColumn> {
    return this.boards.addColumn(membership.workspaceId, boardId, body);
  }

  /**
   * Renames a column.
   * @since REQ-004
   */
  @Patch(':boardId/columns/:columnId')
  @WorkspacePermission('board:update')
  @ApiOkResponse({ description: 'Column renamed' })
  renameColumn(
    @CurrentMembership() membership: Membership,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body(new ZodValidationPipe(columnInputSchema)) body: ColumnInput,
  ): Promise<Omit<BoardColumn, 'tasks'>> {
    return this.boards.renameColumn(membership.workspaceId, boardId, columnId, body);
  }

  /**
   * Deletes an empty column.
   * @since REQ-004
   */
  @Delete(':boardId/columns/:columnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @WorkspacePermission('board:update')
  @ApiNoContentResponse({ description: 'Column deleted' })
  @ApiConflictResponse({ description: 'Column still has tasks' })
  removeColumn(
    @CurrentMembership() membership: Membership,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
  ): Promise<void> {
    return this.boards.removeColumn(membership.workspaceId, boardId, columnId);
  }
}
