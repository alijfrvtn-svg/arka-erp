/**
 * Central typed configuration. All secrets come from the environment; sane
 * development defaults are provided so `docker compose up` works out of the box.
 */
export interface AppConfig {
  env: string;
  port: number;
  corsOrigins: string[];
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    schema: string;
    ssl: boolean;
    poolSize: number;
    /** How many times to retry the initial connection before giving up. */
    connectAttempts: number;
    /** Per-attempt connect timeout, in ms. */
    connectTimeoutMs: number;
  };
  redis: { host: string; port: number; password?: string; tls: boolean; url?: string };
  jwt: {
    accessSecret: string;
    accessTtl: string; // e.g. '15m'
    refreshTtlDays: number;
    stepUpSecret: string;
    stepUpTtl: string; // e.g. '5m'
    issuer: string;
  };
  crypto: {
    /** 32-byte hex master key for AES-256-GCM envelope encryption of PII. */
    masterKeyHex: string;
  };
  /** Set the refresh cookie's Secure flag. Keep false for HTTP LAN/IP access;
   *  set true only when serving over HTTPS. */
  cookieSecure: boolean;
  /** 'lax' for same-site deployments (docker compose on one host); 'none'
   *  is required when the frontend (e.g. Netlify) and API (e.g. Railway)
   *  live on different domains — must be paired with cookieSecure=true. */
  cookieSameSite: 'lax' | 'none' | 'strict';
  bootstrap: {
    ceoEmail: string;
    ceoPassword: string;
    ceoName: string;
  };
  legalIssuer: string;
}

const bool = (v: string | undefined, d = false) =>
  v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:8080')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'arka_app',
    password: process.env.DB_PASSWORD ?? 'change_me_in_production',
    database: process.env.DB_NAME ?? 'arka',
    schema: process.env.DB_SCHEMA ?? 'arka',
    ssl: bool(process.env.DB_SSL, false),
    poolSize: parseInt(process.env.DB_POOL_SIZE ?? '10', 10),
    // Default (10 attempts / 10s each) matches the original docker-compose
    // behavior, where Postgres may still be starting up. On Netlify
    // Functions the whole invocation has to fit inside a much shorter
    // execution window, so these are overridden there (see netlify.toml)
    // to fail fast instead of running past the function timeout.
    connectAttempts: parseInt(process.env.DB_CONNECT_ATTEMPTS ?? '10', 10),
    connectTimeoutMs: parseInt(process.env.DB_CONNECT_TIMEOUT_MS ?? '10000', 10),
  },
  redis: {
    // Railway's Redis plugin (and most managed Redis) expose a single
    // REDIS_URL like redis://default:password@host:port. If present, it
    // takes precedence over the individual host/port/password vars below.
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
    tls: bool(process.env.REDIS_TLS, false),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '7', 10),
    stepUpSecret: process.env.JWT_STEPUP_SECRET ?? 'dev-stepup-secret-change-me',
    stepUpTtl: process.env.JWT_STEPUP_TTL ?? '5m',
    issuer: process.env.JWT_ISSUER ?? 'arka-ads-studio',
  },
  crypto: {
    masterKeyHex:
      process.env.ENVELOPE_MASTER_KEY_HEX ??
      // 32 bytes of dev key (DO NOT use in production).
      '0000000000000000000000000000000000000000000000000000000000000000',
  },
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  cookieSameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'none' | 'strict') ?? 'lax',
  bootstrap: {
    ceoEmail: process.env.BOOTSTRAP_CEO_EMAIL ?? 'ali.jafari@arka.studio',
    ceoPassword: process.env.BOOTSTRAP_CEO_PASSWORD ?? 'Arka@2026!',
    ceoName: process.env.BOOTSTRAP_CEO_NAME ?? 'Ali Jafari',
  },
  legalIssuer: process.env.LEGAL_ISSUER ?? 'Ali Jafari',
});
