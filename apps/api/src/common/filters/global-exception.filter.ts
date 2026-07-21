import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorDetail, ApiErrorResponse } from '@ai-content-os/contracts';
import { ERROR_CODES } from '@ai-content-os/shared';
import type { Request, Response } from 'express';
import type { RequestWithId } from '../middleware/request-id.middleware';

const codeByStatus: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.validation,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.unauthorized,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.forbidden,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.notFound,
  [HttpStatus.CONFLICT]: ERROR_CODES.conflict,
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const exceptionBody = exception instanceof HttpException ? exception.getResponse() : undefined;
    const details = this.details(exceptionBody);
    const publicMessage =
      status === 500 ? 'Une erreur interne est survenue.' : this.message(exceptionBody, exception);
    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: codeByStatus[status] ?? ERROR_CODES.internal,
        message: publicMessage,
        details,
        requestId: request.requestId ?? 'unknown',
      },
      timestamp: new Date().toISOString(),
      path: (request as Request).originalUrl,
    };
    if (status >= 500) {
      this.logger.error(
        {
          requestId: body.error.requestId,
          errorCode: body.error.code,
          stack: exception instanceof Error ? exception.stack : undefined,
        },
        'Request failed',
      );
    }
    response.status(status).json(body);
  }

  private message(body: string | object | undefined, exception: unknown): string {
    if (typeof body === 'string') return body;
    if (body && 'message' in body && typeof body.message === 'string') return body.message;
    return exception instanceof Error ? exception.message : 'La requête a échoué.';
  }

  private details(body: string | object | undefined): ApiErrorDetail[] {
    if (!body || typeof body === 'string' || !('message' in body) || !Array.isArray(body.message))
      return [];
    return body.message.map((message: unknown) => ({ message: String(message) }));
  }
}
