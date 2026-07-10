import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import {
  Logger,
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

console.log('DIAG: main.ts module loaded');

async function bootstrap(): Promise<void> {
  console.log('DIAG: bootstrap start');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  console.log('DIAG: nest app created');
  const config = app.get(ConfigService) as ConfigService<AppConfig, true>;
  const logger = new Logger('Bootstrap');

  // Establish the AsyncLocalStorage request scope before anything else runs.
  const ctx = new ContextMiddleware();
  app.use((req: any, res: any, next: () => void) => ctx.use(req, res, next));

  app.use(
    helmet({
      contentSecurityPolicy: false, // API only; the SPA sets its own CSP
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

  app.enableShutdownHooks();

  const port = config.get('port', { infer: true });
  console.log('DIAG: before listen, port=', port);
  await app.listen(port, '0.0.0.0');
  console.log('DIAG: after listen');
  logger.log(`Arka ERP API (issuer: ${config.get('legalIssuer', { infer: true })}) listening on :${port}`);
  logger.log(`Base URL: http://localhost:${port}/api/v1  •  Health: /api/v1/health`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
