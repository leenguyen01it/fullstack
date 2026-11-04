import { Injectable, Logger } from '@nestjs/common';
import type { BoardDetail } from '@taskflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { acquireLock, releaseLock } from '../redis/redis-lock';
import { RedisService } from '../redis/redis.service';

const KEY_PREFIX = 'tf:board:';
const LOCK_PREFIX = 'tf:lock:board:';
const TTL_SECONDS = 60;
const TTL_JITTER_SECONDS = 15;
const MISSING_TTL_SECONDS = 10;
const LOCK_TTL_MS = 3_000;
const WAIT_STEP_MS = 50;
const WAIT_STEPS = 10;

/**
 * Describes a cached board together with the workspace that owns it; null marks a board that does not exist.
 * @since REQ-005
 */
export type CachedBoard = { workspaceId: string; board: BoardDetail } | null;

/**
 * Caches board details in Redis with cache-aside: single-flight and a rebuild lock against stampedes,
 * short-lived markers for missing boards, jittered TTLs, and invalidation after writes.
 * Redis failures fall back to the loader.
 * @since REQ-005
 */
@Injectable()
export class BoardCacheService {
  private readonly logger = new Logger(BoardCacheService.name);
  private readonly inflight = new Map<string, Promise<CachedBoard>>();

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Returns the board when it belongs to the workspace, reading the cache first and rebuilding it with loader on a miss.
   * @since REQ-005
   */
  async get(
    workspaceId: string,
    boardId: string,
    loader: () => Promise<CachedBoard>,
  ): Promise<BoardDetail | null> {
    let entry = await this.read(boardId);
    if (entry === undefined) {
      let pending = this.inflight.get(boardId);
      if (!pending) {
        pending = this.rebuild(boardId, loader).finally(() => this.inflight.delete(boardId));
        this.inflight.set(boardId, pending);
      }
      entry = await pending;
    }
    return entry && entry.workspaceId === workspaceId ? entry.board : null;
  }

  /**
   * Drops the cached detail of one board.
   * @since REQ-005
   */
  async invalidate(boardId: string): Promise<void> {
    try {
      await this.redis.client.del(KEY_PREFIX + boardId);
    } catch (error) {
      this.warn('invalidate', error);
    }
  }

  /**
   * Drops the cached details of every board in a workspace.
   * @since REQ-005
   */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    const boards = await this.prisma.board.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    if (boards.length === 0) return;
    try {
      await this.redis.client.del(...boards.map((board) => KEY_PREFIX + board.id));
    } catch (error) {
      this.warn('invalidateWorkspace', error);
    }
  }

  /**
   * Loads the board under a Redis lock and caches it; callers that miss the lock wait briefly for
   * the cache to fill and load it themselves if it does not.
   * @since REQ-005
   */
  private async rebuild(boardId: string, loader: () => Promise<CachedBoard>): Promise<CachedBoard> {
    const lockKey = LOCK_PREFIX + boardId;
    let token: string | null;
    try {
      token = await acquireLock(this.redis.client, lockKey, LOCK_TTL_MS);
    } catch (error) {
      this.warn('lock', error);
      return loader();
    }

    if (token) {
      try {
        const entry = await loader();
        await this.write(boardId, entry);
        return entry;
      } finally {
        await releaseLock(this.redis.client, lockKey, token).catch((error) =>
          this.warn('unlock', error),
        );
      }
    }

    for (let step = 0; step < WAIT_STEPS; step++) {
      await sleep(WAIT_STEP_MS);
      const entry = await this.read(boardId);
      if (entry !== undefined) return entry;
    }
    return loader();
  }

  /**
   * Returns the cached entry, or undefined on a miss or a Redis error.
   * @since REQ-005
   */
  private async read(boardId: string): Promise<CachedBoard | undefined> {
    try {
      const raw = await this.redis.client.get(KEY_PREFIX + boardId);
      return raw === null ? undefined : (JSON.parse(raw) as CachedBoard);
    } catch (error) {
      this.warn('read', error);
      return undefined;
    }
  }

  /**
   * Stores an entry with a jittered TTL, or a short TTL when the board does not exist.
   * @since REQ-005
   */
  private async write(boardId: string, entry: CachedBoard): Promise<void> {
    const ttl = entry
      ? TTL_SECONDS + Math.floor(Math.random() * TTL_JITTER_SECONDS)
      : MISSING_TTL_SECONDS;
    try {
      await this.redis.client.set(KEY_PREFIX + boardId, JSON.stringify(entry), 'EX', ttl);
    } catch (error) {
      this.warn('write', error);
    }
  }

  /**
   * Logs a Redis failure without failing the request.
   * @since REQ-005
   */
  private warn(operation: string, error: unknown): void {
    this.logger.warn(
      `Board cache ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Resolves after the given number of milliseconds.
 * @since REQ-005
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
