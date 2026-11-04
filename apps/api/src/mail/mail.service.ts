import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

/**
 * Describes one outgoing email.
 * @since REQ-006
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends email over SMTP (Mailpit locally) with the configured sender address.
 * @since REQ-006
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;

  /**
   * Creates the SMTP transport from SMTP_URL with short connection timeouts.
   * @since REQ-006
   */
  constructor(config: ConfigService<Env, true>) {
    this.transport = createTransport({
      url: config.get('SMTP_URL'),
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
    this.from = config.get('MAIL_FROM');
  }

  /**
   * Sends a message; rejects on SMTP errors so the calling job can retry.
   * @since REQ-006
   */
  async send(message: MailMessage): Promise<void> {
    const info = await this.transport.sendMail({ from: this.from, ...message });
    this.logger.log(`Mail "${message.subject}" sent to ${message.to} (${String(info.messageId)})`);
  }

  /**
   * Closes pooled SMTP connections on shutdown.
   * @since REQ-006
   */
  onModuleDestroy(): void {
    this.transport.close();
  }
}

/**
 * Escapes text for safe insertion into HTML email bodies.
 * @since REQ-006
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
