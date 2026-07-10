import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const r = config.get('redis', { infer: true });
        const common = {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: (times: number) => Math.min(times * 200, 2000),
        };
        // Managed Redis (e.g. Railway) usually exposes one connection URL.
        if (r.url) return new Redis(r.url, { ...common, tls: r.tls ? {} : undefined });
        return new Redis({
          host: r.host,
          port: r.port,
          password: r.password,
          tls: r.tls ? {} : undefined,
          ...common,
        });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy() {
    try {
      this.redis.disconnect();
    } catch {
      /* noop */
    }
  }
}
