import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { AccessTokenPayload } from '../auth/auth.types';
import type { RateLimitPolicyName } from './rate-limit.policies';
import { RateLimitService } from './rate-limit.service';

/**
 * Metadata key holding the rate limit policy name of a route or controller.
 * @since REQ-005
 */
export const RATE_LIMIT_KEY = 'rateLimitPolicy';

/**
 * Enforces the route's rate limit policy, keyed by user id for signed-in callers on user policies and by
 * client IP otherwise; sets RateLimit headers and answers 429 with Retry-After when the limit is reached.
 * @since REQ-005
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimits: RateLimitService,
  ) {}

  /**
   * Consumes one request from the policy and rejects it when none are left.
   * @since REQ-005
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.getAllAndOverride<RateLimitPolicyName | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!name) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: AccessTokenPayload }>();
    const res = http.getResponse<Response>();
    const policy = this.rateLimits.policy(name);
    const identity =
      policy.key === 'user' && req.user ? `user:${req.user.sub}` : `ip:${req.ip ?? 'unknown'}`;

    const result = await this.rateLimits.consume(name, identity);
    res.setHeader('RateLimit-Limit', result.limit);
    res.setHeader('RateLimit-Remaining', result.remaining);
    if (result.allowed) return true;

    res.setHeader('Retry-After', Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
    throw new HttpException('Too many requests, please retry later', HttpStatus.TOO_MANY_REQUESTS);
  }
}
