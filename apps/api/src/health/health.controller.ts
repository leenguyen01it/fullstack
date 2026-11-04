import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { HealthResponse } from '@taskflow/shared';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Reports whether the API and its dependencies (PostgreSQL, Redis) are reachable, without authentication.
 * @since REQ-001
 * @updated REQ-002
 */
@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Returns 200 with per-dependency status when all are up, 503 when any is down.
   * @since REQ-001
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'All dependencies are up' })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is down' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy()]);
    const ok = database && redis;
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: ok ? 'ok' : 'error',
      uptime: Math.round(process.uptime()),
      checks: { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down' },
    };
  }
}
