import { Global, Module } from '@nestjs/common';
import { BoardCacheService } from './board-cache.service';

/**
 * Exposes the Redis-backed caches to every module.
 * @since REQ-005
 */
@Global()
@Module({
  providers: [BoardCacheService],
  exports: [BoardCacheService],
})
export class CacheModule {}
