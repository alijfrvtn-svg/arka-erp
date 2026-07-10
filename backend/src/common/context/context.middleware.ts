import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContextStore } from './request-context';

/**
 * Establishes the AsyncLocalStorage scope for the whole request. User identity
 * is filled in later (once the JWT guard resolves it) via the context
 * interceptor; here we capture the client IP and a correlation id.
 */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void): void {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      undefined;
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', requestId);
    RequestContextStore.run({ ip, requestId }, () => next());
  }
}
