import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import { RedisService } from '../redis/redis.service';
import {
  buildPolicies,
  type RateLimitPolicy,
  type RateLimitPolicyName,
} from './rate-limit.policies';
import { SLIDING_WINDOW_SCRIPT, TOKEN_BUCKET_SCRIPT } from './rate-limit.scripts';

/**
 * Describes the outcome of consuming one request from a rate limit.
 * @since REQ-005
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

type ScriptReply = [number, number, number];

/**
 * Counts requests per policy and identity in Redis with atomic Lua scripts; lets requests through
 * when Redis fails (fail open).
 * @since REQ-005
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly policies: Record<RateLimitPolicyName, RateLimitPolicy>;

  /**
   * Registers the Lua scripts as ioredis commands (sent with EVALSHA) and builds the policies.
   * @since REQ-005
   */
  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.policies = buildPolicies({
      RATE_LIMIT_AUTH_PER_MINUTE: config.get('RATE_LIMIT_AUTH_PER_MINUTE'),
      RATE_LIMIT_API_CAPACITY: config.get('RATE_LIMIT_API_CAPACITY'),
      RATE_LIMIT_API_REFILL_PER_SECOND: config.get('RATE_LIMIT_API_REFILL_PER_SECOND'),
    });
    redis.client.defineCommand('tfSlidingWindow', { numberOfKeys: 1, lua: SLIDING_WINDOW_SCRIPT });
    redis.client.defineCommand('tfTokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET_SCRIPT });
  }

  /**
   * Returns the policy registered under the name.
   * @since REQ-005
   */
  policy(name: RateLimitPolicyName): RateLimitPolicy {
    return this.policies[name];
  }

  /**
   * Consumes one request for the identity under the named policy.
   * @since REQ-005
   */
  async consume(name: RateLimitPolicyName, identity: string): Promise<RateLimitResult> {
    const policy = this.policies[name];
    const key = `tf:rl:${name}:${identity}`;
    const limit = policy.algorithm === 'sliding-window' ? policy.limit : policy.capacity;
    try {
      const client = this.redis.client as unknown as RateLimitCommands;
      const [allowed, remaining, retryAfterMs] =
        policy.algorithm === 'sliding-window'
          ? await client.tfSlidingWindow(key, policy.windowMs, policy.limit, randomUUID())
          : await client.tfTokenBucket(key, policy.capacity, policy.refillPerSecond);
      return { allowed: allowed === 1, limit, remaining, retryAfterMs };
    } catch (error) {
      this.logger.warn(
        `Rate limit check failed, allowing request: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { allowed: true, limit, remaining: limit, retryAfterMs: 0 };
    }
  }
}

/**
 * Describes the custom commands registered with defineCommand.
 * @since REQ-005
 */
interface RateLimitCommands {
  tfSlidingWindow(
    key: string,
    windowMs: number,
    limit: number,
    member: string,
  ): Promise<ScriptReply>;
  tfTokenBucket(key: string, capacity: number, refillPerSecond: number): Promise<ScriptReply>;
}
