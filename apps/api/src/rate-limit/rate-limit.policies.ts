import type { Env } from '../config/env';

/**
 * Describes a sliding-window-log policy: at most `limit` requests in any `windowMs` period.
 * @since REQ-005
 */
export interface SlidingWindowPolicy {
  algorithm: 'sliding-window';
  limit: number;
  windowMs: number;
  key: 'ip' | 'user';
}

/**
 * Describes a token-bucket policy: bursts up to `capacity`, refilled at `refillPerSecond`.
 * @since REQ-005
 */
export interface TokenBucketPolicy {
  algorithm: 'token-bucket';
  capacity: number;
  refillPerSecond: number;
  key: 'ip' | 'user';
}

/**
 * Describes any supported rate limit policy.
 * @since REQ-005
 */
export type RateLimitPolicy = SlidingWindowPolicy | TokenBucketPolicy;

/**
 * Names the rate limit policies routes can opt into.
 * @since REQ-005
 */
export type RateLimitPolicyName = 'auth' | 'api';

/**
 * Builds the rate limit policies from config: a strict per-IP sliding window for auth routes and a
 * per-user token bucket for the business API.
 * @since REQ-005
 */
export function buildPolicies(
  env: Pick<
    Env,
    'RATE_LIMIT_AUTH_PER_MINUTE' | 'RATE_LIMIT_API_CAPACITY' | 'RATE_LIMIT_API_REFILL_PER_SECOND'
  >,
): Record<RateLimitPolicyName, RateLimitPolicy> {
  return {
    auth: {
      algorithm: 'sliding-window',
      limit: env.RATE_LIMIT_AUTH_PER_MINUTE,
      windowMs: 60_000,
      key: 'ip',
    },
    api: {
      algorithm: 'token-bucket',
      capacity: env.RATE_LIMIT_API_CAPACITY,
      refillPerSecond: env.RATE_LIMIT_API_REFILL_PER_SECOND,
      key: 'user',
    },
  };
}
