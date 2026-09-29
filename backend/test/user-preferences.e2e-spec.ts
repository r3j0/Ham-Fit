import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import { CurriculaService } from '../src/curricula/curricula.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { RecommendationsService } from '../src/recommendations/recommendations.service.js';
import { WorkoutAlgorithm } from '../src/recommendations/workout-algorithm.js';
import { RoutineAlgorithm } from '../src/recommendations/routine-algorithm.js';
import { WorkoutRoutinesService } from '../src/recommendations/workout-routines.service.js';
import { configureApp } from '../src/setup-app.js';
import { UserPreferencesService } from '../src/users/user-preferences.service.js';

const password = 'user preferences integration password';
const path = '/api/v1/users/me/preferences';
const volumes = ['less', 'standard', 'more'] as const;
const goals = [
  'fitness_grade_improvement',
  'body_composition_management',
  'general_fitness_improvement',
] as const;
type Account = {
  user: { id: string; email: string };
  access_token: string;
  cookie: string;
};
type Preferences = {
  exerciseVolume: (typeof volumes)[number];
  exerciseGoal: (typeof goals)[number] | null;
  ownedTools: string[];
  updatedAt: string;
};

describe('Personal exercise preferences against PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const ids: string[] = [];
  const curriculumIds: string[] = [];

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
    await database?.workoutCurriculum.deleteMany({
      where: { id: { in: curriculumIds } },
    });
    await app?.close();
  });

  function asAccount(response: request.Response) {
    const account = response.body as Account;
    account.cookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    return account;
  }

  async function register() {
    const account = asAccount(
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('X-CSRF-Protection', '1')
        .send({
          email: `preferences-${randomUUID()}@example.test`,
          password,
        })
        .expect(201),
    );
    ids.push(account.user.id);
    return account;
  }

  const read = (account: Account) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${account.access_token}`);
  const patchRequest = (account: Account) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1');
  const patch = (account: Account, body: unknown) =>
    patchRequest(account).send(body as object);
  const profile = (account: Account) =>
    request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${account.access_token}`);
  const stored = (account: Account) =>
    database.userPreference.findUniqueOrThrow({
      where: { userId: account.user.id },
    });

  it('normalizes all tools as a set, preserves omitted fields, replaces and clears the list', async () => {
    const account = await register();
    const ownedTools = [
      'band',
      'dumbbell',
      'gym_ball',
      'foam_roller',
      'jump_rope',
      'step_box',
      'ball',
      'cone',
      'agility_ladder',
      'bosu',
    ];
    const saved = await patch(account, {
      ownedTools: [...ownedTools].reverse().concat('band'),
      exerciseVolume: 'more',
      exerciseGoal: 'general_fitness_improvement',
    }).expect(200);
    expect(saved.body).toMatchObject({ ownedTools });
    const row = await stored(account);
    await patch(account, { ownedTools }).expect(200, saved.body);
    await patch(account, { ownedTools: [...ownedTools].reverse() }).expect(
      200,
      saved.body,
    );
    expect(await stored(account)).toEqual(row);
    const legacy = await patch(account, { exerciseVolume: 'less' }).expect(200);
    expect(legacy.body).toMatchObject({
      ownedTools,
      exerciseGoal: 'general_fitness_improvement',
    });
    const replacement = await patch(account, {
      ownedTools: ['dumbbell'],
    }).expect(200);
    expect(replacement.body).toMatchObject({
      ownedTools: ['dumbbell'],
      exerciseVolume: 'less',
    });
    await read(account).expect(200, replacement.body);
    const cleared = await patch(account, { ownedTools: [] }).expect(200);
    expect(cleared.body).toMatchObject({ ownedTools: [] });
    await read(account).expect(200, cleared.body);
    await patch(account, { ownedTools: [] }).expect(200, cleared.body);
  });

  it.each([
    null,
    'band',
    1,
    true,
    {},
    ['none'],
    ['밴드'],
    ['barbell'],
    ['band', null],
    ['band', 1],
    [['band']],
  ])(
    'rejects invalid tools atomically with other valid changes: %j',
    async (ownedTools) => {
      const account = await register();
      await patch(account, { ownedTools: ['band'] }).expect(200);
      const before = await stored(account);
      const response = await patch(account, {
        exerciseVolume: 'more',
        exerciseGoal: 'fitness_grade_improvement',
        ownedTools,
      }).expect(400);
      expect(response.body).toMatchObject({
        errors: expect.arrayContaining([
          expect.objectContaining({
            field: expect.stringMatching(/^ownedTools/),
          }),
        ]),
      });
      expect(await stored(account)).toEqual(before);
      await patch(account, {
        exerciseVolume: 'invalid',
        ownedTools: ['dumbbell'],
      }).expect(400);
      expect(await stored(account)).toEqual(before);
    },
  );

  it('keeps concurrent volume, goal and tool edits and isolates users', async () => {
    const account = await register();
    const other = await register();
    await patch(other, { ownedTools: ['gym_ball'] }).expect(200);
    const otherBefore = await stored(other);
    const responses = await Promise.all([
      patch(account, { exerciseVolume: 'less' }),
      patch(account, { exerciseGoal: 'general_fitness_improvement' }),
      patch(account, { ownedTools: ['dumbbell', 'band'] }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await read(account).expect(200)).body).toMatchObject({
      exerciseVolume: 'less',
      exerciseGoal: 'general_fitness_improvement',
      ownedTools: ['band', 'dumbbell'],
    });
    const unchanged = await stored(account);
    const retries = await Promise.all([
      patch(account, { ownedTools: ['band', 'dumbbell'] }),
      patch(account, { ownedTools: ['dumbbell', 'band', 'band'] }),
    ]);
    expect(retries.map((r) => r.status)).toEqual([200, 200]);
    expect(retries[0].body).toEqual(retries[1].body);
    expect(await stored(account)).toEqual(unchanged);
    expect(await stored(other)).toEqual(otherBefore);
  });

  it('creates exactly one default preference with signup and returns only the public fields with a UTC timestamp', async () => {
    const startedAt = Date.now();
    const account = await register();
    const response = await read(account).expect(200);
    const body = response.body as Preferences;
    expect(body).toEqual({
      exerciseVolume: 'standard',
      exerciseGoal: null,
      ownedTools: [],
      updatedAt: expect.any(String),
    });
    expect(body.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    );
    expect(Date.parse(body.updatedAt)).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(Date.parse(body.updatedAt)).toBeLessThanOrEqual(Date.now() + 1000);
    const row = await stored(account);
    expect(row).toMatchObject({
      userId: account.user.id,
      exerciseVolume: 'standard',
      exerciseGoal: null,
    });
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(row.updatedAt.toISOString()).toBe(body.updatedAt);
    expect(
      await database.userPreference.count({
        where: { userId: account.user.id },
      }),
    ).toBe(1);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['pragma']).toBe('no-cache');
  });

  it.each(volumes)(
    'stores and re-reads exerciseVolume=%s while leaving an unset goal null',
    async (exerciseVolume) => {
      const account = await register();
      const response = await patch(account, { exerciseVolume }).expect(200);
      expect(response.body).toEqual({
        exerciseVolume,
        exerciseGoal: null,
        ownedTools: [],
        updatedAt: expect.any(String),
      });
      await read(account).expect(200, response.body);
      expect(await stored(account)).toMatchObject({
        exerciseVolume,
        exerciseGoal: null,
      });
    },
  );

  it.each(goals)(
    'stores and re-reads exerciseGoal=%s without changing the selected volume',
    async (exerciseGoal) => {
      const account = await register();
      await patch(account, { exerciseVolume: 'less' }).expect(200);
      const response = await patch(account, { exerciseGoal }).expect(200);
      expect(response.body).toEqual({
        exerciseVolume: 'less',
        exerciseGoal,
        ownedTools: [],
        updatedAt: expect.any(String),
      });
      await read(account).expect(200, response.body);
      expect(await stored(account)).toMatchObject({
        exerciseVolume: 'less',
        exerciseGoal,
      });
    },
  );

  it('updates both fields atomically, then preserves the omitted goal on a volume-only update', async () => {
    const account = await register();
    const both = await patch(account, {
      exerciseVolume: 'more',
      exerciseGoal: 'fitness_grade_improvement',
    }).expect(200);
    expect(both.body).toEqual({
      exerciseVolume: 'more',
      exerciseGoal: 'fitness_grade_improvement',
      ownedTools: [],
      updatedAt: expect.any(String),
    });
    await read(account).expect(200, both.body);
    const volume = await patch(account, { exerciseVolume: 'standard' }).expect(
      200,
    );
    expect(volume.body).toEqual({
      exerciseVolume: 'standard',
      exerciseGoal: 'fitness_grade_improvement',
      ownedTools: [],
      updatedAt: expect.any(String),
    });
    await read(account).expect(200, volume.body);
  });

  it('keeps updatedAt unchanged for identical partial or complete retries, including the initial null goal', async () => {
    const account = await register();
    const initial = await read(account).expect(200);
    const initialRow = await stored(account);
    await patch(account, { exerciseVolume: 'standard' }).expect(
      200,
      initial.body,
    );
    expect(await stored(account)).toEqual(initialRow);
    const input = {
      exerciseVolume: 'more',
      exerciseGoal: 'body_composition_management',
    };
    const changed = await patch(account, input).expect(200);
    const changedRow = await stored(account);
    for (const retry of [
      input,
      { exerciseVolume: input.exerciseVolume },
      { exerciseGoal: input.exerciseGoal },
    ]) {
      await patch(account, retry).expect(200, changed.body);
      expect(await stored(account)).toEqual(changedRow);
    }
    await read(account).expect(200, changed.body);
  });

  it('advances updatedAt only after an actual change and preserves createdAt', async () => {
    const account = await register();
    const past = new Date(Date.now() - 60_000);
    await database.userPreference.update({
      where: { userId: account.user.id },
      data: { updatedAt: past },
    });
    const before = await stored(account);
    const response = await patch(account, { exerciseVolume: 'more' }).expect(
      200,
    );
    const after = await stored(account);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    expect((response.body as Preferences).updatedAt).toBe(
      after.updatedAt.toISOString(),
    );
    await read(account).expect(200, response.body);
  });

  it.each([
    {},
    { exerciseVolume: null },
    { exerciseGoal: null },
    { exerciseVolume: '' },
    { exerciseGoal: '' },
    { exerciseVolume: ' ' },
    { exerciseGoal: ' ' },
    { exerciseVolume: 'MORE' },
    { exerciseGoal: 'fitness' },
    { exerciseVolume: ' more ' },
    { exerciseGoal: 'general_fitness_improvement ' },
    { exerciseVolume: 1 },
    { exerciseGoal: 1 },
    { exerciseVolume: true },
    { exerciseGoal: false },
    { exerciseVolume: ['more'] },
    { exerciseGoal: ['general_fitness_improvement'] },
    { exerciseVolume: {} },
    { exerciseGoal: { value: 'fitness_grade_improvement' } },
    { unknown: 'value' },
    { userId: randomUUID() },
    { updatedAt: '2026-09-25T00:00:00Z' },
    { currentPassword: password },
  ])(
    'rejects invalid input without changing any stored field: %j',
    async (input) => {
      const account = await register();
      const before = await stored(account);
      const response = await patch(account, input).expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        message: expect.any(String),
      });
      expect(JSON.stringify(response.body)).not.toContain(password);
      expect(await stored(account)).toEqual(before);
    },
  );

  it.each([
    { exerciseVolume: 'light', exerciseGoal: 'fitness_grade_improvement' },
    { exerciseVolume: 'normal', exerciseGoal: 'fitness_grade_improvement' },
    { exerciseVolume: 'full', exerciseGoal: 'fitness_grade_improvement' },
    { exerciseVolume: 'more', exerciseGoal: 'grade' },
    { exerciseVolume: 'more', exerciseGoal: 'body' },
    { exerciseVolume: 'more', exerciseGoal: 'general' },
    { exerciseVolume: 'more', exerciseGoal: null },
    { exerciseVolume: 'more', exerciseGoal: '' },
    { exerciseVolume: 'more', exerciseGoal: 'invalid' },
    { exerciseVolume: 'more', exerciseGoal: 123 },
    { exerciseVolume: null, exerciseGoal: 'fitness_grade_improvement' },
    { exerciseVolume: 'invalid', exerciseGoal: 'fitness_grade_improvement' },
    { exerciseVolume: ['more'], exerciseGoal: 'fitness_grade_improvement' },
    { exerciseVolume: 'more', unknown: true },
    { exerciseGoal: 'fitness_grade_improvement', isOnboarded: true },
  ])(
    'validates the entire request before saving either field: %j',
    async (input) => {
      const account = await register();
      const before = await stored(account);
      const beforeResponse = await read(account).expect(200);
      await patch(account, input).expect(400);
      expect(await stored(account)).toEqual(before);
      await read(account).expect(200, beforeResponse.body);
    },
  );

  it.each(['', 'null', '"more"', '123', 'true', '[]', '[{}]', '{'])(
    'rejects empty, malformed, or non-object JSON bodies without mutation: %s',
    async (body) => {
      const account = await register();
      const before = await stored(account);
      await patchRequest(account)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
      expect(await stored(account)).toEqual(before);
    },
  );

  it('rejects a missing request body and never permits a chosen goal to be reset to null', async () => {
    const account = await register();
    const chosen = await patch(account, {
      exerciseGoal: 'general_fitness_improvement',
    }).expect(200);
    const before = await stored(account);
    await patchRequest(account).expect(400);
    await patch(account, { exerciseGoal: null }).expect(400);
    await patch(account, {
      exerciseVolume: 'less',
      exerciseGoal: null,
    }).expect(400);
    expect(await stored(account)).toEqual(before);
    await read(account).expect(200, chosen.body);
  });

  it('rejects URL-encoded forms and plain text even when they contain otherwise valid setting values', async () => {
    const account = await register();
    const before = await stored(account);
    const beforeResponse = await read(account).expect(200);
    await patchRequest(account)
      .type('form')
      .send({ exerciseVolume: 'more' })
      .expect(400);
    expect(await stored(account)).toEqual(before);
    await patchRequest(account)
      .type('text')
      .send(JSON.stringify({ exerciseVolume: 'more' }))
      .expect(400);
    expect(await stored(account)).toEqual(before);
    await read(account).expect(200, beforeResponse.body);
  });

  it('keeps both independent field changes when PATCH requests overlap', async () => {
    const account = await register();
    // Repeated overlap exercises both null and already-selected goals.
    for (const [exerciseVolume, exerciseGoal] of [
      ['more', 'fitness_grade_improvement'],
      ['less', 'body_composition_management'],
      ['standard', 'general_fitness_improvement'],
    ] as const) {
      const responses = await Promise.all([
        patch(account, { exerciseVolume }),
        patch(account, { exerciseGoal }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      for (const response of responses)
        expect(Object.keys(response.body as object).sort()).toEqual([
          'exerciseGoal',
          'exerciseVolume',
          'ownedTools',
          'updatedAt',
        ]);
      expect((await read(account).expect(200)).body).toEqual({
        exerciseVolume,
        exerciseGoal,
        ownedTools: [],
        updatedAt: expect.any(String),
      });
    }
  });

  it('deduplicates concurrent identical updates with one stable updatedAt', async () => {
    const account = await register();
    const input = {
      exerciseVolume: 'more',
      exerciseGoal: 'body_composition_management',
    };
    const responses = await Promise.all([
      patch(account, input),
      patch(account, input),
      patch(account, input),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
    expect(responses[1].body).toEqual(responses[0].body);
    expect(responses[2].body).toEqual(responses[0].body);
    await read(account).expect(200, responses[0].body);
  });

  it('uses the authenticated owner exclusively and exposes no route for another user', async () => {
    const owner = await register();
    const other = await register();
    await patch(other, {
      exerciseVolume: 'less',
      exerciseGoal: 'body_composition_management',
    }).expect(200);
    const otherBefore = await stored(other);
    const ownerBefore = await read(owner).expect(200);
    await patch(owner, {
      userId: other.user.id,
      exerciseVolume: 'more',
    }).expect(400);
    await read(owner)
      .query({ userId: other.user.id })
      .expect(200, ownerBefore.body);
    await patch(owner, { exerciseVolume: 'more' })
      .query({ userId: other.user.id })
      .expect(200);
    for (const method of ['get', 'patch'] as const)
      await request(app.getHttpServer())
        [method](`/api/v1/users/${other.user.id}/preferences`)
        .set('Authorization', `Bearer ${owner.access_token}`)
        .set('X-CSRF-Protection', '1')
        .send(method === 'patch' ? { exerciseVolume: 'more' } : undefined)
        .expect(404);
    expect(await stored(other)).toEqual(otherBefore);
    expect((await read(owner).expect(200)).body).toMatchObject({
      exerciseVolume: 'more',
      exerciseGoal: null,
    });
    expect((await read(other).expect(200)).body).toMatchObject({
      exerciseVolume: 'less',
      exerciseGoal: 'body_composition_management',
    });
  });

  it('requires login and the existing CSRF/Origin checks while allowing authenticated GET without a CSRF header', async () => {
    const account = await register();
    const before = await stored(account);
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .patch(path)
      .set('X-CSRF-Protection', '1')
      .send({ exerciseVolume: 'more' })
      .expect(401);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${account.access_token}invalid`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${account.access_token}`)
      .send({ exerciseVolume: 'more' })
      .expect(403);
    await patch(account, { exerciseVolume: 'more' })
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    expect(await stored(account)).toEqual(before);
    await read(account).expect(200);
  });

  it('applies the shared IP request limit without changing settings or invalidating the session', async () => {
    const account = await register();
    const before = await stored(account);
    const beforeResponse = await read(account).expect(200);
    await database.authRateLimit.deleteMany();
    // Keep this test inside one rate-limit window even near a minute boundary.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (let attempt = 0; attempt < 60; attempt++)
        await patch(account, { exerciseVolume: 'standard' }).expect(200);
      const blocked = await patch(account, {
        exerciseVolume: 'more',
      }).expect(429);
      expect(blocked.body).toMatchObject({
        statusCode: 429,
        message: expect.any(String),
        retry_after: expect.any(Number),
      });
      expect(
        (blocked.body as { retry_after: number }).retry_after,
      ).toBeGreaterThan(0);
      expect(await stored(account)).toEqual(before);
      await read(account).expect(200, beforeResponse.body);
      await profile(account).expect(200);
    } finally {
      clock.mockRestore();
    }
  });

  it('reports missing persisted settings without silently recreating defaults on GET or PATCH', async () => {
    const account = await register();
    await database.userPreference.delete({
      where: { userId: account.user.id },
    });
    const missingPreference = {
      statusCode: 503,
      error: 'Service Unavailable',
      message: '사용자 운동 설정이 누락되었습니다. 관리자 확인이 필요합니다.',
    };
    await read(account).expect(503, missingPreference);
    await patch(account, { exerciseVolume: 'more' }).expect(
      503,
      missingPreference,
    );
    expect(
      await database.userPreference.count({
        where: { userId: account.user.id },
      }),
    ).toBe(0);
    // Preference integrity problems do not revoke an otherwise valid session.
    await profile(account).expect(200);
  });

  it('preserves credentials, all sessions, currency, curriculum progress, measurements, grades and onboarding', async () => {
    const account = await register();
    const emptyProfile = await profile(account).expect(200);
    await patch(account, { exerciseVolume: 'less' }).expect(200);
    await profile(account).expect(200, emptyProfile.body);

    const measurement = await request(app.getHttpServer())
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        catalogVersion: 'nfa100-2026-09-24',
        measuredOn: '2026-09-17',
        ageAtMeasurement: 19,
        sexAtMeasurement: 'male',
        reportedOverallGrade: '2등급',
        items: [
          {
            measurementCode: 'cross_sit_up',
            value: '55',
            unit: '회',
            reportedGrade: '1등급',
          },
        ],
      })
      .expect(201);
    expect(measurement.body).toMatchObject({
      items: [
        {
          reportedGrade: '1등급',
          evaluation: { status: 'graded', grade: 1 },
        },
      ],
    });
    const curriculum = await database.workoutCurriculum.create({
      data: { name: '[TEST ONLY] Preserved preference-test curriculum' },
    });
    curriculumIds.push(curriculum.id);
    const curricula = app.get(CurriculaService);
    const completed = await curricula.assign(
      account.user.id,
      curriculum.id,
      randomUUID(),
    );
    await curricula.complete(account.user.id, completed.id);
    const current = await curricula.assign(
      account.user.id,
      curriculum.id,
      randomUUID(),
    );
    await database.userCurrency.update({
      where: { userId: account.user.id },
      data: { balance: 123 },
    });
    const second = asAccount(
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({ email: account.user.email, password })
        .expect(200),
    );
    const snapshot = () =>
      database.user.findUniqueOrThrow({
        where: { id: account.user.id },
        include: {
          currency: true,
          curriculumAssignments: { orderBy: { id: 'asc' } },
          measurements: { include: { items: true } },
          measurementRequests: true,
          sessions: {
            include: { refreshTokens: true },
            orderBy: { id: 'asc' },
          },
        },
      });
    const before = await snapshot();
    const beforeProfile = await profile(account).expect(200);
    expect(beforeProfile.body).toMatchObject({
      isOnboarded: true,
      currency: { balance: 123 },
      currentCurriculum: { id: current.id, status: 'assigned' },
    });
    const response = await patch(account, {
      exerciseVolume: 'more',
      exerciseGoal: 'fitness_grade_improvement',
    }).expect(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await snapshot()).toEqual(before);
    await profile(account).expect(200, beforeProfile.body);
    await profile(second).expect(200, beforeProfile.body);
    await request(app.getHttpServer())
      .get(`/api/v1/measurements/${(measurement.body as { id: string }).id}`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .expect(200, measurement.body);
    for (const login of [account, second]) {
      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-CSRF-Protection', '1')
        .set('Cookie', login.cookie)
        .expect(200);
      await read(refreshed.body as Account).expect(200, response.body);
    }
  });

  it('preserves current and future routines and progress without entering recommendation paths on GET or PATCH', async () => {
    const account = await register();
    const curriculum = await database.workoutCurriculum.create({
      data: { name: '[TEST ONLY] Stored daily routine' },
    });
    curriculumIds.push(curriculum.id);
    // Persist synthetic existing routines directly; no algorithm is connected.
    for (const isCurrent of [true, false]) {
      await database.userCurriculumAssignment.create({
        data: {
          userId: account.user.id,
          curriculumId: curriculum.id,
          requestKey: randomUUID(),
          currentForUserId: isCurrent ? account.user.id : null,
          assignmentDate: new Date(
            isCurrent ? '2026-09-29T00:00:00Z' : '2026-09-30T00:00:00Z',
          ),
          algorithmVersion: 'test-only-existing-routine',
          inputSnapshot: { fixture: true },
          status: isCurrent ? 'in_progress' : 'assigned',
          intervals: isCurrent ? [[0, 20]] : [],
          positionSeconds: isCurrent ? 20 : 0,
          revision: isCurrent ? 2 : 1,
          requests: {
            create: { userId: account.user.id, key: randomUUID() },
          },
          ...(isCurrent
            ? {
                events: {
                  create: {
                    key: randomUUID(),
                    requestHash: 'a'.repeat(64),
                    deviceId: randomUUID(),
                    sequence: 1,
                    type: 'progress',
                    intervals: [[0, 20]],
                    positionSeconds: 20,
                    receivedAt: new Date(),
                    resultingRevision: 2,
                  },
                },
              }
            : {}),
        },
      });
    }
    const snapshot = () =>
      database.userCurriculumAssignment.findMany({
        where: { userId: account.user.id },
        orderBy: { id: 'asc' },
        include: { curriculum: true, events: true, requests: true },
      });
    const before = await snapshot();
    const recommendations = app.get(RecommendationsService);
    const algorithm = app.get(WorkoutAlgorithm);
    const spies = [
      vi.spyOn(recommendations, 'today'),
      vi.spyOn(recommendations, 'current'),
      vi.spyOn(algorithm, 'recommend'),
      vi.spyOn(algorithm, 'weightAdjustment'),
      vi.spyOn(app.get(CurriculaService), 'assign'),
      vi.spyOn(app.get(RoutineAlgorithm), 'recommend'),
      vi.spyOn(app.get(WorkoutRoutinesService), 'next'),
    ];
    try {
      await read(account).expect(200);
      await patch(account, { exerciseVolume: 'less' }).expect(200);
      const input = {
        exerciseVolume: 'more',
        exerciseGoal: 'general_fitness_improvement',
        ownedTools: ['band', 'step_box'],
      };
      const saved = await patch(account, input).expect(200);
      await patch(account, input).expect(200, saved.body);
      await read(account).expect(200, saved.body);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('deletes preferences through the real account withdrawal flow and leaves another account intact', async () => {
    const account = await register();
    const other = await register();
    await patch(account, {
      ownedTools: ['band', 'dumbbell'],
      exerciseVolume: 'more',
      exerciseGoal: 'general_fitness_improvement',
    }).expect(200);
    const otherBefore = await stored(other);
    await request(app.getHttpServer())
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .send({ password })
      .expect(204);
    expect(
      await database.user.findUnique({ where: { id: account.user.id } }),
    ).toBeNull();
    expect(
      await database.userPreference.findUnique({
        where: { userId: account.user.id },
      }),
    ).toBeNull();
    await read(account).expect(401);
    await patch(account, { exerciseVolume: 'standard' }).expect(401);
    expect(await stored(other)).toEqual(otherBefore);
    await read(other).expect(200);
  });

  it.each(['GET', 'PATCH'] as const)(
    'returns 401 when withdrawal completes after %s authentication but before preferences are read',
    async (method) => {
      const account = await register();
      const preferences = app.get(UserPreferencesService);
      const get = preferences.get.bind(preferences);
      const update = preferences.update.bind(preferences);
      let reachedService!: () => void;
      const authenticated = new Promise<void>((resolve) => {
        reachedService = resolve;
      });
      let release!: () => void;
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waitForWithdrawal = async (userId: string) => {
        expect(userId).toBe(account.user.id);
        // Controller entry proves both real guards have already passed.
        reachedService();
        await resume;
      };
      const spy =
        method === 'GET'
          ? vi.spyOn(preferences, 'get').mockImplementationOnce(async (id) => {
              await waitForWithdrawal(id);
              return get(id);
            })
          : vi
              .spyOn(preferences, 'update')
              .mockImplementationOnce(async (id, input) => {
                await waitForWithdrawal(id);
                return update(id, input);
              });
      // Calling then starts the HTTP request; the deadline also bounds a
      // failure to reach the service instead of leaving the barrier pending.
      const pending = (
        method === 'GET'
          ? read(account)
          : patch(account, { exerciseVolume: 'more' })
      )
        .timeout({ deadline: 10_000 })
        .then((response) => response);
      try {
        await Promise.race([
          authenticated,
          pending.then((response) => {
            throw new Error(
              `Preferences request ended with ${response.status} before reaching the service`,
            );
          }),
        ]);
        await request(app.getHttpServer())
          .delete('/api/v1/users/me')
          .set('Authorization', `Bearer ${account.access_token}`)
          .set('X-CSRF-Protection', '1')
          .send({ password })
          .timeout({ deadline: 5_000 })
          .expect(204);
        release();
        const response = await pending;
        expect(response.status).toBe(401);
        expect(response.body).toEqual({
          statusCode: 401,
          error: 'Unauthorized',
          message: '로그인이 필요하거나 세션이 만료되었습니다.',
        });
        expect(
          await database.user.findUnique({ where: { id: account.user.id } }),
        ).toBeNull();
        expect(
          await database.userPreference.findUnique({
            where: { userId: account.user.id },
          }),
        ).toBeNull();
      } finally {
        release();
        await pending.catch(() => undefined);
        spy.mockRestore();
      }
    },
  );
});
