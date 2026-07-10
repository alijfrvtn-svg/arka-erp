import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../common/database/database.service';
import { Public } from '../common/auth/decorators';
import { DB_INIT_SCRIPTS } from './db-init.sql';

/**
 * One-time, secret-protected schema bootstrap for a *fresh* Postgres
 * database. Runs database/init/*.sql (embedded verbatim, byte-for-byte, in
 * db-init.sql.ts) in order, exactly once each — every script in this
 * project is idempotent (IF NOT EXISTS / CREATE OR REPLACE), so re-running
 * this endpoint against an already-initialised database is safe and is a
 * no-op for anything that already exists.
 *
 * Guarded by SETUP_SECRET (not by user auth — there may be no users table
 * yet on a brand-new database), mirroring the pattern used for the
 * ARKA marketing site's one-time /api/admin/seed endpoint.
 */
@Controller({ path: 'admin/db-init', version: '1' })
export class DbInitController {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  async run(@Query('secret') secret?: string) {
    const expected = this.config.get<string>('SETUP_SECRET');
    if (!expected || secret !== expected) {
      return { ok: false, error: 'Unauthorized' };
    }

    const results: { file: string; ok: boolean; error?: string }[] = [];
    for (const script of DB_INIT_SCRIPTS) {
      try {
        await this.db.query(script.sql);
        results.push({ file: script.name, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ file: script.name, ok: false, error: message });
        // Stop at the first failure — later scripts depend on earlier ones.
        return { ok: false, results };
      }
    }
    return { ok: true, results };
  }
}
