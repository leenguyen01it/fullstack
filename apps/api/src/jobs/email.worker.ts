import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env';
import { MailService, escapeHtml } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_QUEUE,
  type DeadlineReminderJob,
  type EmailJob,
  type InvitationEmailJob,
} from './queue.constants';
import { createQueueConnection } from './queues.service';

/**
 * Processes the email queue when RUN_WORKERS is on: sends invitation and deadline reminder emails,
 * skipping jobs whose data is no longer valid, with 5 concurrent jobs and at most 10 sends per second.
 * @since REQ-006
 */
@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name);
  private worker?: Worker<EmailJob>;
  private connection?: Redis;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Starts the worker on its own Redis connection.
   * @since REQ-006
   */
  onModuleInit(): void {
    if (!this.config.get('RUN_WORKERS')) return;
    this.connection = createQueueConnection(this.config.get('REDIS_URL'));
    this.worker = new Worker<EmailJob>(EMAIL_QUEUE, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 5,
      limiter: { max: 10, duration: 1_000 },
    });
    this.worker.on('failed', (job, error) =>
      this.logger.warn(
        `Email job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}): ${error.message}`,
      ),
    );
    this.worker.on('error', (error) => this.logger.error(`Email worker error: ${error.message}`));
  }

  /**
   * Stops taking jobs, waits for running ones and closes the connection.
   * @since REQ-006
   */
  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
  }

  /**
   * Dispatches a job to the handler for its kind.
   * @since REQ-006
   */
  private process(job: Job<EmailJob>): Promise<void> {
    return job.data.kind === 'invitation'
      ? this.sendInvitation(job.data)
      : this.sendDeadlineReminder(job.data);
  }

  /**
   * Emails an invitation link unless the invitation was accepted, revoked or has expired.
   * @since REQ-006
   */
  private async sendInvitation({ invitationId, token }: InvitationEmailJob): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: {
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        workspace: { select: { name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date()
    ) {
      this.logger.log(`Skipping invitation ${invitationId}: no longer valid`);
      return;
    }

    const link = `${this.config.get('WEB_URL')}/invitations/${token}`;
    const inviter = invitation.invitedBy?.name ?? 'Someone';
    const workspace = invitation.workspace.name;
    await this.mail.send({
      to: invitation.email,
      subject: `${inviter} invited you to ${workspace} on TaskFlow`,
      text: `${inviter} invited you to join "${workspace}" as ${invitation.role}.\n\nAccept: ${link}\n\nThis link expires on ${invitation.expiresAt.toUTCString()}.`,
      html: `<p>${escapeHtml(inviter)} invited you to join <b>${escapeHtml(workspace)}</b> as ${invitation.role}.</p><p><a href="${escapeHtml(link)}">Accept the invitation</a></p><p>This link expires on ${invitation.expiresAt.toUTCString()}.</p>`,
    });
  }

  /**
   * Emails the assignee about a task due soon, then records the reminded due date; skips when the
   * task, its assignee or its due date changed, or the reminder was already sent.
   * @since REQ-006
   */
  private async sendDeadlineReminder({ taskId, dueDate }: DeadlineReminderJob): Promise<void> {
    const due = new Date(dueDate);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        title: true,
        dueDate: true,
        reminderSentFor: true,
        workspaceId: true,
        column: { select: { boardId: true } },
        assignee: { select: { email: true, name: true } },
      },
    });
    if (
      !task?.assignee ||
      task.dueDate?.getTime() !== due.getTime() ||
      task.reminderSentFor?.getTime() === due.getTime()
    ) {
      this.logger.log(`Skipping reminder for task ${taskId}: no longer due or already sent`);
      return;
    }

    const link = `${this.config.get('WEB_URL')}/w/${task.workspaceId}/b/${task.column.boardId}`;
    await this.mail.send({
      to: task.assignee.email,
      subject: `Due soon: ${task.title}`,
      text: `Hi ${task.assignee.name},\n\n"${task.title}" is due ${due.toUTCString()}.\n\nOpen the board: ${link}`,
      html: `<p>Hi ${escapeHtml(task.assignee.name)},</p><p><b>${escapeHtml(task.title)}</b> is due ${due.toUTCString()}.</p><p><a href="${escapeHtml(link)}">Open the board</a></p>`,
    });
    await this.prisma.task.updateMany({
      where: { id: taskId, dueDate: due },
      data: { reminderSentFor: due },
    });
  }
}
