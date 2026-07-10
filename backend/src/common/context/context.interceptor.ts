import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContextStore } from './request-context';
import { AuthUser } from '../auth/auth.types';

/**
 * Runs after the auth guard: copies the resolved principal into the ALS store
 * so downstream DB writes (via DatabaseService.withActor) stamp the audit log.
 */
@Injectable()
export class ContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (user) {
      RequestContextStore.set({ userId: user.id, role: user.role });
    }
    return next.handle();
  }
}
