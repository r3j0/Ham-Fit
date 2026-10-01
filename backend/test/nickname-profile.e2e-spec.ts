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

describe('nickname signup and profile against PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const tag = `nickname-${randomUUID()}-`;
  const password = 'nickname-test-password-2026';
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
    await database?.user.deleteMany({ where: { email: { startsWith: tag } } });
    await app?.close();
  });

  const post = (path: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/${path}`)
      .set('X-CSRF-Protection', '1');
  const read = (token: string, path = '/api/v1/users/me/profile') =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  const patch = (token: string, body: unknown) =>
    request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Protection', '1')
      .send(body as object);

  async function register(profile: Record<string, unknown> = {}) {
    const response = await post('register')
      .send({
        email: `${tag}${randomUUID()}@example.test`,
        password,
        ...profile,
      })
      .expect(201);
    const body = response.body as {
      user: { id: string; email: string };
      access_token: string;
    };
    return { ...body, response };
  }

  it('stores normalized duplicate nicknames at signup and reads them after login and refresh', async () => {
    const account = await register({
      nickname: `  ${'운동친구'.normalize('NFD')}  `,
      dateOfBirth: '2000-02-29',
    });
    const other = await register({ nickname: '운동친구' });
    expect(other.user.id).not.toBe(account.user.id);
    expect(await database.user.count({ where: { nickname: '운동친구' } })).toBe(
      2,
    );
    expect(Object.keys(account.user).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'updated_at',
    ]);
    const profile = await read(account.access_token).expect(200);
    expect(profile.body).toMatchObject({
      nickname: '운동친구',
      dateOfBirth: '2000-02-29',
    });
    expect(profile.headers['cache-control']).toBe('no-store');
    expect(
      (await read(account.access_token, '/api/v1/auth/me').expect(200)).body,
    ).toMatchObject({
      nickname: '운동친구',
      isOnboarded: false,
      currentCurriculum: null,
    });

    const login = await post('login')
      .send({ email: account.user.email, password })
      .expect(200);
    const loggedIn = login.body as { user: object; access_token: string };
    expect(Object.keys(loggedIn.user).sort()).toEqual(
      Object.keys(account.user).sort(),
    );
    expect((await read(loggedIn.access_token).expect(200)).body).toMatchObject({
      nickname: '운동친구',
    });
    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const refreshed = await post('refresh')
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    const refreshedBody = refreshed.body as {
      user: object;
      access_token: string;
    };
    expect(Object.keys(refreshedBody.user).sort()).toEqual(
      Object.keys(account.user).sort(),
    );
    expect(
      (await read(refreshedBody.access_token).expect(200)).body,
    ).toMatchObject({ nickname: '운동친구' });
    const legacy = await register();
    await read(legacy.access_token).expect(200, {
      nickname: null,
      dateOfBirth: null,
      currentAge: null,
    });
    expect(
      (await patch(legacy.access_token, { nickname: '새친구' }).expect(200))
        .body,
    ).toEqual({ nickname: '새친구', dateOfBirth: null, currentAge: null });
  });

  it('updates only supplied profile fields and preserves sessions, measurements and account settings', async () => {
    const account = await register({
      nickname: '운동친구',
      dateOfBirth: '2000-02-29',
    });
    const other = await register({
      nickname: '다른친구',
      dateOfBirth: '1990-01-01',
    });
    await request(app.getHttpServer())
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .set('Idempotency-Key', randomUUID())
      .send({
        measuredOn: '2026-09-01',
        ageAtMeasurement: 26,
        catalogVersion: 'nfa100-2026-09-24',
        items: [
          { measurementCode: 'body_fat_percentage', value: '25.1', unit: '%' },
        ],
      })
      .expect(201);
    const preserved = () =>
      database.user.findUniqueOrThrow({
        where: { id: account.user.id },
        select: {
          id: true,
          email: true,
          password: true,
          createdAt: true,
          sessions: { include: { refreshTokens: true } },
          preference: true,
          currency: true,
          measurements: { include: { items: true } },
          curriculumAssignments: true,
        },
      });
    const before = await preserved();
    const changed = await patch(account.access_token, {
      nickname: '  Health_100  ',
    }).expect(200);
    expect(changed.body).toMatchObject({
      nickname: 'Health_100',
      dateOfBirth: '2000-02-29',
    });
    expect(changed.headers['set-cookie']).toBeUndefined();
    expect(changed.headers['cache-control']).toBe('no-store');
    expect(
      (
        await patch(account.access_token, { dateOfBirth: '2001-01-01' }).expect(
          200,
        )
      ).body,
    ).toMatchObject({ nickname: 'Health_100', dateOfBirth: '2001-01-01' });
    expect(
      (
        await patch(account.access_token, {
          nickname: '다른친구',
          dateOfBirth: '2002-02-02',
        }).expect(200)
      ).body,
    ).toMatchObject({ nickname: '다른친구', dateOfBirth: '2002-02-02' });

    for (const body of [
      {},
      { nickname: null },
      { nickname: ' ' },
      { nickname: '불가', dateOfBirth: '2001-02-29' },
      { nickname: '공 백', dateOfBirth: '2003-03-03' },
      { nickname: '다른계정', userId: other.user.id },
      { nickname: '새이름', email: 'wrong@example.test' },
    ])
      await patch(account.access_token, body).expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/users/me/profile')
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${account.access_token}`)
      .send({ nickname: '새이름' })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .set('Origin', 'https://untrusted.example.test')
      .send({ nickname: '새이름' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${other.user.id}/profile`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .send({ nickname: '새이름' })
      .expect(404);
    expect((await read(account.access_token).expect(200)).body).toMatchObject({
      nickname: '다른친구',
      dateOfBirth: '2002-02-02',
    });
    expect((await read(other.access_token).expect(200)).body).toMatchObject({
      nickname: '다른친구',
      dateOfBirth: '1990-01-01',
    });
    expect(await preserved()).toEqual(before);
    expect(
      (await read(account.access_token, '/api/v1/auth/me').expect(200)).body,
    ).toMatchObject({ nickname: '다른친구', isOnboarded: true });
  });

  it('rejects invalid signup nicknames before creating an account and enforces database constraints', async () => {
    for (const nickname of [
      null,
      123,
      {},
      [],
      '',
      ' ',
      '가',
      '가'.repeat(21),
      '공 백',
      '<script>',
      '운동\n친구',
    ]) {
      const email = `${tag}${randomUUID()}@example.test`;
      const response = await post('register')
        .send({ email, password, nickname })
        .expect(400);
      expect(response.body).toMatchObject({
        code: 'INVALID_NICKNAME',
        errors: [{ field: 'nickname' }],
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await database.user.findUnique({ where: { email } })).toBeNull();
    }
    const account = await register({ nickname: '가'.repeat(20) });
    for (const nickname of [
      '',
      '가',
      '가'.repeat(21),
      '공 백',
      '운동\n친구',
      '운동친구\n',
    ])
      await expect(
        database.user.update({
          where: { id: account.user.id },
          data: { nickname },
        }),
      ).rejects.toThrow();
    expect((await read(account.access_token).expect(200)).body).toMatchObject({
      nickname: '가'.repeat(20),
    });
  });
});
