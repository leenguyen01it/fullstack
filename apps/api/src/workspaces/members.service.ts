import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canAssignRole,
  canManageMember,
  canRemoveMember,
  type AddMemberInput,
  type AssignableWorkspaceRole,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@taskflow/shared';
import { Prisma } from '../generated/prisma/client';
import { BoardCacheService } from '../cache/board-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Membership } from './workspace.types';

const MEMBER_SELECT = {
  userId: true,
  role: true,
  joinedAt: true,
  user: { select: { email: true, name: true } },
} as const;

const CHANGED_CONCURRENTLY = 'Member was changed by someone else, reload and try again';

/**
 * Describes the membership columns selected for responses.
 * @since REQ-003
 */
type MemberRow = {
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
  user: { email: string; name: string };
};

/**
 * Lists, adds, re-roles and removes workspace members and transfers ownership, enforcing the
 * attribute rules on who may act on whom.
 * @since REQ-003
 * @updated REQ-005
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boardCache: BoardCacheService,
  ) {}

  /**
   * Lists the members of a workspace in the order they joined.
   * @since REQ-003
   */
  async list(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { joinedAt: 'asc' },
      select: MEMBER_SELECT,
    });
    return rows.map(toMember);
  }

  /**
   * Adds a registered user to the workspace with a role below the actor's;
   * throws 404 for an unknown email and 409 when the user is already a member.
   * @since REQ-003
   */
  async add(actor: Membership, input: AddMemberInput): Promise<WorkspaceMember> {
    if (!canAssignRole(actor.role, input.role)) {
      throw new ForbiddenException(`Your role cannot grant ${input.role}`);
    }
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('No registered user with this email');

    try {
      const row = await this.prisma.workspaceMember.create({
        data: { workspaceId: actor.workspaceId, userId: user.id, role: input.role },
        select: MEMBER_SELECT,
      });
      return toMember(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User is already a member of this workspace');
      }
      throw error;
    }
  }

  /**
   * Changes another member's role when the actor outranks both the member and the new role;
   * throws 409 when the member's role changed since it was read.
   * @since REQ-003
   */
  async updateRole(
    actor: Membership,
    targetUserId: string,
    role: AssignableWorkspaceRole,
  ): Promise<WorkspaceMember> {
    if (targetUserId === actor.userId)
      throw new ForbiddenException('You cannot change your own role');
    const target = await this.findMember(actor.workspaceId, targetUserId);
    if (!canManageMember(actor.role, target.role) || !canAssignRole(actor.role, role)) {
      throw new ForbiddenException('Your role cannot make this change');
    }
    if (target.role === role) return toMember(target);

    const updated = await this.prisma.workspaceMember.updateMany({
      where: { workspaceId: actor.workspaceId, userId: targetUserId, role: target.role },
      data: { role },
    });
    if (updated.count !== 1) throw new ConflictException(CHANGED_CONCURRENTLY);
    return toMember({ ...target, role });
  }

  /**
   * Removes a member, or lets the actor leave, and unassigns their tasks in the same transaction;
   * the owner must transfer ownership before leaving, then drops the workspace's cached boards.
   * Throws 409 when the member's role changed since it was read.
   * @since REQ-003
   * @updated REQ-004
   * @updated REQ-005
   */
  async remove(actor: Membership, targetUserId: string): Promise<void> {
    const isSelf = targetUserId === actor.userId;
    const target = isSelf ? null : await this.findMember(actor.workspaceId, targetUserId);
    const targetRole = target?.role ?? actor.role;

    if (!canRemoveMember(actor.role, targetRole, isSelf)) {
      throw new ForbiddenException(
        isSelf
          ? 'Transfer ownership before leaving the workspace'
          : 'Your role cannot remove this member',
      );
    }

    const { workspaceId } = actor;
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.workspaceMember.deleteMany({
        where: { workspaceId, userId: targetUserId, role: targetRole },
      });
      if (deleted.count !== 1) throw new ConflictException(CHANGED_CONCURRENTLY);
      await tx.task.updateMany({
        where: { workspaceId, assigneeId: targetUserId },
        data: { assigneeId: null },
      });
    });
    await this.boardCache.invalidateWorkspace(workspaceId);
  }

  /**
   * Makes another member the owner and demotes the current owner to ADMIN in one transaction,
   * then returns the updated member list.
   * @since REQ-003
   */
  async transferOwnership(actor: Membership, targetUserId: string): Promise<WorkspaceMember[]> {
    if (targetUserId === actor.userId)
      throw new BadRequestException('You already own this workspace');
    const { workspaceId } = actor;

    await this.prisma.$transaction(async (tx) => {
      const demoted = await tx.workspaceMember.updateMany({
        where: { workspaceId, userId: actor.userId, role: 'OWNER' },
        data: { role: 'ADMIN' },
      });
      if (demoted.count !== 1) throw new ConflictException('You are no longer the owner');

      const promoted = await tx.workspaceMember.updateMany({
        where: { workspaceId, userId: targetUserId, role: { not: 'OWNER' } },
        data: { role: 'OWNER' },
      });
      if (promoted.count !== 1) throw new NotFoundException('Member not found');
    });

    return this.list(workspaceId);
  }

  /**
   * Loads one member of the workspace or throws 404.
   * @since REQ-003
   */
  private async findMember(workspaceId: string, userId: string): Promise<MemberRow> {
    const row = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: MEMBER_SELECT,
    });
    if (!row) throw new NotFoundException('Member not found');
    return row;
  }
}

/**
 * Converts a membership row into the shared WorkspaceMember shape.
 * @since REQ-003
 */
function toMember(row: MemberRow): WorkspaceMember {
  return {
    userId: row.userId,
    email: row.user.email,
    name: row.user.name,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
}
