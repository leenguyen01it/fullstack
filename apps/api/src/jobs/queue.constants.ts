import type { DefaultJobOptions } from 'bullmq';

/**
 * Name of the queue that sends email.
 * @since REQ-006
 */
export const EMAIL_QUEUE = 'email';

/**
 * Name of the queue that runs scheduled maintenance scans.
 * @since REQ-006
 */
export const SCHEDULED_QUEUE = 'scheduled';

/**
 * Id of the job scheduler that scans for tasks due soon.
 * @since REQ-006
 */
export const DUE_TASK_SCAN_SCHEDULER = 'scan-due-tasks';

/**
 * Describes the payload of an invitation email job.
 * @since REQ-006
 */
export interface InvitationEmailJob {
  kind: 'invitation';
  invitationId: string;
  token: string;
}

/**
 * Describes the payload of a deadline reminder email job.
 * @since REQ-006
 */
export interface DeadlineReminderJob {
  kind: 'deadline-reminder';
  taskId: string;
  dueDate: string;
}

/**
 * Describes any job on the email queue.
 * @since REQ-006
 */
export type EmailJob = InvitationEmailJob | DeadlineReminderJob;

/**
 * Retry and retention defaults for email jobs: 5 attempts with jittered exponential backoff,
 * completed jobs kept one hour, failed jobs kept seven days.
 * @since REQ-006
 */
export const EMAIL_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};
