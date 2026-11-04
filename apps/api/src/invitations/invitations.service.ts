import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  canAssignRole,
  type CreateInvitationInput,
  type Invitation,
  type InvitationPreview,
  type Workspace,
} from '@taskflow/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { QueuesService } from '../jobs/queues.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Membership } from '../workspaces/workspace.types';
import { WorkspacesService } from '../workspaces/workspaces.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND = 'Invitation not found, expired or already used';

const INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  createdAt: true,
  invitedBy: { select: { id: true, name: true } },
} as const;

/**
 * Creates, lists and revokes workspace invitations, emails them through the job queue, and lets the
 * invited user preview and accept them with the emailed token.
 * @since REQ-006
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly ttlMs: number;

  /**
   * Reads the invitation lifetime from config.
   * @since REQ-006
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueuesService,
    private readonly workspaces: WorkspacesService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('INVITATION_TTL_DAYS') * DAY_MS;
  }

  /**
   * Invites an email with a role below the actor's, replacing pending invitations for the same email,
   * then enqueues the email after the transaction commits. Throws 409 when the email is already a member
   * and 503 when the email could not be queued.
   * @since REQ-006
   */
  async create(actor: Membership, input: CreateInvitationInput): Promise<Invitation> {
    if (!canAssignRole(actor.role, input.role)) {
      throw new ForbiddenException(`Your role cannot grant ${input.role}`);
    }
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: actor.workspaceId, user: { email: input.email } },
      select: { userId: true },
    });
    if (existing) throw new ConflictException('This email already belongs to a member');

    const token = randomBytes(32).toString('base64url');
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: pendingWhere({ workspaceId: actor.workspaceId, email: input.email }),
        data: { revokedAt: new Date() },
      });
      return tx.invitation.create({
        data: {
          workspaceId: actor.workspaceId,
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedById: actor.userId,
          expiresAt: new Date(Date.now() + this.ttlMs),
        },
        select: INVITATION_SELECT,
      });
    });

    try {
      await this.queues.enqueueInvitationEmail(invitation.id, token);
    } catch (error) {
      this.logger.error(`Could not queue invitation ${invitation.id}: ${String(error)}`);
      throw new ServiceUnavailableException(
        'Invitation saved but the email could not be queued, please retry',
      );
    }
    return toInvitation(invitation);
  }

  /**
   * Lists the workspace's pending invitations, newest first.
   * @since REQ-006
   */
  async list(workspaceId: string): Promise<Invitation[]> {
    const rows = await this.prisma.invitation.findMany({
      where: pendingWhere({ workspaceId }),
      orderBy: { createdAt: 'desc' },
      select: INVITATION_SELECT,
    });
    return rows.map(toInvitation);
  }

  /**
   * Revokes a pending invitation of the workspace.
   * @since REQ-006
   */
  async revoke(workspaceId: string, invitationId: string): Promise<void> {
    const revoked = await this.prisma.invitation.updateMany({
      where: pendingWhere({ id: invitationId, workspaceId }),
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new NotFoundException(NOT_FOUND);
  }

  /**
   * Returns what the holder of a valid token is invited to.
   * @since REQ-006
   */
  async lookup(token: string): Promise<InvitationPreview> {
    const invitation = await this.prisma.invitation.findFirst({
      where: pendingWhere({ tokenHash: hashToken(token) }),
      select: {
        workspaceId: true,
        email: true,
        role: true,
        expiresAt: true,
        workspace: { select: { name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (!invitation) throw new NotFoundException(NOT_FOUND);
    return {
      workspaceId: invitation.workspaceId,
      workspaceName: invitation.workspace.name,
      email: invitation.email,
      role: invitation.role,
      invitedByName: invitation.invitedBy?.name ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Accepts a valid invitation for the signed-in user whose email it was sent to: claims it with a
   * conditional update and creates the membership in one transaction, then returns the workspace.
   * @since REQ-006
   */
  async accept(userId: string, token: string): Promise<Workspace> {
    const [user, invitation] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      this.prisma.invitation.findFirst({
        where: pendingWhere({ tokenHash: hashToken(token) }),
        select: { id: true, workspaceId: true, email: true, role: true },
      }),
    ]);
    if (!invitation) throw new NotFoundException(NOT_FOUND);
    if (!user || user.email !== invitation.email) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: pendingWhere({ id: invitation.id }),
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new NotFoundException(NOT_FOUND);
      await tx.workspaceMember.createMany({
        data: [{ workspaceId: invitation.workspaceId, userId, role: invitation.role }],
        skipDuplicates: true,
      });
    });

    const membership = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      select: { workspaceId: true, userId: true, role: true },
    });
    return this.workspaces.get(membership);
  }
}

/**
 * Builds a filter for invitations that are neither accepted, revoked nor expired.
 * @since REQ-006
 */
function pendingWhere(where: Prisma.InvitationWhereInput): Prisma.InvitationWhereInput {
  return { ...where, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } };
}

/**
 * Returns the SHA-256 hex digest stored in place of the raw invitation token.
 * @since REQ-006
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Converts an invitation row into the shared Invitation shape.
 * @since REQ-006
 */
function toInvitation(row: {
  id: string;
  email: string;
  role: Invitation['role'];
  expiresAt: Date;
  createdAt: Date;
  invitedBy: { id: string; name: string } | null;
}): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
