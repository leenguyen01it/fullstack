import { Module } from '@nestjs/common';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

/**
 * Wires boards and their columns.
 * @since REQ-004
 */
@Module({
  controllers: [BoardsController],
  providers: [BoardsService],
})
export class BoardsModule {}
