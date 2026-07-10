import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { DatabaseService } from '../common/database/database.service';
import { AuthService } from '../auth/auth.service';

/**
 * Idempotently provisions the CEO login account (legal issuer: Ali Jafari) on
 * first boot, using an Argon2id hash produced in the app layer. Safe to run on
 * every start — it no-ops when the account already exists.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const boot = this.config.get('bootstrap', { infer: true });

    const existing = await this.db.query(
      `SELECT id FROM arka.users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
      [boot.ceoEmail],
    );
    if (existing.length > 0) {
      this.logger.log(`CEO account already present (${boot.ceoEmail}) — skipping bootstrap`);
      return;
    }

    const hash = await this.auth.hashPassword(boot.ceoPassword);
    await this.db.query(
      `INSERT INTO arka.users (email, full_name, role, password_hash, is_active)
       VALUES ($1, $2, 'CEO', $3, true)
       ON CONFLICT DO NOTHING`,
      [boot.ceoEmail, boot.ceoName, hash],
    );
    this.logger.warn(
      `Bootstrapped CEO account ${boot.ceoEmail} — CHANGE THE DEFAULT PASSWORD immediately.`,
    );
  }
}
