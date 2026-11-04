import { Global, Module } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { EmailWorker } from './email.worker';
import { QueuesService } from './queues.service';
import { ReminderScanWorker } from './reminder-scan.worker';

/**
 * Wires the BullMQ queues, the email and reminder workers and the mail transport; exposes QueuesService
 * so features can enqueue jobs.
 * @since REQ-006
 */
@Global()
@Module({
  providers: [QueuesService, MailService, EmailWorker, ReminderScanWorker],
  exports: [QueuesService],
})
export class JobsModule {}
