import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { AuthUser } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as reachable without a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Requires the principal to hold every listed permission. */
export const RequirePermissions = (...perms: string[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

export const STEP_UP_KEY = 'requiresStepUp';
/** Requires a fresh MFA step-up token (critical actions: transfers, closing…). */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);

/** Injects the authenticated user (or a field of it) into a handler param. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    return data && user ? user[data] : user;
  },
);
