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
  createTaskSchema,
  moveTaskSchema,
  taskSearchQuerySchema,
  updateTaskSchema,
  type CreateTaskInput,
  type CursorPage,
  type MoveTaskInput,
  type Task,
  type TaskSearchQuery,
  type UpdateTaskInput,
} from '@taskflow/shared';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentMembership } from '../workspaces/current-membership.decorator';
import { WorkspacePermission } from '../workspaces/workspace-permission.decorator';
import type { Membership } from '../workspaces/workspace.types';
import { TasksService } from './tasks.service';

/**
 * Exposes endpoints to search, create, read, edit, move and delete the tasks of a workspace.
 * @since REQ-004
 * @updated REQ-005
 */
@RateLimit('api')
@ApiTags('tasks')
@Controller('workspaces/:workspaceId/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /**
   * Searches tasks with cursor pagination.
   * @since REQ-004
   */
  @Get()
  @WorkspacePermission('task:read')
  @ApiOkResponse({ description: 'One page of tasks, newest first, with nextCursor' })
  search(
    @CurrentMembership() membership: Membership,
    @Query(new ZodValidationPipe(taskSearchQuerySchema)) query: TaskSearchQuery,
  ): Promise<CursorPage<Task>> {
    return this.tasks.search(membership.workspaceId, query);
  }

  /**
   * Creates a task at the end of a column.
   * @since REQ-004
   */
  @Post()
  @WorkspacePermission('task:create')
  @ApiCreatedResponse({ description: 'Task created' })
  create(
    @CurrentMembership() membership: Membership,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
  ): Promise<Task> {
    return this.tasks.create(membership, body);
  }

  /**
   * Returns one task.
   * @since REQ-004
   */
  @Get(':taskId')
  @WorkspacePermission('task:read')
  @ApiOkResponse({ description: 'Task' })
  get(
    @CurrentMembership() membership: Membership,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<Task> {
    return this.tasks.get(membership.workspaceId, taskId);
  }

  /**
   * Edits a task with optimistic locking on its version.
   * @since REQ-004
   */
  @Patch(':taskId')
  @WorkspacePermission('task:update')
  @ApiOkResponse({ description: 'Task updated; version incremented' })
  @ApiConflictResponse({ description: 'Version is stale' })
  update(
    @CurrentMembership() membership: Membership,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
  ): Promise<Task> {
    return this.tasks.update(membership.workspaceId, taskId, body);
  }

  /**
   * Moves a task within its board (drag and drop).
   * @since REQ-004
   */
  @Post(':taskId/move')
  @HttpCode(HttpStatus.OK)
  @WorkspacePermission('task:update')
  @ApiOkResponse({ description: 'Task moved' })
  @ApiConflictResponse({ description: 'Too many concurrent moves' })
  move(
    @CurrentMembership() membership: Membership,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(new ZodValidationPipe(moveTaskSchema)) body: MoveTaskInput,
  ): Promise<Task> {
    return this.tasks.move(membership.workspaceId, taskId, body);
  }

  /**
   * Deletes a task.
   * @since REQ-004
   */
  @Delete(':taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @WorkspacePermission('task:delete')
  @ApiNoContentResponse({ description: 'Task deleted' })
  remove(
    @CurrentMembership() membership: Membership,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<void> {
    return this.tasks.remove(membership, taskId);
  }
}
