import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceRole,
} from '@taskflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { Membership } from './workspace.types';

const WORKSPACE_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  _count: { select: { members: true } },
} as const;

/**
 * Describes the workspace columns selected for responses.
 * @since REQ-003
 */
type WorkspaceRow = {
  id: string;
  name: string;
  createdAt: Date;
  _count: { members: number };
};

/**
 * Creates, lists, renames and deletes workspaces.
 * @since REQ-003
 */
@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a workspace and its owner membership in one atomic nested write.
   * @since REQ-003
   */
  async create(userId: string, input: CreateWorkspaceInput): Promise<Workspace> {
    const row = await this.prisma.workspace.create({
      data: { name: input.name, members: { create: { userId, role: 'OWNER' } } },
      select: WORKSPACE_SELECT,
    });
    return toWorkspace(row, 'OWNER');
  }

  /**
   * Lists the workspaces the user belongs to, newest membership first, with the user's role in each.
   * @since REQ-003
   */
  async listForUser(userId: string): Promise<Workspace[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      select: { role: true, workspace: { select: WORKSPACE_SELECT } },
    });
    return memberships.map(({ role, workspace }) => toWorkspace(workspace, role));
  }

  /**
   * Returns the workspace of a verified membership.
   * @since REQ-003
   */
  async get(membership: Membership): Promise<Workspace> {
    const row = await this.prisma.workspace.findUnique({
      where: { id: membership.workspaceId },
      select: WORKSPACE_SELECT,
    });
    if (!row) throw new NotFoundException('Workspace not found');
    return toWorkspace(row, membership.role);
  }

  /**
   * Renames the workspace of a verified membership.
   * @since REQ-003
   */
  async rename(membership: Membership, input: UpdateWorkspaceInput): Promise<Workspace> {
    const row = await this.prisma.workspace.update({
      where: { id: membership.workspaceId },
      data: { name: input.name },
      select: WORKSPACE_SELECT,
    });
    return toWorkspace(row, membership.role);
  }

  /**
   * Deletes a workspace; its memberships are removed by cascade.
   * @since REQ-003
   */
  async remove(workspaceId: string): Promise<void> {
    await this.prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
}

/**
 * Converts a workspace row into the shared Workspace shape for a member holding the given role.
 * @since REQ-003
 */
function toWorkspace(row: WorkspaceRow, myRole: WorkspaceRole): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    myRole,
    memberCount: row._count.members,
  };
}
