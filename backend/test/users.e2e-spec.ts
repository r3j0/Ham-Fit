import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { validateEnvironment } from '../src/config/environment.js';
import { CurriculaService } from '../src/curricula/curricula.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { configureApp } from '../src/setup-app.js';
import { observeClientQueries } from './helpers/pg-queries.js';

const password = 'user integration test password';
const version = 'nfa100-2026-09-19';
type Account = {
  user: { id: string; email: string };
  access_token: string;
  cookie: string;
};
type Profile = {
  id: string;
  isOnboarded: boolean;
  currency: { balance: number };
  currentCurriculum: { id: string; status: string } | null;
};

describe('User profile and permanent deletion against PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let owner: Account;
  let other: Account;
  let curriculumCountBeforeRegistration: number;
  const ids: string[] = [];
  const definitionIds: string[] = [];
  let afterMeasurementRead: (() => Promise<unknown>) | undefined;
  let observedQueries: string[] | undefined;
  // oxlint-disable-next-line typescript/unbound-method
  const connect = PrismaPg.prototype.connect;
  const connectionSpy = vi.spyOn(PrismaPg.prototype, 'connect');

  beforeAll(async () => {
    connectionSpy.mockImplementation(async function (this: PrismaPg) {
      const adapter = await connect.call(this);
      const intercept = (target: Pick<typeof adapter, 'queryRaw'>) => {
        const queryRaw = target.queryRaw.bind(target);
        target.queryRaw = async (query) => {
          observedQueries?.push(query.sql);
          const result = await queryRaw(query);
          if (
            afterMeasurementRead &&
            query.sql.startsWith('SELECT') &&
            /FROM "[^"]+"\."measurements"/.test(query.sql)
          ) {
            const run = afterMeasurementRead;
            afterMeasurementRead = undefined;
            await run();
          }
          return result;
        };
      };
      intercept(adapter);
      const start = adapter.startTransaction.bind(adapter);
      adapter.startTransaction = async (...args) => {
        const tx = await start(...args);
        intercept(tx);
        return tx;
      };
      return adapter;
    });
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
    curriculumCountBeforeRegistration =
      await database.workoutCurriculum.count();
    owner = await register();
    other = await register();
  });

  beforeEach(async () => {
    afterMeasurementRead = undefined;
    observedQueries = undefined;
    await database.authRateLimit.deleteMany();
    await database.measurement.deleteMany({ where: { userId: owner.user.id } });
  });

  afterAll(async () => {
    try {
      await database?.user.deleteMany({ where: { id: { in: ids } } });
      await database?.workoutCurriculum.deleteMany({
        where: { id: { in: definitionIds } },
      });
      await app?.close();
    } finally {
      connectionSpy.mockRestore();
    }
  });

  async function register() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({ email: `users-${randomUUID()}@example.test`, password })
      .expect(201);
    const account = response.body as Account;
    account.cookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    ids.push(account.user.id);
    return account;
  }
  const me = (account = owner) =>
    request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${account.access_token}`);
  const remove = (account: Account, input = { password }) =>
    request(app.getHttpServer())
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .send(input);
  async function measurement(
    account = owner,
    measuredOn = '2026-09-17',
    code = 'height',
    value = '165',
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        catalogVersion: version,
        measuredOn,
        ageAtMeasurement: 25,
        items: [
          {
            measurementCode: code,
            value,
            unit: code === 'weight' ? 'kg' : 'cm',
          },
        ],
      })
      .expect(201);
    return response.body as {
      id: string;
      items: unknown[];
      missingMeasurementCodes: string[];
    };
  }
  const removeMeasurement = (id: string) =>
    request(app.getHttpServer())
      .delete(`/api/v1/measurements/${id}`)
      .set('Authorization', `Bearer ${owner.access_token}`)
      .set('If-Match', '"1"')
      .expect(204);

  it('initializes stored currency and exposes only real empty states without loading details in authentication', async () => {
    const observed = await observeClientQueries(async () => me().expect(200));
    expect(observed.overlaps).toBe(0);
    const response = observed.value;
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      id: owner.user.id,
      email: owner.user.email,
      isOnboarded: false,
      currency: { balance: 0 },
      currentCurriculum: null,
      dateOfBirth: null,
      nickname: null,
      currentAge: null,
    });
    expect(Object.keys(response.body as object).sort()).toEqual(
      [
        'id',
        'email',
        'created_at',
        'updated_at',
        'isOnboarded',
        'currency',
        'currentCurriculum',
        'dateOfBirth',
        'nickname',
        'currentAge',
      ].sort(),
    );
    expect(
      await database.userCurrency.findUnique({
        where: { userId: owner.user.id },
      }),
    ).toMatchObject({ balance: 0 });
    observedQueries = [];
    await app.get(AuthService).authenticate(`Bearer ${owner.access_token}`);
    expect(observedQueries.join('\n')).not.toMatch(
      /"(?:measurements|measurement_items|user_fitness_goals|user_curriculum_assignments|user_currencies)"/,
    );
    observedQueries = undefined;
    expect(await database.workoutCurriculum.count()).toBe(
      curriculumCountBeforeRegistration,
    );
  });

  it('does not expose discarded profile fields or fitness goal routes', async () => {
    const response = await me().expect(200);
    for (const field of [
      'preferredExercises',
      'exerciseGoals',
      'currentFitness',
      'fitnessGoals',
    ])
      expect(response.body).not.toHaveProperty(field);
    for (const [method, path] of [
      ['get', '/users/me/fitness-goals'],
      ['post', '/users/me/fitness-goals'],
      ['get', `/users/me/fitness-goals/${randomUUID()}`],
      ['patch', `/users/me/fitness-goals/${randomUUID()}`],
      ['delete', `/users/me/fitness-goals/${randomUUID()}`],
    ] as const)
      await request(app.getHttpServer())
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${owner.access_token}`)
        .set('X-CSRF-Protection', '1')
        .expect(404);
  });

  it('distinguishes deleting some records from deleting the last record and reads one concurrent snapshot', async () => {
    expect(((await me()).body as Profile).isOnboarded).toBe(false);
    const first = await measurement();
    expect(((await me()).body as Profile).isOnboarded).toBe(true);
    const second = await measurement(owner, '2026-09-18');
    expect(((await me()).body as Profile).isOnboarded).toBe(true);
    await removeMeasurement(first.id);
    expect(((await me()).body as Profile).isOnboarded).toBe(true);
    afterMeasurementRead = () => removeMeasurement(second.id);
    const overlapping = (await me().expect(200)).body as Profile;
    expect(overlapping.isOnboarded).toBe(true);
    expect(overlapping).not.toHaveProperty('currentFitness');
    expect((await me().expect(200)).body).toMatchObject({
      isOnboarded: false,
    });
  });

  it('does not conceal missing currency or accept a negative/duplicate balance row', async () => {
    const account = await register();
    await expect(
      database.userCurrency.create({ data: { userId: account.user.id } }),
    ).rejects.toThrow();
    await expect(
      database.userCurrency.update({
        where: { userId: account.user.id },
        data: { balance: -1 },
      }),
    ).rejects.toThrow();
    await database.userCurrency.update({
      where: { userId: account.user.id },
      data: { balance: 2147483647 },
    });
    expect((await me(account)).body).toMatchObject({
      currency: { balance: 2147483647 },
    });
    await expect(
      database.userCurrency.update({
        where: { userId: account.user.id },
        data: { balance: 2147483648 },
      }),
    ).rejects.toThrow();
    await database.userCurrency.delete({ where: { userId: account.user.id } });
    await me(account).expect(503);
    // Even this integrity failure does not disable the narrowly scoped deletion API.
    await remove(account).expect(204);
  });

  it('requires password confirmation, origin/CSRF protection, and persistent attempt limits', async () => {
    const account = await register();
    await request(app.getHttpServer())
      .delete('/api/v1/users/me')
      .send({ password })
      .expect(401);
    await request(app.getHttpServer())
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${account.access_token}`)
      .send({ password })
      .expect(403);
    await remove(account)
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    await remove(account, { password: '' }).expect(400);
    await remove(account).send({ password, userId: other.user.id }).expect(400);
    for (let i = 0; i < 5; i++)
      await remove(account, { password: 'wrong' }).expect(401);
    await remove(account).expect(429);
    await me(account).expect(200);
  });

  it.each([null, password, '$argon2id$broken'])(
    'never bypasses reauthentication for an unusable stored password',
    async (stored) => {
      const account = await register();
      await database.user.update({
        where: { id: account.user.id },
        data: { password: stored },
      });
      await remove(account).expect(401);
      await me(account).expect(200);
    },
  );

  it('does not delete when a password changes after verification', async () => {
    const account = await register();
    const passwords = app.get(PasswordService);
    const matches = passwords.matches.bind(passwords);
    const spy = vi
      .spyOn(passwords, 'matches')
      .mockImplementationOnce(async (hash, input) => {
        const result = await matches(hash, input);
        await database.user.update({
          where: { id: account.user.id },
          data: {
            password: await passwords.hash(
              'changed password during confirmation',
            ),
          },
        });
        return result;
      });
    try {
      await remove(account).expect(401);
    } finally {
      spy.mockRestore();
    }
    await me(account).expect(200);
  });

  it('rejects session creation when deletion commits during login verification', async () => {
    const account = await register();
    const passwords = app.get(PasswordService);
    const matches = passwords.matches.bind(passwords);
    const spy = vi
      .spyOn(passwords, 'matches')
      .mockImplementationOnce(async (hash, input) => {
        const valid = await matches(hash, input);
        await remove(account).expect(204);
        return valid;
      });
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({ email: account.user.email, password })
        .expect(401);
    } finally {
      spy.mockRestore();
    }
    expect(
      await database.authSession.count({ where: { userId: account.user.id } }),
    ).toBe(0);
  });

  it('atomically deletes all owned data, preserves shared definitions, and invalidates every session/token', async () => {
    const account = await register();
    const record = await measurement(account);
    const deletedRecord = await measurement(account);
    await database.measurement.delete({ where: { id: deletedRecord.id } });
    const definition = await database.workoutCurriculum.create({
      data: { name: '[TEST ONLY] One workout' },
    });
    definitionIds.push(definition.id);
    const curricula = app.get(CurriculaService);
    const first = await curricula.assign(
      account.user.id,
      definition.id,
      randomUUID(),
    );
    await curricula.complete(account.user.id, first.id);
    await curricula.assign(account.user.id, definition.id, randomUUID());
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-CSRF-Protection', '1')
      .send({ email: account.user.email, password })
      .expect(200);
    const second = login.body as Account;
    const secondCookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', secondCookie)
      .expect(200);
    const thirdCookie = (
      refreshed.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const sessions = await database.authSession.findMany({
      where: { userId: account.user.id },
    });
    const result = await remove(account).expect(204);
    const cleared = (result.headers['set-cookie'] as unknown as string[])[0];
    expect(cleared).toContain('project_health_refresh=;');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Lax');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(
      await database.user.findUnique({ where: { id: account.user.id } }),
    ).toBeNull();
    for (const count of await Promise.all([
      database.measurement.count({ where: { userId: account.user.id } }),
      database.measurementItem.count({ where: { measurementId: record.id } }),
      database.measurementCreateRequest.count({
        where: { userId: account.user.id },
      }),
      database.userCurrency.count({ where: { userId: account.user.id } }),
      database.userCurriculumAssignment.count({
        where: { userId: account.user.id },
      }),
      database.authSession.count({ where: { userId: account.user.id } }),
      database.authRefreshToken.count({
        where: { sessionId: { in: sessions.map((session) => session.id) } },
      }),
    ]))
      expect(count).toBe(0);
    expect(
      await database.measurementDefinition.count({
        where: { catalogVersion: version },
      }),
    ).toBe(19);
    expect(
      await database.workoutCurriculum.findUnique({
        where: { id: definition.id },
      }),
    ).not.toBeNull();
    for (const token of [
      account.access_token,
      second.access_token,
      (refreshed.body as Account).access_token,
    ]) {
      await me({ ...account, access_token: token }).expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/measurements')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
    for (const cookie of [account.cookie, secondCookie, thirdCookie])
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-CSRF-Protection', '1')
        .set('Cookie', cookie)
        .expect(401);
    await remove(account).expect(401);
    await me(other).expect(200);
  });

  it('allows exactly one simultaneous deletion and never leaves a usable refresh session', async () => {
    const account = await register();
    const results = await Promise.all([
      remove(account),
      remove(account),
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-CSRF-Protection', '1')
        .set('Cookie', account.cookie),
    ]);
    expect(
      results
        .slice(0, 2)
        .map((result) => result.status)
        .sort((a, b) => a - b),
    ).toEqual([204, 401]);
    expect([200, 401]).toContain(results[2].status);
    if (results[2].status === 200)
      await me({
        ...account,
        access_token: (results[2].body as Account).access_token,
      }).expect(401);
    expect(
      await database.authSession.count({ where: { userId: account.user.id } }),
    ).toBe(0);
  });

  it('clears the identical production cookie attributes on permanent deletion', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService(
          validateEnvironment({
            NODE_ENV: 'production',
            FRONTEND_ORIGIN: 'https://app.example.test',
            DATABASE_URL: process.env.DATABASE_URL,
            AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
            AUTH_COOKIE_SAME_SITE: 'none',
          }),
        ),
      )
      .compile();
    const production = module.createNestApplication();
    configureApp(production);
    await production.listen(0, '127.0.0.1');
    try {
      const registered = await request(production.getHttpServer())
        .post('/api/v1/auth/register')
        .set('X-CSRF-Protection', '1')
        .send({ email: `production-${randomUUID()}@example.test`, password })
        .expect(201);
      const account = registered.body as Account;
      ids.push(account.user.id);
      const removed = await request(production.getHttpServer())
        .delete('/api/v1/users/me')
        .set('X-CSRF-Protection', '1')
        .set('Authorization', `Bearer ${account.access_token}`)
        .send({ password })
        .expect(204);
      const cookie = (removed.headers['set-cookie'] as unknown as string[])[0];
      expect(cookie).toMatch(/^__Host-project_health_refresh=;/);
      for (const part of [
        'Secure',
        'HttpOnly',
        'SameSite=None',
        'Path=/',
        'Expires=Thu, 01 Jan 1970',
      ])
        expect(cookie).toContain(part);
      expect(cookie).not.toContain('Domain=');
    } finally {
      await production.close();
    }
  });
});
