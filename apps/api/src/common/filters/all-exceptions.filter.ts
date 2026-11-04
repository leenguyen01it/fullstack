import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@taskflow/shared';

/**
 * Converts every thrown error into the shared ApiError response shape and logs server errors.
 * @since REQ-001
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * Builds the ApiError body for the caught exception and sends it with the matching status code.
   * @since REQ-001
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ApiError = {
      statusCode,
      message: 'Internal server error',
      path: req.url,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        body.message = payload;
      } else {
        const { message, errors } = payload as {
          message?: string | string[];
          errors?: ApiError['errors'];
        };
        body.message = Array.isArray(message) ? message.join(', ') : (message ?? exception.message);
        if (errors) body.errors = errors;
      }
    }

    if (statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(statusCode).json(body);
  }
}
