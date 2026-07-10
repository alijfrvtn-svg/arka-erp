import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseService } from '../common/database/database.service';
import { REDIS } from '../common/redis/redis.module';
import { Public } from '../common/auth/decorators';
import { RequirePermissions } from '../common/auth/decorators';

@Injectable()
export class HealthService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async liveness() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  }

  async readiness() {
    const checks: Record<string, { status: 'up' | 'down'; detail?: string }> = {};

    try {
      const t0 = Date.now();
      await this.db.query('SELECT 1');
      checks.database = { status: 'up', detail: `${Date.now() - t0}ms` };
    } catch (e) {
      checks.database = { status: 'down', detail: (e as Error).message };
    }

    try {
      const pong = await this.redis.ping();
      checks.redis = { status: pong === 'PONG' ? 'up' : 'down' };
    } catch (e) {
      checks.redis = { status: 'down', detail: (e as Error).message };
    }

    const mem = process.memoryUsage();
    checks.memory = {
      status: mem.heapUsed < 1024 * 1024 * 1024 ? 'up' : 'down',
      detail: `heap ${(mem.heapUsed / 1048576).toFixed(0)}MB / rss ${(mem.rss / 1048576).toFixed(0)}MB`,
    };

    const ok = Object.values(checks).every((c) => c.status === 'up');
    return { status: ok ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() };
  }

  /** Ops view: pool stats, audit-chain integrity, backup marker. */
  async system() {
    const [chain] = await this.db.query('SELECT count(*)::int AS broken FROM arka.fn_verify_audit_chain()');
    const [conns] = await this.db.query(
      `SELECT count(*)::int AS active FROM pg_stat_activity WHERE datname = current_database()`,
    );
    const [dbsize] = await this.db.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
    );
    return {
      auditChainIntact: (chain?.broken ?? 0) === 0,
      dbConnections: conns?.active ?? null,
      databaseSize: dbsize?.size ?? null,
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }
}

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  live() {
    return this.health.liveness();
  }

  @Public()
  @Get('ready')
  ready() {
    return this.health.readiness();
  }

  @Get('system')
  @RequirePermissions('system.admin')
  system() {
    return this.health.system();
  }
}

@Module({
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
