import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup-app.js';
import { DatabaseService } from '../src/database/database.service.js';
import { validateEnvironment } from '../src/config/environment.js';

describe('API bootstrap (e2e)', () => {
  let app: INestApplication<Server>;
  const frontendOrigin = 'http://localhost:3000';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService(
          validateEnvironment({
            NODE_ENV: 'test',
            AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
            FRONTEND_ORIGIN: frontendOrigin,
            DATABASE_URL: process.env.DATABASE_URL,
          }),
        ),
      )
      .compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the health endpoint with the explicit v1 API prefix', async () => {
    // Supertest's automatic wildcard bind can be shadowed by a different
    // loopback listener on macOS. The listener must match its IPv4 client URL.
    const server = app.getHttpServer();
    const address = server.address();
    expect(address).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect('Content-Type', /json/)
      .expect(200, { status: 'ok' });
    expect(server.address()).toEqual(address);
  });

  it('does not expose the endpoint outside the API prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it.each(['/api', '/api/v2'])(
    'does not silently serve v1 routes through %s',
    async (prefix) => {
      const routes = [
        ['post', '/auth/register'],
        ['post', '/auth/login'],
        ['post', '/auth/refresh'],
        ['post', '/auth/logout'],
        ['get', '/auth/me'],
        ['patch', '/users/me'],
        ['delete', '/users/me'],
        ['get', '/measurement-catalog'],
        ['post', '/measurements'],
        ['get', '/measurements'],
        ['get', '/measurements/00000000-0000-4000-8000-000000000001'],
        ['patch', '/measurements/00000000-0000-4000-8000-000000000001'],
        ['delete', '/measurements/00000000-0000-4000-8000-000000000001'],
        ['get', '/health'],
        ['get', '/health/ready'],
      ] as const;
      for (const [method, path] of routes) {
        await request(app.getHttpServer())
          [method](`${prefix}${path}`)
          .expect(404);
      }
    },
  );

  it('supports frontend CORS preflight requests', async () => {
    await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', frontendOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .expect('Access-Control-Allow-Origin', frontendOrigin)
      .expect(204);
  });

  it('uses one small query per readiness probe instead of the full schema scan', async () => {
    const db = app.get(DatabaseService);
    const query = vi.spyOn(db, '$queryRaw');
    try {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .get('/api/v1/health/ready')
          .expect(200, { status: 'ok', database: 'ok' });
      }
      expect(query).toHaveBeenCalledTimes(3);
      query.mockRejectedValueOnce(new Error('private connection failure'));
      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503, { status: 'unavailable', database: 'unavailable' });
    } finally {
      query.mockRestore();
    }
  });

  it('still detects a missing account column even though schema CTEs read no rows', async () => {
    expect(
      new URL(process.env.DATABASE_URL!).searchParams.get('schema'),
    ).toMatch(/^test_/);
    const db = app.get(DatabaseService);
    await db.$executeRaw`ALTER TABLE ${db.table('users')} RENAME COLUMN updated_at TO readiness_test_updated_at`;
    try {
      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503, { status: 'unavailable', database: 'unavailable' });
    } finally {
      await db.$executeRaw`ALTER TABLE ${db.table('users')} RENAME COLUMN readiness_test_updated_at TO updated_at`;
    }
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200, { status: 'ok', database: 'ok' });
  });

  it('fails app initialization when the configured database cannot be connected to', async () => {
    const databaseUrl = new URL(
      app.get(ConfigService).getOrThrow<string>('DATABASE_URL'),
    );
    databaseUrl.pathname = `/unavailable_${randomUUID().replaceAll('-', '')}`;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService(
          validateEnvironment({
            NODE_ENV: 'test',
            AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
            DATABASE_URL: databaseUrl.toString(),
          }),
        ),
      )
      .compile();
    const unavailableApp = module.createNestApplication();
    configureApp(unavailableApp);
    try {
      // Avoid dumping the application (including its config) on regression.
      await expect(unavailableApp.init().then(() => undefined)).rejects.toThrow(
        'Database connection failed. Check DATABASE_URL and PostgreSQL availability.',
      );
    } finally {
      await unavailableApp.close();
    }
  });

  it('returns 503 without connection details when readiness fails', async () => {
    const readiness = vi
      .spyOn(app.get(DatabaseService), 'isReady')
      .mockResolvedValueOnce(false);
    try {
      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503, { status: 'unavailable', database: 'unavailable' });
    } finally {
      readiness.mockRestore();
    }
  });
});
