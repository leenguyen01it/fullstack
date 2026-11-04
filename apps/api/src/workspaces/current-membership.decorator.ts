import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Membership, WorkspaceRequest } from './workspace.types';

/**
 * Injects the caller's membership verified by WorkspaceAccessGuard into a handler parameter.
 * @since REQ-003
 */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Membership =>
    ctx.switchToHttp().getRequest<WorkspaceRequest>().membership,
);
