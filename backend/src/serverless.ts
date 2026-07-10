// Netlify Functions entry point for the NestJS API.
//
// IMPORTANT: this file must be compiled by `tsc` (npm run build), NOT
// bundled directly from source by Netlify's esbuild function bundler.
// esbuild does not implement TypeScript's `emitDecoratorMetadata`, which
// Nest's dependency injection relies on to resolve constructor parameter
// types (@Injectable/@Module/@Controller). tsconfig.build.json has
// emitDecoratorMetadata enabled, so `npm run build` produces dist/serverless.js
// with the metadata already baked in as plain JS — that compiled output is
// what backend/netlify/functions/api.ts re-exports and what esbuild bundles.
//
// Business logic is untouched: this wraps the exact same Nest bootstrap as
// main.ts (same middleware, pipes, filters, interceptors, global prefix and
// versioning) behind serverless-http instead of app.listen(), because
// Netlify Functions are request/response handlers, not long-running servers.
//
// The Nest app (and its TypeORM connection pool + Redis client) is built
// once and cached across warm invocations of the same function container.
import 'reflect-metadata';
import serverlessHttp from 'serverless-http';
import { NestFactory, Reflector } from '@nestjs/core';
import {
  ValidationPipe,
  VersioningType,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ContextMiddleware } from './common/context/context.middleware';

type ServerlessHandler = ReturnType<typeof serverlessHttp>;

// The path Netlify invokes this function under; must match netlify.toml's
// redirect target so serverless-http strips it back to the /api/v1/... path
// that the Nest app (setGlobalPrefix('api') + URI versioning) expects.
const FUNCTION_BASE_PATH = '/.netlify/functions/api';

async function buildHandler(): Promise<ServerlessHandler> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService) as ConfigService<AppConfig, true>;

  // Same AsyncLocalStorage request-context wiring as main.ts.
  const ctx = new ContextMiddleware();
  app.use((req: any, res: any, next: () => void) => ctx.use(req, res, next));

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: config.get('corsOrigins', { infer: true }),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());

  // init(), not listen() — Netlify's runtime owns the actual HTTP socket.
  await app.init();

  const expressInstance = app.getHttpAdapter().getInstance();
  return serverlessHttp(expressInstance, { basePath: FUNCTION_BASE_PATH });
}

let handlerPromise: Promise<ServerlessHandler> | null = null;

export async function handler(event: any, context: any) {
  // Let Node's event loop drain naturally on the *next* invocation instead
  // of waiting on open handles (DB/Redis sockets) this invocation — those
  // are meant to stay open for reuse by the next warm call.
  context.callbackWaitsForEmptyEventLoop = false;

  if (!handlerPromise) {
    handlerPromise = buildHandler();
  }

  try {
    const h = await handlerPromise;
    return await h(event, context);
  } catch (err) {
    // A cold-start failure (e.g. DB unreachable) must not poison future
    // invocations with a permanently-rejected cached promise.
    handlerPromise = null;
    // TEMP DIAGNOSTIC: Netlify's own deploy/function log viewer is
    // currently down, so mirror any crash detail to an external log-drop
    // to be read back afterwards. Purely additive — does not change any
    // request/response behavior, just best-effort logging on failure.
    try {
      const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
      await fetch('https://ntfy.sh/arka-erp-diag-x7q2k9', {
        method: 'POST',
        headers: { Title: 'arka-erp function crash' },
        body: msg.slice(0, 3500),
      });
    } catch {
      // never let diagnostic logging mask the real error
    }
    throw err;
  }
}
