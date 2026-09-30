import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
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
import { Prisma } from '../src/generated/prisma/client.js';
import { DatabaseService } from '../src/database/database.service.js';
import { CurriculaService } from '../src/curricula/curricula.service.js';
import { MeasurementsService } from '../src/measurements/measurements.service.js';
import { parseCreate } from '../src/measurements/measurement-input.js';
import { RoutineAlgorithm } from '../src/recommendations/routine-algorithm.js';
import { WorkoutRoutinesService } from '../src/recommendations/workout-routines.service.js';
import { configureApp } from '../src/setup-app.js';

type Account = { user: { id: string }; access_token: string };
type Routine = Awaited<ReturnType<WorkoutRoutinesService['get']>>;
const password = 'routine integration secure password';
const base = '/api/v2/workout-routines';

describe('Multi-exercise routines with the real data-team Python algorithm', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let algorithm: RoutineAlgorithm;
  let now = new Date('2026-09-29T14:59:59Z');
  let owner: Account;
  const ids: string[] = [];
  const curricula: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WorkoutRoutinesService)
      .useFactory({
        factory: (database: DatabaseService, runner: RoutineAlgorithm) =>
          new WorkoutRoutinesService(database, runner, () => now),
        inject: [DatabaseService, RoutineAlgorithm],
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    algorithm = app.get(RoutineAlgorithm);
  });
  beforeEach(async () => {
    now = new Date('2026-09-29T14:59:59Z');
    await db.authRateLimit.deleteMany();
    owner = await register();
  });
  afterAll(async () => {
    await db?.user.deleteMany({ where: { id: { in: ids } } });
    await db?.workoutCurriculum.deleteMany({
      where: { id: { in: curricula } },
    });
    await app?.close();
  });
  async function register() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `routine-${randomUUID()}@example.test`,
        password,
        dateOfBirth: '2000-01-01',
      })
      .expect(201);
    const account = response.body as Account;
    ids.push(account.user.id);
    return account;
  }
  async function prepare(
    account = owner,
    volume: 'less' | 'standard' | 'more' = 'standard',
    goal:
      | 'fitness_grade_improvement'
      | 'body_composition_management'
      | 'general_fitness_improvement' = 'general_fitness_improvement',
  ) {
    await db.userPreference.update({
      where: { userId: account.user.id },
      data: { exerciseVolume: volume, exerciseGoal: goal },
    });
    return app.get(MeasurementsService).create(
      account.user.id,
      randomUUID(),
      parseCreate({
        catalogVersion: 'nfa100-2026-09-24-grip-v1',
        measuredOn: '2026-09-20',
        ageAtMeasurement: 26,
        sexAtMeasurement: 'male',
        items: [{ measurementCode: 'cross_sit_up', value: '55', unit: '회' }],
      }),
    );
  }
  const today = (key = randomUUID(), account = owner) =>
    request(app.getHttpServer())
      .post(`${base}/today`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .set('Idempotency-Key', key)
      .send({});
  const read = (path: string, account = owner) =>
    request(app.getHttpServer())
      .get(`${base}/${path}`)
      .set('Authorization', `Bearer ${account.access_token}`);
  const event = (
    routine: Routine,
    item: number,
    body: object,
    key = randomUUID(),
    account = owner,
  ) =>
    request(app.getHttpServer())
      .post(`${base}/${routine.id}/items/${routine.routine[item].id}/events`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .set('Idempotency-Key', key)
      .send(body);
  function body(type = 'start', sequence = 1, deviceId = randomUUID()) {
    return { type, deviceId, sequence, positionSeconds: 0, intervals: [] };
  }

  const patchPreferences = (data: object) =>
    request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .set('X-CSRF-Protection', '1')
      .send(data);

  it.each([
    [[], []],
    [['band'], ['밴드']],
    [['ball'], ['공']],
    [['dumbbell'], ['덤벨']],
    [['gym_ball'], ['짐볼']],
    [['jump_rope'], ['줄넘기']],
    [['step_box'], ['스텝박스']],
    [
      ['ball', 'step_box', 'gym_ball', 'dumbbell', 'jump_rope', 'band'],
      ['밴드', '덤벨', '짐볼', '줄넘기', '스텝박스', '공'],
    ],
  ])(
    'passes persisted tools %j to real Python and respects its household/equipment filter',
    async (ownedTools, pythonTools) => {
      await prepare(owner, 'more');
      await patchPreferences({ ownedTools }).expect(200);
      const spy = vi.spyOn(algorithm, 'recommend');
      try {
        const routine = (await today().expect(201)).body as Routine;
        expect(spy.mock.calls[0][0].owned_tools).toEqual(pythonTools);
        expect(routine.inputSnapshot).toMatchObject({
          owned_tools: pythonTools,
        });
        const config = app.get(ConfigService);
        const { stdout } = await promisify(execFile)(
          config.get<string>('RECOMMENDATION_PYTHON') || 'python3',
          [
            '-B',
            resolve('test/fixtures/routine-equipment.py'),
            resolve(
              config.get<string>('RECOMMENDATION_SOURCE_PATH') ||
                '../data-analysis/src/recommendation_v2.py',
            ),
            resolve(
              config.get<string>('WORKOUT_VIDEOS_PATH') ||
                '../data-analysis/data/processed/workout_videos_v2_complete.csv',
            ),
            JSON.stringify(pythonTools),
          ],
        );
        const allowed = new Set(JSON.parse(stdout) as string[]);
        expect(allowed.size).toBeGreaterThan(0);
        expect(routine.routine).toHaveLength(7);
        for (const item of routine.routine)
          expect(allowed.has(item.videoId)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('preserves saved routines and progress after tool edits and uses tools only for later new dates', async () => {
    await prepare();
    await patchPreferences({ ownedTools: ['band'] }).expect(200);
    const key = randomUUID();
    const current = (await today(key).expect(201)).body as Routine;
    now = new Date('2026-09-29T15:00:00Z');
    await event(current, 0, body()).expect(200);
    const future = (await today().expect(201)).body as Routine;
    const snapshot = () =>
      db.workoutRoutine.findMany({
        where: { userId: owner.user.id },
        orderBy: { id: 'asc' },
        include: {
          items: { orderBy: { order: 'asc' }, include: { events: true } },
          requests: { orderBy: { key: 'asc' } },
        },
      });
    const before = await snapshot();
    const spy = vi.spyOn(algorithm, 'recommend');
    try {
      await patchPreferences({ ownedTools: ['dumbbell', 'step_box'] }).expect(
        200,
      );
      await request(app.getHttpServer())
        .get('/api/v1/users/me/preferences')
        .set('Authorization', `Bearer ${owner.access_token}`)
        .expect(200);
      expect(spy).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
      expect((await today().expect(200)).body).toMatchObject({
        id: future.id,
        inputSnapshot: future.inputSnapshot,
      });
      expect((await today(key).expect(200)).body).toMatchObject({
        id: current.id,
        inputSnapshot: current.inputSnapshot,
      });
      expect(spy).not.toHaveBeenCalled();
      now = new Date('2026-09-30T15:00:00Z');
      const newer = (await today().expect(201)).body as Routine;
      expect(newer.inputSnapshot).toMatchObject({
        ownedTools: ['dumbbell', 'step_box'],
        owned_tools: ['덤벨', '스텝박스'],
      });
      expect(spy.mock.calls[0][0].owned_tools).toEqual(['덤벨', '스텝박스']);
      const after = await snapshot();
      // Retries may append request keys, but existing routines/items/events are immutable here.
      for (const original of before) {
        const saved = after.find((row) => row.id === original.id)!;
        expect({ ...saved, requests: original.requests }).toEqual(original);
      }
      await patchPreferences({ ownedTools: [] }).expect(200);
      now = new Date('2026-10-01T15:00:00Z');
      expect(
        ((await today().expect(201)).body as Routine).inputSnapshot,
      ).toMatchObject({ ownedTools: [], owned_tools: [] });
    } finally {
      spy.mockRestore();
    }
  });

  it('uses one locked preference state while a combined PATCH overlaps generation', async () => {
    await prepare();
    await patchPreferences({ ownedTools: ['band'] }).expect(200);
    let reached!: () => void;
    const entered = new Promise<void>((done) => {
      reached = done;
    });
    let release!: () => void;
    const resumed = new Promise<void>((done) => {
      release = done;
    });
    const recommend = algorithm.recommend.bind(algorithm);
    const spy = vi
      .spyOn(algorithm, 'recommend')
      .mockImplementationOnce(async (input) => {
        reached();
        await resumed;
        return recommend(input);
      });
    const pending = today()
      .timeout({ deadline: 12000 })
      .then((response) => response);
    try {
      await Promise.race([
        entered,
        pending.then(() => {
          throw new Error('Did not enter Python adapter');
        }),
      ]);
      const edit = patchPreferences({
        exerciseVolume: 'less',
        exerciseGoal: 'body_composition_management',
        ownedTools: ['gym_ball'],
      })
        .timeout({ deadline: 12000 })
        .then((response) => response);
      release();
      const [created, changed] = await Promise.all([pending, edit]);
      expect(created.status).toBe(201);
      expect(changed.status).toBe(200);
      expect((created.body as Routine).inputSnapshot).toMatchObject({
        exerciseVolume: 'standard',
        exerciseGoal: 'general_fitness_improvement',
        ownedTools: ['band'],
        owned_tools: ['밴드'],
      });
      now = new Date('2026-09-29T15:00:00Z');
      expect(
        ((await today().expect(201)).body as Routine).inputSnapshot,
      ).toMatchObject({
        exerciseVolume: 'less',
        exerciseGoal: 'body_composition_management',
        ownedTools: ['gym_ball'],
        owned_tools: ['짐볼'],
      });
    } finally {
      release();
      await pending;
      spy.mockRestore();
    }
  });

  it.each([
    ['less', 'fitness_grade_improvement', 3, 6, 'light', 'grade'],
    ['standard', 'body_composition_management', 5, 10, 'normal', 'body'],
    ['more', 'general_fitness_improvement', 7, 14, 'full', 'general'],
  ] as const)(
    'persists and restores a real %s routine and exact prescriptions',
    async (volume, goal, size, minutes, level, internalGoal) => {
      await prepare(owner, volume, goal);
      const spy = vi.spyOn(algorithm, 'recommend');
      try {
        const response = await today().expect(201);
        const routine = response.body as Routine;
        const decision = await spy.mock.results[0].value;
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['location']).toBe(`${base}/${routine.id}`);
        expect(routine).toMatchObject({
          koreanDate: '2026-09-29',
          referenceDate: '2026-09-29',
          estimatedMinutes: minutes,
          status: 'assigned',
        });
        expect(routine.routine).toHaveLength(size);
        expect(
          routine.routine.map(
            ({ order, videoId, title, videoUrl, slot, prescription }) => ({
              order,
              videoId,
              title,
              videoUrl,
              slot,
              prescription,
            }),
          ),
        ).toEqual(decision.result.workout.routine);
        expect(routine.cardioRecommendation).toEqual(
          decision.result.workout.cardioRecommendation,
        );
        expect(routine.cardioRecommendation).toMatchObject({
          activity: expect.stringMatching(/^(걷기|뛰기)$/),
          minutes: expect.any(Number),
        });
        const stored = await db.workoutRoutine.findUniqueOrThrow({
          where: { id: routine.id },
        });
        expect(stored.cardioRecommendation).toEqual(
          routine.cardioRecommendation,
        );
        for (const item of routine.routine)
          expect(item.prescription).toMatchObject({ sets: 3 });
        expect(routine.weightAdjustment).toBeNull();
        expect(routine.algorithmVersion).toMatch(
          /^recommendation_v2:[a-f0-9]{64}$/,
        );
        expect(routine.inputSnapshot).toMatchObject({
          routine_level: level,
          goal: internalGoal,
          owned_tools: [],
          exerciseVolume: volume,
          exerciseGoal: goal,
        });
        for (const item of routine.routine) {
          expect(item.progress.durationSeconds).toBe(
            decision.durations[item.videoId],
          );
          expect(item.progress.durationSeconds).toBeGreaterThan(0);
          expect(item.progress.watchedSeconds).toBe(0);
        }
        await read(routine.id).expect(200, response.body);
        expect((await read('current').expect(200)).body).toMatchObject({
          id: routine.id,
        });
        expect(spy).toHaveBeenCalledTimes(1);
        const eventResponse = await event(routine, 0, body()).expect(200);
        expect(eventResponse.body.cardioRecommendation).toEqual(
          routine.cardioRecommendation,
        );
        await patchPreferences({
          exerciseVolume: 'less',
          exerciseGoal: 'fitness_grade_improvement',
        }).expect(200);
        const replay = await today().expect(200);
        expect(replay.body.cardioRecommendation).toEqual(
          routine.cardioRecommendation,
        );
        expect(replay.body.routine).toEqual(eventResponse.body.routine);
        const history = await read('history').expect(200);
        expect(history.body.items[0].cardioRecommendation).toEqual(
          routine.cardioRecommendation,
        );
        expect(spy).toHaveBeenCalledTimes(1);
        now = new Date('2026-09-29T15:00:00Z');
        await read('current').expect(200, 'null');
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('reads and reuses a legacy routine with null cardio and two-set prescriptions unchanged', async () => {
    const legacy = await db.workoutRoutine.create({
      data: {
        userId: owner.user.id,
        assignmentDate: new Date('2026-09-29'),
        referenceDate: new Date('2026-09-29'),
        algorithmVersion: 'legacy-test-only',
        dataVersion: 'legacy-test-only',
        estimatedMinutes: 2,
        inputSnapshot: { ownedTools: ['bosu'], axes: [] },
        items: {
          create: {
            order: 1,
            videoId: 'LEGACY.mp4',
            title: '[TEST ONLY]',
            videoUrl: 'http://openapi.kspo.or.kr/web/video/LEGACY.mp4',
            durationSeconds: 100,
            slot: 'strength_group',
            prescription: {
              doseType: 'reps',
              value: '10~15',
              unit: '회',
              sets: 2,
              restSec: 20,
              text: '10~15회 × 2세트',
            },
          },
        },
      },
    });
    const spy = vi.spyOn(algorithm, 'recommend');
    try {
      const saved = (await read(legacy.id).expect(200)).body as Routine;
      expect(saved.cardioRecommendation).toBeNull();
      expect(saved.routine[0].prescription).toMatchObject({ sets: 2 });
      expect(saved.inputSnapshot).toEqual(legacy.inputSnapshot);
      await read('current').expect(200, saved);
      expect((await read('history').expect(200)).body.items).toEqual([saved]);
      const key = randomUUID();
      await today(key).expect(200, saved);
      await today(key).expect(200, saved);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('passes below-standard as calculation-only 3 and leaves measurement storage and responses unchanged', async () => {
    await db.userPreference.update({
      where: { userId: owner.user.id },
      data: { exerciseGoal: 'general_fitness_improvement' },
    });
    const measurement = await app.get(MeasurementsService).create(
      owner.user.id,
      randomUUID(),
      parseCreate({
        catalogVersion: 'nfa100-2026-09-24-grip-v1',
        measuredOn: '2026-09-20',
        ageAtMeasurement: 26,
        sexAtMeasurement: 'male',
        items: [{ measurementCode: 'cross_sit_up', value: '1', unit: '회' }],
      }),
    );
    const measurementPath = `/api/v1/measurements/${measurement.record.id}`;
    const getMeasurement = () =>
      request(app.getHttpServer())
        .get(measurementPath)
        .set('Authorization', `Bearer ${owner.access_token}`);
    const before = (await getMeasurement().expect(200)).body;
    const storedBefore = await db.measurement.findUniqueOrThrow({
      where: { id: measurement.record.id },
      include: { items: true },
    });
    const routine = (await today().expect(201)).body as Routine;
    expect(routine.inputSnapshot).toMatchObject({
      axes: expect.arrayContaining([
        expect.objectContaining({
          axis: 'muscular_endurance',
          status: 'below_standard',
          grade: null,
        }),
      ]),
      fitness100: { fitness: { muscularEndurance: 3, strength: null } },
    });
    await getMeasurement().expect(200, before);
    expect(
      await db.measurement.findUniqueOrThrow({
        where: { id: measurement.record.id },
        include: { items: true },
      }),
    ).toEqual(storedBefore);
  });

  it('rejects invalid cardio without persisting a routine or request key', async () => {
    await prepare();
    const realRecommend = algorithm.recommend.bind(algorithm);
    const spy = vi
      .spyOn(algorithm, 'recommend')
      .mockImplementationOnce(async (input) => {
        const decision = await realRecommend(input);
        decision.result.workout.cardioRecommendation.minutes = 0;
        return decision;
      });
    try {
      await today().expect(503);
      expect(
        await db.workoutRoutine.count({ where: { userId: owner.user.id } }),
      ).toBe(0);
      expect(
        await db.workoutRoutineRequest.count({
          where: { userId: owner.user.id },
        }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('requires a selected goal without invoking the algorithm and preserves onboarding/session', async () => {
    const spy = vi.spyOn(algorithm, 'recommend');
    try {
      await read('current').expect(200, 'null');
      const response = await today().expect(409);
      expect(response.body).toMatchObject({ code: 'EXERCISE_GOAL_REQUIRED' });
      expect(spy).not.toHaveBeenCalled();
      expect(
        await db.workoutRoutine.count({ where: { userId: owner.user.id } }),
      ).toBe(0);
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${owner.access_token}`)
        .expect(200);
    } finally {
      spy.mockRestore();
    }
  });

  it('retires the next-day API with an authenticated migration response and does not generate', async () => {
    const spy = vi.spyOn(algorithm, 'recommend');
    try {
      const old = '/api/v1/workout-routines';
      await request(app.getHttpServer()).get(`${old}/current`).expect(401);
      for (const path of ['current', 'history', randomUUID()]) {
        const response = await request(app.getHttpServer())
          .get(`${old}/${path}`)
          .set('Authorization', `Bearer ${owner.access_token}`)
          .expect(410);
        expect(response.body.code).toBe('ROUTINE_API_RETIRED');
        expect(response.headers['cache-control']).toBe('no-store');
      }
      for (const path of [
        'next',
        `${randomUUID()}/items/${randomUUID()}/events`,
      ]) {
        await request(app.getHttpServer())
          .post(`${old}/${path}`)
          .set('Authorization', `Bearer ${owner.access_token}`)
          .set('X-CSRF-Protection', '1')
          .send({})
          .expect(410);
      }
      await request(app.getHttpServer())
        .post(`${base}/next`)
        .set('Authorization', `Bearer ${owner.access_token}`)
        .set('X-CSRF-Protection', '1')
        .send({})
        .expect(404);
      expect(spy).not.toHaveBeenCalled();
      expect(
        await db.workoutRoutine.count({ where: { userId: owner.user.id } }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['pause', 'end', 'complete'] as const)(
    'uses unique watched duration at the 80%% boundary on %s, and reuses the completed daily routine',
    async (type) => {
      await prepare(owner, 'less');
      const routine = (await today().expect(201)).body as Routine;
      const spy = vi.spyOn(algorithm, 'recommend');
      try {
        for (const [index, item] of routine.routine.entries()) {
          const duration = item.progress.durationSeconds;
          const device = randomUUID();
          await event(routine, index, body('start', 1, device)).expect(200);
          const short = duration * 0.8 - 0.000001;
          const incomplete = (
            await event(routine, index, {
              ...body(type, 2, device),
              positionSeconds: duration,
              intervals: [
                { start: 0, end: short },
                { start: 0, end: short },
              ],
            }).expect(200)
          ).body as Routine;
          expect(incomplete.routine[index]).toMatchObject({
            status: 'interrupted',
            resultStatus: 'interrupted',
            completedAt: null,
          });
          expect(incomplete.routine[index].progress.watchedSeconds).toBeCloseTo(
            short,
            8,
          );
          // Starting again and watching only the missing interval reaches exactly 80%.
          await event(routine, index, body('start', 3, device)).expect(200);
          const completed = (
            await event(routine, index, {
              ...body(type, 4, device),
              positionSeconds: duration * 0.8,
              intervals: [{ start: short, end: duration * 0.8 }],
            }).expect(200)
          ).body as Routine;
          expect(completed.routine[index].status).toBe('completed');
          const before = await db.workoutRoutineItem.findUniqueOrThrow({
            where: { id: item.id },
          });
          await event(routine, index, body(type, 5, device)).expect(200);
          expect(
            await db.workoutRoutineItem.findUniqueOrThrow({
              where: { id: item.id },
            }),
          ).toEqual(before);
        }
        const saved = (await read('current').expect(200)).body as Routine;
        expect(saved.status).toBe('completed');
        await today().expect(200, saved);
        expect(spy).not.toHaveBeenCalled();
        expect(
          await db.workoutRoutine.count({ where: { userId: owner.user.id } }),
        ).toBe(1);
        now = new Date('2026-09-29T15:00:00Z');
        await today().expect(201);
        expect(spy.mock.calls[0][0]).toMatchObject({
          current_date: '2026-09-30',
        });
        expect(spy.mock.calls[0][0].logs).toHaveLength(3);
        expect(
          spy.mock.calls[0][0].logs.every(
            (log) => log.completed && log.date === '2026-09-29T14:59:59.000Z',
          ),
        ).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('records paused incomplete effort for the next day but excludes zero watched activity', async () => {
    await prepare(owner, 'less');
    const routine = (await today().expect(201)).body as Routine;
    const spy = vi.spyOn(algorithm, 'recommend');
    try {
      for (const index of [0, 1]) {
        await event(routine, index, body()).expect(200);
        const watched =
          index === 0
            ? routine.routine[index].progress.durationSeconds * 0.6
            : 0;
        const saved = (
          await event(routine, index, {
            ...body('pause'),
            positionSeconds: watched,
            intervals: watched ? [{ start: 0, end: watched }] : [],
          }).expect(200)
        ).body as Routine;
        expect(saved.routine[index].status).toBe(
          index === 0 ? 'interrupted' : 'not_performed',
        );
      }
      expect(spy).not.toHaveBeenCalled();
      now = new Date('2026-09-29T15:00:00Z');
      // A delayed second stop adds no viewing and preserves the actual saved day.
      await event(routine, 0, body('end')).expect(200);
      await today().expect(201);
      expect(spy.mock.calls[0][0].logs).toEqual([
        {
          videoId: routine.routine[0].videoId,
          date: '2026-09-29T14:59:59.000Z',
          completed: false,
        },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('serializes concurrent generation and replays across KST midnight and preference changes', async () => {
    await prepare();
    const spy = vi.spyOn(algorithm, 'recommend');
    const key = randomUUID();
    try {
      const results = await Promise.all([today(key), today(), today(key)]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 200, 201,
      ]);
      const saved = results[0].body as Routine;
      for (const response of results) expect(response.body).toEqual(saved);
      expect(spy).toHaveBeenCalledTimes(1);
      await db.userPreference.update({
        where: { userId: owner.user.id },
        data: {
          exerciseVolume: 'less',
          exerciseGoal: 'fitness_grade_improvement',
        },
      });
      await today().expect(200, saved);
      now = new Date('2026-09-29T15:00:00Z');
      expect((await today(key).expect(200)).body).toMatchObject({
        id: saved.id,
      });
      const newer = (await today().expect(201)).body as Routine;
      expect(newer.koreanDate).toBe('2026-09-30');
      expect(newer.routine).toHaveLength(3);
      expect((await read(saved.id).expect(200)).body).toMatchObject({
        routine: saved.routine,
        inputSnapshot: saved.inputSnapshot,
      });
      expect((await read('current').expect(200)).body).toMatchObject({
        id: newer.id,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('tracks each exercise separately, retains completed items, and uses item outcomes for the next recommendation', async () => {
    await prepare(owner, 'less');
    const routine = (await today().expect(201)).body as Routine;
    expect(routine.koreanDate).toBe('2026-09-29');
    const device = randomUUID();
    await event(routine, 0, body('start', 1, device)).expect(200);
    const end = {
      ...body('end', 2, device),
      positionSeconds: routine.routine[0].progress.durationSeconds / 2,
      intervals: [
        { start: 0, end: routine.routine[0].progress.durationSeconds / 2 },
      ],
    };
    const interrupted = (await event(routine, 0, end).expect(200))
      .body as Routine;
    expect(interrupted.routine[0].status).toBe('interrupted');
    expect(interrupted.routine[1]).toEqual(routine.routine[1]);
    await event(routine, 0, body('start', 3, device)).expect(200);
    const key = randomUUID();
    const watched = routine.routine[0].progress.durationSeconds * 0.8;
    const complete = {
      ...body('complete', 4, device),
      positionSeconds: watched,
      intervals: [{ start: 0, end: watched }],
    };
    const finished = await event(routine, 0, complete, key).expect(200);
    await event(routine, 0, complete, key).expect(200, finished.body);
    await event(routine, 0, body('progress', 5, device), key).expect(409);
    await event(routine, 0, body('start', 5, device)).expect(409);
    const snapshot = await db.workoutRoutineItem.findUniqueOrThrow({
      where: { id: routine.routine[0].id },
    });
    await event(routine, 0, body('complete', 5, device)).expect(200);
    expect(
      await db.workoutRoutineItem.findUniqueOrThrow({
        where: { id: snapshot.id },
      }),
    ).toEqual(snapshot);
    const performedAt = now.toISOString();
    const spy = vi.spyOn(algorithm, 'recommend');
    try {
      await today().expect(200);
      expect(spy).not.toHaveBeenCalled();
      now = new Date('2026-09-29T15:00:00Z');
      await today().expect(201);
      expect(spy.mock.calls[0][0].logs).toEqual([
        {
          videoId: routine.routine[0].videoId,
          date: performedAt,
          completed: true,
        },
      ]);
    } finally {
      spy.mockRestore();
    }
    for (const index of [1, 2]) {
      await event(routine, index, body()).expect(200);
      const watched = routine.routine[index].progress.durationSeconds * 0.8;
      await event(routine, index, {
        ...body('end'),
        positionSeconds: watched,
        intervals: [{ start: 0, end: watched }],
      }).expect(200);
    }
    const all = (await read(routine.id).expect(200)).body as Routine;
    expect(all.status).toBe('completed');
    expect(all.progress).toEqual({ completedItems: 3, totalItems: 3 });
  });

  it('merges concurrent item progress and rejects invalid/reordered events atomically', async () => {
    await prepare(owner, 'less');
    const routine = (await today().expect(201)).body as Routine;
    now = new Date('2026-09-29T15:00:00Z');
    const device = randomUUID();
    await event(routine, 0, body('start', 1, device)).expect(200);
    const results = await Promise.all([
      event(routine, 0, {
        ...body('progress', 2, device),
        positionSeconds: 10,
        intervals: [{ start: 0, end: 10 }],
      }),
      event(routine, 0, {
        ...body('progress'),
        positionSeconds: 15,
        intervals: [{ start: 5, end: 15 }],
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const saved = (await read(routine.id).expect(200)).body as Routine;
    expect(saved.routine[0].progress.watchedSeconds).toBe(15);
    await event(routine, 0, body('progress', 1, device)).expect(409);
    await event(routine, 0, {
      ...body('progress'),
      positionSeconds: 100000,
    }).expect(400);
    await event(routine, 0, {
      ...body('progress'),
      videoId: 'spoof.mp4',
    }).expect(400);
    await read(routine.id).expect(200, saved);
  });

  it('enforces owner/auth/CSRF/Origin and deletes routines, requests, items and events on withdrawal', async () => {
    await prepare(owner, 'less');
    const routine = (await today().expect(201)).body as Routine;
    const other = await register();
    await read(routine.id, other).expect(404);
    await event(routine, 0, body(), randomUUID(), other).expect(404);
    await read(`history?cursor=${routine.id}`, other).expect(404);
    await request(app.getHttpServer()).get(`${base}/current`).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/today`)
      .set('Authorization', `Bearer ${owner.access_token}`)
      .send({})
      .expect(403);
    await today().set('Origin', 'https://untrusted.example').expect(403);
    now = new Date('2026-09-29T15:00:00Z');
    await event(routine, 0, body()).expect(200);
    await request(app.getHttpServer())
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .set('X-CSRF-Protection', '1')
      .send({ password })
      .expect(204);
    expect(
      await db.workoutRoutine.findUnique({ where: { id: routine.id } }),
    ).toBeNull();
    expect(
      await db.workoutRoutineItem.count({ where: { routineId: routine.id } }),
    ).toBe(0);
    expect(
      await db.workoutRoutineRequest.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
    expect(
      await db.workoutRoutineEvent.count({
        where: { itemId: { in: routine.routine.map((item) => item.id) } },
      }),
    ).toBe(0);
    await read(routine.id).expect(401);
  });

  it('preserves account, settings, sessions, measurements, currency and existing single-video assignments', async () => {
    await prepare(owner, 'less');
    const curriculum = await db.workoutCurriculum.create({
      data: { name: '[TEST ONLY] Preserved legacy assignment' },
    });
    curricula.push(curriculum.id);
    await app
      .get(CurriculaService)
      .assign(owner.user.id, curriculum.id, randomUUID());
    const snapshot = () =>
      db.user.findUniqueOrThrow({
        where: { id: owner.user.id },
        include: {
          preference: true,
          currency: true,
          sessions: { include: { refreshTokens: true } },
          measurements: { include: { items: true } },
          measurementRequests: true,
          curriculumAssignments: true,
        },
      });
    const before = await snapshot();
    const saved = (await today().expect(201)).body as Routine;
    now = new Date('2026-09-29T15:00:00Z');
    await event(saved, 0, body()).expect(200);
    await event(saved, 0, body('complete')).expect(200);
    expect(await snapshot()).toEqual(before);
    const routineBefore = await read(saved.id).expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .set('X-CSRF-Protection', '1')
      .send({ exerciseVolume: 'more' })
      .expect(200);
    await read(saved.id).expect(200, routineBefore.body);
  });

  it('enforces routine/date/order ownership and immutable prescriptions in PostgreSQL', async () => {
    await prepare(owner, 'less');
    const saved = (await today().expect(201)).body as Routine;
    const routine = await db.workoutRoutine.findUniqueOrThrow({
      where: { id: saved.id },
    });
    const item = await db.workoutRoutineItem.findUniqueOrThrow({
      where: { id: saved.routine[0].id },
    });
    const routineData = {
      ...routine,
      inputSnapshot: routine.inputSnapshot!,
      weightAdjustment: routine.weightAdjustment ?? Prisma.DbNull,
      cardioRecommendation: routine.cardioRecommendation ?? Prisma.DbNull,
    };
    const itemData = {
      ...item,
      prescription: item.prescription!,
      intervals: item.intervals!,
    };
    await expect(
      db.workoutRoutine.create({ data: { ...routineData, id: randomUUID() } }),
    ).rejects.toThrow();
    await expect(
      db.workoutRoutineItem.create({ data: { ...itemData, id: randomUUID() } }),
    ).rejects.toThrow();
    await expect(
      db.workoutRoutineItem.update({
        where: { id: item.id },
        data: { prescription: {} },
      }),
    ).rejects.toThrow();
    await expect(
      db.workoutRoutine.update({
        where: { id: routine.id },
        data: { estimatedMinutes: 999 },
      }),
    ).rejects.toThrow();
    await expect(
      db.workoutRoutineItem.deleteMany({ where: { routineId: saved.id } }),
    ).rejects.toThrow();
    // New date with no children must fail at transaction commit, never persist an empty routine.
    await expect(
      db.workoutRoutine.create({
        data: {
          ...routineData,
          id: randomUUID(),
          referenceDate: new Date('2026-10-01'),
          assignmentDate: new Date('2026-10-01'),
        },
      }),
    ).rejects.toThrow();
    await read(saved.id).expect(200, saved);
  });

  it('rolls back failed algorithm execution and reads existing results without Python', async () => {
    await prepare();
    const config = app.get(ConfigService);
    const configured = config.get<string>('RECOMMENDATION_PYTHON');
    config.set('RECOMMENDATION_PYTHON', '/nonexistent/recommendation-python');
    try {
      const failed = await today().expect(503);
      expect(failed.body).toMatchObject({
        code: 'ROUTINE_ALGORITHM_UNAVAILABLE',
      });
      expect(
        await db.workoutRoutine.count({ where: { userId: owner.user.id } }),
      ).toBe(0);
      expect(
        await db.workoutRoutineRequest.count({
          where: { userId: owner.user.id },
        }),
      ).toBe(0);
    } finally {
      config.set('RECOMMENDATION_PYTHON', configured);
    }
    const saved = (await today().expect(201)).body as Routine;
    config.set('RECOMMENDATION_PYTHON', '/nonexistent/recommendation-python');
    try {
      await read(saved.id).expect(200, saved);
      await today().expect(200, saved);
      const history = await read('history').expect(200);
      expect(history.body).toMatchObject({ items: [saved], nextCursor: null });
    } finally {
      config.set('RECOMMENDATION_PYTHON', configured);
    }
  });
});
