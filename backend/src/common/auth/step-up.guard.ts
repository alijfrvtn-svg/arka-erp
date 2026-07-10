import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AuthUser, StepUpTokenPayload } from './auth.types';
import { STEP_UP_KEY } from './decorators';

/**
 * For routes marked @RequireStepUp, demand a fresh MFA step-up token in the
 * `X-StepUp-Token` header that belongs to the same principal. Enforces the
 * "TOTP only for critical actions" requirement (transfers, fiscal close…).
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requires = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requires) return true;

    const req = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    const token: string | undefined =
      req.headers['x-stepup-token'] ?? req.headers['X-StepUp-Token'];
    if (!user || !token) {
      throw new ForbiddenException('Step-up (MFA) verification required for this action');
    }
    try {
      const payload = await this.jwt.verifyAsync<StepUpTokenPayload>(token, {
        secret: this.config.get('jwt', { infer: true }).stepUpSecret,
        issuer: this.config.get('jwt', { infer: true }).issuer,
      });
      if (payload.typ !== 'stepup' || payload.sub !== user.id) {
        throw new Error('mismatch');
      }
      return true;
    } catch {
      throw new ForbiddenException('Invalid or expired step-up token');
    }
  }
}
