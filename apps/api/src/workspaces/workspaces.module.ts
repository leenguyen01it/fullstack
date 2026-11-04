import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * Wires workspaces, their members and the workspace permission guard, and exports WorkspacesService.
 * @since REQ-003
 * @updated REQ-006
 */
@Module({
  controllers: [WorkspacesController, MembersController],
  providers: [WorkspacesService, MembersService, WorkspaceAccessGuard],
  exports: [WorkspaceAccessGuard, WorkspacesService],
})
export class WorkspacesModule {}
