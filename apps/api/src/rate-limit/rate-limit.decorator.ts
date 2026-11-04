import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import type { RateLimitPolicyName } from './rate-limit.policies';
import { RATE_LIMIT_KEY, RateLimitGuard } from './rate-limit.guard';

/**
 * Applies a named rate limit policy to a route or a whole controller.
 * @since REQ-005
 */
export const RateLimit = (policy: RateLimitPolicyName) =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_KEY, policy),
    UseGuards(RateLimitGuard),
    ApiTooManyRequestsResponse({ description: `Rate limit "${policy}" exceeded; see Retry-After` }),
  );
