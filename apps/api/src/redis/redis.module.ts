import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Exposes RedisService to every module without re-importing.
 * @since REQ-001
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
