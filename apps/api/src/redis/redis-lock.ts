import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/**
 * Tries to take a lock that expires on its own after ttlMs; returns the owner token, or null when it is held.
 * @since REQ-005
 */
export async function acquireLock(
  redis: Redis,
  key: string,
  ttlMs: number,
): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
  return result === 'OK' ? token : null;
}

/**
 * Releases a lock only when the caller still owns it; returns true when it was released.
 * @since REQ-005
 */
export async function releaseLock(redis: Redis, key: string, token: string): Promise<boolean> {
  return (await redis.eval(RELEASE_SCRIPT, 1, key, token)) === 1;
}
