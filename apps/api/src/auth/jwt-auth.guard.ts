import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessTokenService } from './access-token.service';
import type { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global guard that requires a valid Bearer access token on every route not marked @Public().
 * @since REQ-002
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
  ) {}

  /**
   * Allows public routes; otherwise verifies the Bearer token and attaches its claims to request.user.
   * @since REQ-002
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(req);
    const payload = token ? await this.accessTokens.verify(token) : null;
    if (!payload) throw new UnauthorizedException('Invalid or expired access token');

    req.user = payload;
    return true;
  }
}

/**
 * Returns the token from an `Authorization: Bearer <token>` header, if present.
 * @since REQ-002
 */
export function extractBearerToken(req: Request): string | undefined {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
