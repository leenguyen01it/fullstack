import type { WorkspaceRole } from '@taskflow/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';

/**
 * Describes the caller's verified membership in the workspace named by the route.
 * @since REQ-003
 */
export interface Membership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

/**
 * Describes a request that passed WorkspaceAccessGuard.
 * @since REQ-003
 */
export interface WorkspaceRequest extends AuthenticatedRequest {
  membership: Membership;
}
