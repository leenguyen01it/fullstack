import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { DUE_TASK_SCAN_SCHEDULER, SCHEDULED_QUEUE } from './queue.constants';
import { QueuesService, createQueueConnection } from './queues.service';

const SCAN_BATCH = 500;

/**
 * Processes the scheduled queue when RUN_WORKERS is on: on each due-task scan, finds assigned tasks due
 * within the reminder window that were not yet reminded for their current due date and enqueues one
 * reminder job per task.
 * @since REQ-006
 */
@Injectable()
export class ReminderScanWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderScanWorker.name);
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly queues: QueuesService,
  ) {}

  /**
   * Starts the worker on its own Redis connection.
   * @since REQ-006
   */
  onModuleInit(): void {
    if (!this.config.get('RUN_WORKERS')) return;
    this.connection = createQueueConnection(this.config.get('REDIS_URL'));
    this.worker = new Worker(
      SCHEDULED_QUEUE,
      async (job) => {
        if (job.name === DUE_TASK_SCAN_SCHEDULER) return this.scan();
        return undefined;
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('error', (error) => this.logger.error(`Scan worker error: ${error.message}`));
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
   * Enqueues reminders for tasks due soon and returns how many were found.
   * @since REQ-006
   */
  async scan(): Promise<number> {
    const hours = this.config.get('REMINDER_WINDOW_HOURS');
    const rows = await this.prisma.$queryRaw<{ id: string; due_date: Date }[]>`
      SELECT id, due_date
      FROM tasks
      WHERE assignee_id IS NOT NULL
        AND due_date > now()
        AND due_date <= now() + make_interval(hours => ${hours}::int)
        AND reminder_sent_for IS DISTINCT FROM due_date
      ORDER BY due_date
      LIMIT ${SCAN_BATCH}`;
    await this.queues.enqueueDeadlineReminders(
      rows.map((row) => ({ id: row.id, dueDate: row.due_date })),
    );
    if (rows.length > 0) this.logger.log(`Due-task scan enqueued ${rows.length} reminder(s)`);
    return rows.length;
  }
}
