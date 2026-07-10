import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { RequestContextStore } from '../context/request-context';

/**
 * Owns the single TypeORM DataSource (a pg connection pool) and provides the
 * two access primitives used across the app:
 *   - query()      : parameterised read/one-shot statements
 *   - withActor()  : a transaction whose session GUCs (app.current_user_id …)
 *                    are set so the PostgreSQL audit triggers record WHO acted.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  public dataSource!: DataSource;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async onModuleInit(): Promise<void> {
    const db = this.config.get('db', { infer: true });
    this.dataSource = new DataSource({
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.user,
      password: db.password,
      database: db.database,
      schema: db.schema,
      ssl: db.ssl ? { rejectUnauthorized: false } : false,
      poolSize: db.poolSize,
      logging: ['error', 'warn'],
      connectTimeoutMS: 10000,
      extra: {
        // Pin the search_path for every pooled connection.
        options: `-c search_path=${db.schema},public`,
        max: db.poolSize,
        connectionTimeoutMillis: 10000,
      },
    });

    await this.retryConnect(10);
    this.logger.log(`Connected to PostgreSQL ${db.host}:${db.port}/${db.database}`);
  }

  private async retryConnect(attempts: number): Promise<void> {
    for (let i = 1; i <= attempts; i++) {
      try {
        await this.dataSource.initialize();
        return;
      } catch (err) {
        this.logger.warn(`DB connect attempt ${i}/${attempts} failed: ${(err as Error).message}`);
        if (i === attempts) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) await this.dataSource.destroy();
  }

  /** Parameterised query for reads and stored-function calls without audit actor. */
  query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  /**
   * Run work inside a transaction that has the audit session context applied,
   * so AFTER triggers capture the acting user/role/ip. Falls back to NULLs when
   * called outside a request (system jobs).
   */
  async withActor<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const ctx = RequestContextStore.get();
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT
           set_config('app.current_user_id',   $1, true),
           set_config('app.current_user_role', $2, true),
           set_config('app.client_ip',         $3, true)`,
        [ctx.userId ?? '', ctx.role ?? '', ctx.ip ?? ''],
      );
      return work(manager);
    });
  }
}
