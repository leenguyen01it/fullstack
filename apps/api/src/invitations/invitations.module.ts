import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { InvitationsController, WorkspaceInvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

/**
 * Wires workspace invitations.
 * @since REQ-006
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [WorkspaceInvitationsController, InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
