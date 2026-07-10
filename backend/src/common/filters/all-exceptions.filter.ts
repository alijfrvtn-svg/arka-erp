import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RequestContextStore } from '../context/request-context';

/**
 * Uniform error envelope. Business-rule violations raised inside PostgreSQL
 * functions/triggers (unbalanced entries, SoD conflicts, closed periods…) are
 * surfaced as HTTP 422 with the DB message, so the client sees actionable text.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else {
        message = (body as any).message ?? message;
        error = (body as any).error ?? exception.name;
      }
    } else if (this.isPgError(exception)) {
      const pg = exception as any;
      // Map common Postgres SQLSTATEs to sensible HTTP codes.
      switch (pg.code) {
        case '23505': // unique_violation
          status = HttpStatus.CONFLICT;
          error = 'Conflict';
          break;
        case '23503': // foreign_key_violation
        case '23514': // check_violation
        case '22P02': // invalid_text_representation
          status = HttpStatus.BAD_REQUEST;
          error = 'BadRequest';
          break;
        case 'P0001': // raise_exception (our business rules)
        case '23P01': // exclusion_violation (overlapping fiscal periods)
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          error = 'BusinessRuleViolation';
          break;
        default:
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          error = 'DatabaseError';
      }
      message = this.cleanPgMessage(pg.message);
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status}: ${String((exception as any)?.stack ?? exception)}`);
    }

    res.status(status).json({
      statusCode: status,
      error,
      message,
      path: req.url,
      requestId: RequestContextStore.get().requestId,
      timestamp: new Date().toISOString(),
    });
  }

  private isPgError(e: unknown): boolean {
    return !!e && typeof e === 'object' && 'code' in (e as any) && typeof (e as any).code === 'string';
  }

  private cleanPgMessage(msg: string): string {
    // Strip the "arka." schema noise and leading context for readability.
    return (msg ?? 'database error').replace(/^error:\s*/i, '').trim();
  }
}
