import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  createInvitationSchema,
  invitationTokenSchema,
  type CreateInvitationInput,
  type Invitation,
  type InvitationPreview,
  type InvitationTokenInput,
  type Workspace,
} from '@taskflow/shared';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { CurrentMembership } from '../workspaces/current-membership.decorator';
import { WorkspacePermission } from '../workspaces/workspace-permission.decorator';
import type { Membership } from '../workspaces/workspace.types';
import { InvitationsService } from './invitations.service';

/**
 * Exposes endpoints for workspace admins to invite people by email, list and revoke invitations.
 * @since REQ-006
 */
@RateLimit('api')
@ApiTags('invitations')
@Controller('workspaces/:workspaceId/invitations')
export class WorkspaceInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /**
   * Invites an email to the workspace and queues the invitation email.
   * @since REQ-006
   */
  @Post()
  @WorkspacePermission('member:add')
  @ApiCreatedResponse({ description: 'Invitation created; email queued' })
  @ApiConflictResponse({ description: 'Email already belongs to a member' })
  create(
    @CurrentMembership() membership: Membership,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationInput,
  ): Promise<Invitation> {
    return this.invitations.create(membership, body);
  }

  /**
   * Lists pending invitations.
   * @since REQ-006
   */
  @Get()
  @WorkspacePermission('member:add')
  @ApiOkResponse({ description: 'Pending invitations' })
  list(@CurrentMembership() membership: Membership): Promise<Invitation[]> {
    return this.invitations.list(membership.workspaceId);
  }

  /**
   * Revokes a pending invitation.
   * @since REQ-006
   */
  @Delete(':invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @WorkspacePermission('member:add')
  @ApiNoContentResponse({ description: 'Invitation revoked' })
  revoke(
    @CurrentMembership() membership: Membership,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(membership.workspaceId, invitationId);
  }
}

/**
 * Exposes endpoints for an invited, signed-in user to preview and accept an invitation by its token.
 * @since REQ-006
 */
@RateLimit('api')
@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /**
   * Returns the workspace and role an invitation token grants.
   * @since REQ-006
   */
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Invitation preview' })
  @ApiNotFoundResponse({ description: 'Invalid, expired, revoked or used token' })
  lookup(
    @Body(new ZodValidationPipe(invitationTokenSchema)) body: InvitationTokenInput,
  ): Promise<InvitationPreview> {
    return this.invitations.lookup(body.token);
  }

  /**
   * Accepts an invitation for the signed-in user and returns the joined workspace.
   * @since REQ-006
   */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Joined the workspace' })
  @ApiForbiddenResponse({ description: 'Invitation was sent to another email' })
  @ApiNotFoundResponse({ description: 'Invalid, expired, revoked or used token' })
  accept(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(invitationTokenSchema)) body: InvitationTokenInput,
  ): Promise<Workspace> {
    return this.invitations.accept(user.sub, body.token);
  }
}
