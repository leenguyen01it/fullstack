import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Exposes PrismaService to every module without re-importing.
 * @since REQ-001
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
