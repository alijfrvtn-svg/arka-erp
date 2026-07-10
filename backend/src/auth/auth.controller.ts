import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AppConfig } from '../config/configuration';
import { AuthService, IssuedTokens } from './auth.service';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto, LoginDto, MfaTokenDto, UpdateProfileDto } from './dto/auth.dto';
import { CurrentUser, Public } from '../common/auth/decorators';
import { AuthUser } from '../common/auth/auth.types';

const REFRESH_COOKIE = 'arka_rt';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private setRefreshCookie(res: Response, tokens: IssuedTokens): void {
    // Secure flag is configurable so the app works over HTTP on a LAN/IP
    // (set COOKIE_SECURE=true only when serving over HTTPS).
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.get('cookieSecure', { infer: true }),
      sameSite: this.config.get('cookieSameSite', { infer: true }),
      path: '/',
      expires: tokens.refreshExpiresAt,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateUser(dto.email, dto.password);

    // MFA-at-login: if enabled, a valid TOTP is required to complete sign-in.
    if (user.mfa_enabled) {
      if (!dto.totp) {
        return { mfaRequired: true };
      }
      if (!this.auth.verifyTotpForUser(user, dto.totp)) {
        throw new UnauthorizedException('Invalid MFA code');
      }
    }

    const tokens = await this.auth.issueTokens(user, req.headers['user-agent'], req.ip);
    this.setRefreshCookie(res, tokens);
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.accessExpiresIn,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        mfaEnabled: user.mfa_enabled,
      },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException('No refresh token');
    const tokens = await this.auth.rotateRefresh(raw, req.headers['user-agent'], req.ip);
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.accessExpiresIn };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await this.auth.revokeRefresh(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  /** Live profile (reads the DB so name/role edits reflect immediately). */
  @Get('me')
  async me(@CurrentUser() principal: AuthUser) {
    const user = await this.users.findById(principal.id);
    if (!user) throw new UnauthorizedException('User not found');
    const permissions = await this.users.effectivePermissions(user.id, user.role);
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      mfaEnabled: user.mfa_enabled,
      permissions,
    };
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() me: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(me.id, dto);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() me: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changeOwnPassword(me.id, dto.currentPassword, dto.newPassword);
    return { changed: true };
  }

  // ---- MFA -------------------------------------------------------------------
  @Post('mfa/enroll')
  enrollMfa(@CurrentUser() user: AuthUser) {
    return this.auth.beginMfaEnrollment(user.id, user.email);
  }

  @Post('mfa/activate')
  @HttpCode(200)
  async activateMfa(@CurrentUser() user: AuthUser, @Body() dto: MfaTokenDto) {
    await this.auth.activateMfa(user.id, dto.token);
    return { activated: true };
  }

  @Post('mfa/disable')
  @HttpCode(200)
  async disableMfa(@CurrentUser() user: AuthUser, @Body() dto: MfaTokenDto) {
    await this.auth.disableMfa(user.id, dto.token);
    return { disabled: true };
  }

  @Post('step-up')
  @HttpCode(200)
  stepUp(@CurrentUser() user: AuthUser, @Body() dto: MfaTokenDto) {
    return this.auth.stepUp(user.id, dto.token);
  }
}
