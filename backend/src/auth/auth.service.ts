import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppConfig } from '../config/configuration';
import { DatabaseService } from '../common/database/database.service';
import { UsersService, UserRow } from '../users/users.service';
import { EnvelopeService } from '../common/crypto/envelope.service';
import { PasswordService } from '../common/crypto/password.service';
import { MfaService } from './mfa.service';
import { AccessTokenPayload } from '../common/auth/auth.types';

// A well-formed Argon2id hash used only to keep timing steady on unknown users.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Qwv1m4o0m8b2m0m8b2m0m8b2m0m8b2m0m8b2m0m8b2A';

export interface IssuedTokens {
  accessToken: string;
  accessExpiresIn: string;
  refreshToken: string; // raw — set as HttpOnly cookie by the controller
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
    private readonly users: UsersService,
    private readonly envelope: EnvelopeService,
    private readonly password: PasswordService,
    private readonly mfa: MfaService,
  ) {}

  // ---- password hashing -----------------------------------------------------
  hashPassword(plain: string): Promise<string> {
    return this.password.hash(plain);
  }

  private verifyPassword(hashStr: string, plain: string): Promise<boolean> {
    return this.password.verify(hashStr, plain);
  }

  private sha256(v: string): Buffer {
    return createHash('sha256').update(v).digest();
  }

  // ---- login ----------------------------------------------------------------
  async validateUser(email: string, password: string): Promise<UserRow> {
    const user = await this.users.findByEmail(email);
    // Constant-ish work even when user missing to blunt enumeration/timing.
    if (!user) {
      await this.password.verify(DUMMY_HASH, password);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.is_active) throw new ForbiddenException('Account disabled');
    if (user.locked_until && user.locked_until > new Date()) {
      throw new ForbiddenException('Account temporarily locked, try again later');
    }

    const ok = await this.verifyPassword(user.password_hash, password);
    if (!ok) {
      await this.users.registerFailedLogin(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.users.registerSuccessfulLogin(user.id);
    return user;
  }

  // ---- token issuance -------------------------------------------------------
  async issueTokens(user: UserRow, userAgent?: string, ip?: string, familyId?: string): Promise<IssuedTokens> {
    const jwtCfg = this.config.get('jwt', { infer: true });
    const perms = await this.users.effectivePermissions(user.id, user.role);

    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.full_name,
      perms,
      mfa: user.mfa_enabled,
      typ: 'access',
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: jwtCfg.accessSecret,
      expiresIn: jwtCfg.accessTtl as any, // '15m' style string
      issuer: jwtCfg.issuer,
    });

    const raw = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + jwtCfg.refreshTtlDays * 86400_000);
    const fam = familyId ?? randomUUID(); // family_id is a UUID; reuse on rotation
    await this.db.query(
      `INSERT INTO arka.refresh_tokens (user_id, token_hash, family_id, user_agent, client_ip, expires_at)
       VALUES ($1, $2, $3::uuid, $4, $5, $6)`,
      [user.id, this.sha256(raw), fam, userAgent ?? null, ip ?? null, expiresAt],
    );

    return { accessToken, accessExpiresIn: jwtCfg.accessTtl, refreshToken: raw, refreshExpiresAt: expiresAt };
  }

  // ---- refresh rotation with reuse detection --------------------------------
  async rotateRefresh(rawToken: string, userAgent?: string, ip?: string): Promise<IssuedTokens> {
    const tokenHash = this.sha256(rawToken);
    const rows = await this.db.query<any>(
      `SELECT id, user_id, family_id, revoked_at, expires_at
         FROM arka.refresh_tokens WHERE token_hash = $1 LIMIT 1`,
      [tokenHash],
    );
    const rec = rows[0];
    if (!rec) throw new UnauthorizedException('Invalid refresh token');

    if (rec.revoked_at) {
      // Reuse of a rotated token → compromise. Nuke the whole family.
      await this.db.query(
        `UPDATE arka.refresh_tokens SET revoked_at = now()
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [rec.family_id],
      );
      throw new UnauthorizedException('Refresh token reuse detected — session revoked');
    }
    if (new Date(rec.expires_at) < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.users.findById(rec.user_id);
    if (!user || !user.is_active) throw new UnauthorizedException('User not available');

    // Issue the replacement first, then revoke+link the old one.
    const issued = await this.issueTokens(user, userAgent, ip, rec.family_id);
    const newHash = this.sha256(issued.refreshToken);
    await this.db.query(
      `UPDATE arka.refresh_tokens
          SET revoked_at = now(),
              replaced_by = (SELECT id FROM arka.refresh_tokens WHERE token_hash = $2)
        WHERE id = $1`,
      [rec.id, newHash],
    );
    return issued;
  }

  async revokeRefresh(rawToken: string): Promise<void> {
    await this.db.query(
      `UPDATE arka.refresh_tokens SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [this.sha256(rawToken)],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE arka.refresh_tokens SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  // ---- MFA / step-up --------------------------------------------------------
  async beginMfaEnrollment(userId: string, email: string): Promise<{ otpauthUrl: string; qr: string }> {
    const secret = this.mfa.generateSecret();
    const enc = this.envelope.encrypt(secret)!;
    await this.users.setMfaSecret(userId, enc);
    const url = this.mfa.otpauthUrl(email, secret);
    return { otpauthUrl: url, qr: await this.mfa.qrDataUrl(url) };
  }

  async activateMfa(userId: string, token: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.mfa_secret_enc) throw new ForbiddenException('No pending MFA enrollment');
    const secret = this.envelope.decrypt(user.mfa_secret_enc);
    if (!secret || !this.mfa.verify(token, secret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.users.enableMfa(userId);
  }

  /** Verify a TOTP and, on success, mint a short-lived step-up token. */
  async stepUp(userId: string, token: string): Promise<{ stepUpToken: string; expiresIn: string }> {
    const user = await this.users.findById(userId);
    if (!user?.mfa_enabled || !user.mfa_secret_enc) {
      throw new ForbiddenException('MFA is not enabled for this account');
    }
    const secret = this.envelope.decrypt(user.mfa_secret_enc);
    if (!secret || !this.mfa.verify(token, secret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    const jwtCfg = this.config.get('jwt', { infer: true });
    const stepUpToken = await this.jwt.signAsync(
      { sub: userId, typ: 'stepup' },
      { secret: jwtCfg.stepUpSecret, expiresIn: jwtCfg.stepUpTtl as any, issuer: jwtCfg.issuer },
    );
    return { stepUpToken, expiresIn: jwtCfg.stepUpTtl };
  }

  /** Verify a TOTP for a user row (used by the login MFA challenge). */
  verifyTotpForUser(user: UserRow, code: string): boolean {
    if (!user.mfa_enabled || !user.mfa_secret_enc) return false;
    const secret = this.envelope.decrypt(user.mfa_secret_enc);
    return !!secret && this.mfa.verify(code, secret);
  }

  /** Turn MFA off after confirming a current TOTP code. */
  async disableMfa(userId: string, code: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.mfa_enabled) throw new ForbiddenException('MFA is not enabled');
    if (!this.verifyTotpForUser(user, code)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.users.clearMfa(userId);
  }

  /** Self-service password change (requires the current password). */
  async changeOwnPassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');
    if (!(await this.verifyPassword(user.password_hash, current))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const hash = await this.password.hash(next);
    await this.users.setPasswordHash(userId, hash);
    // Invalidate every existing session for safety.
    await this.revokeAllForUser(userId);
  }
}
