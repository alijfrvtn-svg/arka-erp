import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AccessTokenPayload, AuthUser } from './auth.types';
import { IS_PUBLIC_KEY } from './decorators';

/** Validates the Bearer access token and attaches AuthUser to the request. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7);
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('jwt', { infer: true }).accessSecret,
        issuer: this.config.get('jwt', { infer: true }).issuer,
      });
      if (payload.typ !== 'access') throw new Error('wrong token type');
      const user: AuthUser = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        fullName: payload.name,
        permissions: payload.perms ?? [],
        mfaEnabled: payload.mfa,
      };
      req.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
