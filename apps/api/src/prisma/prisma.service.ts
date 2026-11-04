import { ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import type { Env } from '../config/env';

const RETRYABLE_CODES = new Set(['P2034', 'P2002']);

/**
 * Resolves after the given number of milliseconds.
 * @since REQ-004
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Provides a shared Prisma client connected to PostgreSQL for the whole app lifecycle.
 * @since REQ-001
 * @updated REQ-004
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * Creates the Prisma client using the pg driver adapter and the configured DATABASE_URL.
   * @since REQ-001
   */
  constructor(config: ConfigService<Env, true>) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  /**
   * Opens the database connection when the module starts.
   * @since REQ-001
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Closes the database connection when the app shuts down.
   * @since REQ-001
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Returns true when PostgreSQL answers a trivial query.
   * @since REQ-001
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Runs fn in a SERIALIZABLE transaction, re-running it after a short random backoff when Postgres
   * reports a serialization failure, deadlock or unique violation; throws 409 after the last attempt fails.
   * @since REQ-004
   */
  async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(error.code);
        if (!retryable) throw error;
        if (attempt >= attempts) {
          throw new ConflictException('Too many concurrent changes, please retry');
        }
        await sleep(Math.random() * 20 * 2 ** attempt);
      }
    }
  }
}
