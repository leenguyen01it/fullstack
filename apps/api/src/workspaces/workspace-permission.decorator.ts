import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import type { WorkspacePermissionName } from '@taskflow/shared';
import { WORKSPACE_PERMISSION_KEY, WorkspaceAccessGuard } from './workspace-access.guard';

/**
 * Protects a `:workspaceId` route with WorkspaceAccessGuard, requiring the given permission.
 * @since REQ-003
 */
export const WorkspacePermission = (permission: WorkspacePermissionName) =>
  applyDecorators(
    SetMetadata(WORKSPACE_PERMISSION_KEY, permission),
    UseGuards(WorkspaceAccessGuard),
    ApiBearerAuth(),
    ApiNotFoundResponse({ description: 'Workspace not found or caller is not a member' }),
    ApiForbiddenResponse({ description: `Caller's role lacks "${permission}"` }),
  );
