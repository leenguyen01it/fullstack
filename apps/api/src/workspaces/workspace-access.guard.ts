import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasWorkspacePermission, type WorkspacePermissionName } from '@taskflow/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceRequest } from './workspace.types';

/**
 * Metadata key holding the workspace permission a route requires.
 * @since REQ-003
 */
export const WORKSPACE_PERMISSION_KEY = 'workspacePermission';

const uuidSchema = z.uuid();

/**
 * Requires the caller to be a member of the `:workspaceId` workspace whose role holds the route's permission;
 * answers 404 for non-members and 403 for members lacking the permission, and attaches the membership to the request.
 * @since REQ-003
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Loads the caller's membership and checks it against the permission declared on the handler.
   * @since REQ-003
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.get<WorkspacePermissionName | undefined>(
      WORKSPACE_PERMISSION_KEY,
      context.getHandler(),
    );
    if (!permission) throw new ForbiddenException('No workspace permission declared');

    const req = context.switchToHttp().getRequest<WorkspaceRequest>();
    const parsed = uuidSchema.safeParse(req.params['workspaceId']);
    if (!parsed.success) throw new NotFoundException('Workspace not found');
    const workspaceId = parsed.data;

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: req.user.sub } },
      select: { workspaceId: true, userId: true, role: true },
    });
    if (!membership) throw new NotFoundException('Workspace not found');
    if (!hasWorkspacePermission(membership.role, permission)) {
      throw new ForbiddenException('You do not have permission to do this in this workspace');
    }

    req.membership = membership;
    return true;
  }
}
