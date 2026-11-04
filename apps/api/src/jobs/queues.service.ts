import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Env } from '../config/env';
import {
  DUE_TASK_SCAN_SCHEDULER,
  EMAIL_JOB_OPTIONS,
  EMAIL_QUEUE,
  SCHEDULED_QUEUE,
  type EmailJob,
} from './queue.constants';

/**
 * Opens a Redis connection suitable for BullMQ: commands wait for reconnection instead of failing.
 * @since REQ-006
 */
export function createQueueConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

/**
 * Owns the BullMQ queues: enqueues email jobs with deterministic ids so duplicates are dropped,
 * and registers the cron scheduler that scans for tasks due soon.
 * @since REQ-006
 */
@Injectable()
export class QueuesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueuesService.name);
  private readonly connection: Redis;
  readonly email: Queue<EmailJob>;
  readonly scheduled: Queue;
  private readonly reminderCron: string;

  /**
   * Creates the queues on a dedicated Redis connection.
   * @since REQ-006
   */
  constructor(config: ConfigService<Env, true>) {
    this.connection = createQueueConnection(config.get('REDIS_URL'));
    this.email = new Queue<EmailJob>(EMAIL_QUEUE, {
      connection: this.connection,
      defaultJobOptions: EMAIL_JOB_OPTIONS,
    });
    this.scheduled = new Queue(SCHEDULED_QUEUE, {
      connection: this.connection,
      defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
    });
    this.reminderCron = config.get('REMINDER_CRON');
  }

  /**
   * Creates or updates the due-task scan scheduler; safe to call from every instance.
   * @since REQ-006
   */
  async onModuleInit(): Promise<void> {
    await this.scheduled.upsertJobScheduler(
      DUE_TASK_SCAN_SCHEDULER,
      { pattern: this.reminderCron },
      { name: DUE_TASK_SCAN_SCHEDULER },
    );
    this.logger.log(`Due-task scan scheduled with cron "${this.reminderCron}"`);
  }

  /**
   * Enqueues the email for an invitation; one job per invitation.
   * @since REQ-006
   */
  async enqueueInvitationEmail(invitationId: string, token: string): Promise<void> {
    await this.email.add(
      'invitation',
      { kind: 'invitation', invitationId, token },
      { jobId: `invitation-${invitationId}` },
    );
  }

  /**
   * Enqueues deadline reminders; one job per task and due date.
   * @since REQ-006
   */
  async enqueueDeadlineReminders(tasks: { id: string; dueDate: Date }[]): Promise<void> {
    if (tasks.length === 0) return;
    await this.email.addBulk(
      tasks.map((task) => ({
        name: 'deadline-reminder',
        data: { kind: 'deadline-reminder', taskId: task.id, dueDate: task.dueDate.toISOString() },
        opts: { jobId: `reminder-${task.id}-${task.dueDate.getTime()}` },
      })),
    );
  }

  /**
   * Closes the queues and their connection on shutdown.
   * @since REQ-006
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.email.close(), this.scheduled.close()]);
    await this.connection.quit();
  }
}
