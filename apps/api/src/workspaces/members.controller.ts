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
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  addMemberSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
  type AddMemberInput,
  type TransferOwnershipInput,
  type UpdateMemberRoleInput,
  type WorkspaceMember,
} from '@taskflow/shared';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentMembership } from './current-membership.decorator';
import { MembersService } from './members.service';
import { WorkspacePermission } from './workspace-permission.decorator';
import type { Membership } from './workspace.types';

/**
 * Exposes endpoints to list, add, re-role and remove workspace members and to transfer ownership.
 * @since REQ-003
 * @updated REQ-005
 */
@RateLimit('api')
@ApiTags('workspace members')
@Controller('workspaces/:workspaceId')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /**
   * Lists the members of the workspace.
   * @since REQ-003
   */
  @Get('members')
  @WorkspacePermission('member:read')
  @ApiOkResponse({ description: 'Members in join order' })
  list(@CurrentMembership() membership: Membership): Promise<WorkspaceMember[]> {
    return this.members.list(membership.workspaceId);
  }

  /**
   * Adds a registered user to the workspace by email.
   * @since REQ-003
   */
  @Post('members')
  @WorkspacePermission('member:add')
  @ApiCreatedResponse({ description: 'Member added' })
  @ApiConflictResponse({ description: 'User is already a member' })
  add(
    @CurrentMembership() membership: Membership,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberInput,
  ): Promise<WorkspaceMember> {
    return this.members.add(membership, body);
  }

  /**
   * Changes a member's role.
   * @since REQ-003
   */
  @Patch('members/:userId')
  @WorkspacePermission('member:update')
  @ApiOkResponse({ description: 'Role changed' })
  @ApiConflictResponse({ description: 'Member changed concurrently' })
  updateRole(
    @CurrentMembership() membership: Membership,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) body: UpdateMemberRoleInput,
  ): Promise<WorkspaceMember> {
    return this.members.updateRole(membership, userId, body.role);
  }

  /**
   * Removes a member, or lets the caller leave when the id is their own.
   * @since REQ-003
   */
  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @WorkspacePermission('member:remove')
  @ApiNoContentResponse({ description: 'Member removed or caller left' })
  @ApiConflictResponse({ description: 'Member changed concurrently' })
  remove(
    @CurrentMembership() membership: Membership,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.members.remove(membership, userId);
  }

  /**
   * Hands ownership to another member; the caller becomes ADMIN.
   * @since REQ-003
   */
  @Post('transfer-ownership')
  @HttpCode(HttpStatus.OK)
  @WorkspacePermission('workspace:transfer')
  @ApiOkResponse({ description: 'Ownership transferred; returns the updated member list' })
  transferOwnership(
    @CurrentMembership() membership: Membership,
    @Body(new ZodValidationPipe(transferOwnershipSchema)) body: TransferOwnershipInput,
  ): Promise<WorkspaceMember[]> {
    return this.members.transferOwnership(membership, body.userId);
  }
}
