import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types';

/**
 * Injects the access token claims of the authenticated caller into a handler parameter.
 * @since REQ-002
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
