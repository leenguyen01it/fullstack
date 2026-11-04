import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env';

/**
 * Provides a shared Redis connection for caching, rate limiting and locks.
 * @since REQ-001
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  /**
   * Connects to Redis using the configured REDIS_URL, failing commands that take longer than one second.
   * @since REQ-001
   * @updated REQ-005
   */
  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      commandTimeout: 1_000,
    });
  }

  /**
   * Returns true when Redis replies to PING.
   * @since REQ-001
   */
  async isHealthy(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Closes the Redis connection when the app shuts down.
   * @since REQ-001
   */
  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
