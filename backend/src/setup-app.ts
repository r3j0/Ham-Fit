import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express, NextFunction, Request, Response } from 'express';
import { API_PREFIX, API_V1_BASE_PATH } from './config/api-version.js';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.set(
    'trust proxy',
    config.getOrThrow<string[]>('TRUST_PROXY_CIDRS'),
  );

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI });
  app.use(
    [
      `${API_V1_BASE_PATH}/auth`,
      `${API_V1_BASE_PATH}/measurements`,
      `${API_V1_BASE_PATH}/users`,
      `${API_V1_BASE_PATH}/workouts`,
      `${API_V1_BASE_PATH}/groups`,
      `${API_V1_BASE_PATH}/notifications`,
      `${API_V1_BASE_PATH}/workout-routines`,
    ],
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
      next();
    },
  );
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_ORIGIN'),
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Protection',
      'Idempotency-Key',
      'If-Match',
    ],
    exposedHeaders: ['ETag', 'Location', 'Idempotency-Replayed', 'Retry-After'],
  });
}
