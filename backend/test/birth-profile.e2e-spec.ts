import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { configureApp } from '../src/setup-app.js';

describe('date-only profile against PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const ids: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
  });
  beforeEach(async () => {
    await database.authRateLimit.deleteMany();
  });
  afterAll(async () => {
    await database?.user.deleteMany({ where: { id: { in: ids } } });
    await app?.close();
  });
  async function register(dateOfBirth?: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `birth-${randomUUID()}@example.test`,
        password: 'birthday-test-password-2026',
        ...(dateOfBirth ? { dateOfBirth } : {}),
      })
      .expect(201);
    const account = response.body as {
      user: { id: string };
      access_token: string;
    };
    ids.push(account.user.id);
    return account;
  }
  const read = (token: string) =>
    request(app.getHttpServer())
      .get('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${token}`);
  const patch = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Protection', '1')
      .send(body);
  it('keeps old accounts nullable, onboarding independent, fills only through explicit profile without revoking sessions', async () => {
    const account = await register();
    await read(account.access_token).expect(200, {
      dateOfBirth: null,
      currentAge: null,
    });
    const measurement = await request(app.getHttpServer())
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .set('Idempotency-Key', randomUUID())
      .send({
        measuredOn: '2026-09-01',
        ageAtMeasurement: 25,
        catalogVersion: 'nfa100-2026-09-24',
        items: [
          { measurementCode: 'body_fat_percentage', value: '25.1', unit: '%' },
        ],
      })
      .expect(201);
    const before = await database.measurement.findUniqueOrThrow({
      where: { id: (measurement.body as { id: string }).id },
      include: { items: true },
    });
    const sessions = await database.authSession.findMany({
      where: { userId: account.user.id },
    });
    const response = await patch(account.access_token, {
      dateOfBirth: '2000-02-29',
    }).expect(200);
    expect(response.body).toMatchObject({ dateOfBirth: '2000-02-29' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      await database.authSession.findMany({
        where: { userId: account.user.id },
      }),
    ).toEqual(sessions);
    expect(
      await database.measurement.findUniqueOrThrow({
        where: { id: before.id },
        include: { items: true },
      }),
    ).toEqual(before);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${account.access_token}`)
      .expect(200);
    expect(me.body).toMatchObject({
      isOnboarded: true,
      dateOfBirth: '2000-02-29',
      currentCurriculum: null,
    });
    expect(
      await database.userCurriculumAssignment.count({
        where: { userId: account.user.id },
      }),
    ).toBe(0);
  });
  it('stores date-only birthday at signup and enforces own profile, date validity, CSRF and strict fields', async () => {
    const account = await register('2000-01-01');
    const other = await register('1990-01-01');
    expect((await read(account.access_token).expect(200)).body).toMatchObject({
      dateOfBirth: '2000-01-01',
    });
    for (const body of [
      { dateOfBirth: '2025-02-29' },
      { dateOfBirth: '9999-01-01' },
      { dateOfBirth: null },
      { dateOfBirth: '2001-01-01', userId: other.user.id },
      { email: 'wrong@example.test' },
    ])
      await patch(account.access_token, body).expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/users/me/profile')
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${account.access_token}`)
      .send({ dateOfBirth: '2001-01-01' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${other.user.id}/profile`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .send({ dateOfBirth: '2001-01-01' })
      .expect(404);
    expect((await read(other.access_token).expect(200)).body).toMatchObject({
      dateOfBirth: '1990-01-01',
    });
    const types = await database.$queryRaw<
      Array<{ data_type: string }>
    >`SELECT pg_typeof(date_of_birth)::text AS data_type FROM ${database.table('users')} WHERE id = ${account.user.id}::uuid`;
    expect(types).toEqual([{ data_type: 'date' }]);
  });
});
