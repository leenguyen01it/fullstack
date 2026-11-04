import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * Boots a worker-only process: the application context without an HTTP server, running the BullMQ
 * workers and closing them gracefully on SIGTERM/SIGINT.
 * @since REQ-006
 */
async function bootstrapWorker(): Promise<void> {
  process.env['RUN_WORKERS'] = 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker process started');
}

void bootstrapWorker();
