import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './setup-app.js';
import { requestTiming } from './config/request-timing.js';
import { API_V1_BASE_PATH } from './config/api-version.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  if (process.env.API_REQUEST_TIMING === '1') app.use(requestTiming());
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('PORT'));
  Logger.log(
    `API listening at ${await app.getUrl()}${API_V1_BASE_PATH}`,
    'Bootstrap',
  );
}

await bootstrap();
