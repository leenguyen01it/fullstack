import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/**
 * Wires task endpoints.
 * @since REQ-004
 */
@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
