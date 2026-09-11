import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response, Request } from 'express';
import { DomainException } from '../../modules/shared/domain/domain-exception';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId?: string;
    timestamp: string;
    details?: unknown;
  };
}

/**
 * FR-014: Maps DomainException to correct HTTP status codes.
 * Unknown errors → 500 without stack trace in production.
 * NFR-003: No secrets or stack traces in production responses.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly nodeEnv = 'development') {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const correlationId = request.correlationId;
    const timestamp = new Date().toISOString();
    const isProduction = this.nodeEnv === 'production';

    let statusCode: number;
    let code: string;
    let message: string;
    let details: unknown;

    if (exception instanceof ThrottlerException) {
      statusCode = HttpStatus.TOO_MANY_REQUESTS;
      code = 'TOO_MANY_REQUESTS';
      message = 'Too many requests — please slow down and try again later.';
      this.logger.warn(
        { correlationId, url: request.url, method: request.method },
        'ThrottlerException: TOO_MANY_REQUESTS',
      );
    } else if (exception instanceof DomainException) {
      statusCode = exception.httpStatus;
      code = exception.code;
      message = exception.message;

      this.logger.warn(
        { code, message, correlationId, url: request.url, method: request.method },
        `DomainException: ${code}`,
      );
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        code = (resp['code'] as string) ?? this.statusToCode(statusCode);
        message = (resp['message'] as string) ?? exception.message;
        details = resp['details'];
      } else {
        code = this.statusToCode(statusCode);
        message = String(exceptionResponse);
      }

      this.logger.warn(
        { statusCode, code, correlationId, url: request.url, method: request.method },
        `HttpException: ${code}`,
      );
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_SERVER_ERROR';
      message = 'An unexpected error occurred.';

      // Log full error for internal diagnostics
      this.logger.error(
        {
          error: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
          correlationId,
          url: request.url,
          method: request.method,
        },
        'Unhandled exception',
      );

      // In development, include more info
      if (!isProduction && exception instanceof Error) {
        message = exception.message;
      }
    }

    const body: ErrorResponse = {
      error: {
        code,
        message,
        correlationId,
        timestamp,
        ...(details ? { details } : {}),
      },
    };

    response.status(statusCode).json(body);
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? 'HTTP_ERROR';
  }
}
