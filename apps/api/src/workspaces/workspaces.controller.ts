import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type Workspace,
} from '@taskflow/shared';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentMembership } from './current-membership.decorator';
import { WorkspacePermission } from './workspace-permission.decorator';
import type { Membership } from './workspace.types';
import { WorkspacesService } from './workspaces.service';

/**
 * Exposes endpoints to create, list, read, rename and delete workspaces.
 * @since REQ-003
 * @updated REQ-005
 */
@RateLimit('api')
@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  /**
   * Creates a workspace owned by the caller.
   * @since REQ-003
   */
  @Post()
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: 'Workspace created; caller is OWNER' })
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ): Promise<Workspace> {
    return this.workspaces.create(user.sub, body);
  }

  /**
   * Lists the workspaces the caller belongs to.
   * @since REQ-003
   */
  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Caller's workspaces with their role in each" })
  list(@CurrentUser() user: AccessTokenPayload): Promise<Workspace[]> {
    return this.workspaces.listForUser(user.sub);
  }

  /**
   * Returns one workspace the caller belongs to.
   * @since REQ-003
   */
  @Get(':workspaceId')
  @WorkspacePermission('workspace:read')
  @ApiOkResponse({ description: 'Workspace' })
  get(@CurrentMembership() membership: Membership): Promise<Workspace> {
    return this.workspaces.get(membership);
  }

  /**
   * Renames a workspace.
   * @since REQ-003
   */
  @Patch(':workspaceId')
  @WorkspacePermission('workspace:update')
  @ApiOkResponse({ description: 'Workspace renamed' })
  rename(
    @CurrentMembership() membership: Membership,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput,
  ): Promise<Workspace> {
    return this.workspaces.rename(membership, body);
  }

  /**
   * Deletes a workspace and all its memberships.
   * @since REQ-003
   */
  @Delete(':workspaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @WorkspacePermission('workspace:delete')
  @ApiNoContentResponse({ description: 'Workspace deleted' })
  remove(@CurrentMembership() membership: Membership): Promise<void> {
    return this.workspaces.remove(membership.workspaceId);
  }
}
