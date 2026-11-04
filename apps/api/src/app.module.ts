import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { BoardsModule } from './boards/boards.module';
import { CacheModule } from './cache/cache.module';
import { InvitationsModule } from './invitations/invitations.module';
import { JobsModule } from './jobs/jobs.module';
import { validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RedisModule } from './redis/redis.module';
import { TasksModule } from './tasks/tasks.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

/**
 * Root module: loads validated config, structured logging, database and Redis connections,
 * caching and rate limiting, authentication with a global access-token guard, workspaces with their
 * members, boards, tasks and invitations, and the background job queues and workers.
 * @since REQ-001
 * @updated REQ-002
 * @updated REQ-003
 * @updated REQ-004
 * @updated REQ-005
 * @updated REQ-006
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
        transport:
          process.env['NODE_ENV'] === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    PrismaModule,
    RedisModule,
    CacheModule,
    RateLimitModule,
    JobsModule,
    AuthModule,
    WorkspacesModule,
    BoardsModule,
    TasksModule,
    InvitationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
