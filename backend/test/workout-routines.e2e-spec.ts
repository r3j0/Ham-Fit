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
import * as media from '../src/recommendations/media.js';
import type { PlaybackEventInput } from '../src/recommendations/playback.js';
import { configureApp } from '../src/setup-app.js';
import { memberProfiles } from '../src/users/member-profile.js';

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
  const snapshot = (routine: Routine) =>
    db.workoutRoutine.findUniqueOrThrow({
      where: { id: routine.id },
      include: {
        items: {
          orderBy: { order: 'asc' },
          include: { events: { orderBy: { key: 'asc' } } },
        },
        requests: { orderBy: { key: 'asc' } },
      },
    });
  const activity = () =>
    db.$transaction(async (tx) =>
      (await memberProfiles(tx, [owner.user.id], now)).get(owner.user.id),
    );

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
    await event(current, 0, body()).expect(200);
    now = new Date('2026-09-29T15:00:00Z');
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
        expect(await activity()).toMatchObject({
          streak: 1,
          totalWorkoutDays: 1,
        });
        await today().expect(200, saved);
        expect(spy).not.toHaveBeenCalled();
        expect(
          await db.workoutRoutine.count({ where: { userId: owner.user.id } }),
        ).toBe(1);
        now = new Date('2026-09-29T15:00:00Z');
        expect(await activity()).toMatchObject({
          streak: 1,
          totalWorkoutDays: 1,
        });
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
      // A delayed stop is rejected, preserving the actual saved day and events.
      const before = await snapshot(routine);
      expect((await event(routine, 0, body('end')).expect(409)).body.code).toBe(
        'ROUTINE_EXPIRED',
      );
      expect(await snapshot(routine)).toEqual(before);
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

  it.each([
    'assigned',
    'in_progress',
    'not_performed',
    'interrupted',
    'completed',
  ] as const)(
    'rejects every new expired event for %s items without changing any saved row or activity',
    async (status) => {
      await prepare(owner, 'less');
      const routine = (await today().expect(201)).body as Routine;
      const device = randomUUID();
      const startKey = randomUUID();
      const start = body('start', 1, device);
      const duration = routine.routine[0].progress.durationSeconds;
      const stopKey = randomUUID();
      const watched =
        status === 'completed'
          ? duration * 0.8
          : status === 'interrupted'
            ? duration * 0.4
            : 0;
      const stop = {
        ...body('pause', 2, device),
        positionSeconds: watched,
        intervals: watched ? [{ start: 0, end: watched }] : [],
      };
      if (status !== 'assigned') {
        await event(routine, 0, start, startKey).expect(200);
        if (status !== 'in_progress')
          await event(routine, 0, stop, stopKey).expect(200);
      }
      const saved = (await read(routine.id).expect(200)).body as Routine;
      expect(saved.routine[0].status).toBe(status);
      const before = await snapshot(routine);
      now = new Date('2026-09-29T15:00:00Z');
      const activityBefore = await activity();
      for (const [index, type] of [
        'start',
        'progress',
        'pause',
        'end',
        'complete',
      ].entries()) {
        const rejected = await event(routine, 0, {
          ...body(type, index + 3, device),
          positionSeconds: duration,
          intervals: [{ start: 0, end: duration }],
          // A client clock cannot backdate a newly received request across midnight.
          occurredAt: '2026-09-29T14:59:58Z',
        }).expect(409);
        expect(rejected.body).toMatchObject({
          statusCode: 409,
          code: 'ROUTINE_EXPIRED',
          serverTime: '2026-09-29T15:00:00.000Z',
          serverKoreanDate: '2026-09-30',
          recordingAllowed: false,
          recordingExpiresAt: '2026-09-29T15:00:00.000Z',
        });
        expect(await snapshot(routine)).toEqual(before);
      }
      if (status !== 'assigned') {
        const retry = await event(routine, 0, start, startKey).expect(200);
        expect(retry.headers['idempotency-replayed']).toBe('true');
        expect(retry.body.recordingAllowed).toBe(false);
        if (status !== 'in_progress') {
          const stopRetry = await event(routine, 0, stop, stopKey).expect(200);
          expect(stopRetry.headers['idempotency-replayed']).toBe('true');
        }
        const conflict = await event(
          routine,
          0,
          { ...start, positionSeconds: 1 },
          startKey,
        ).expect(409);
        expect(conflict.body.code).toBe('WORKOUT_CONFLICT');
      }
      const detail = (await read(routine.id).expect(200)).body as Routine;
      expect(detail).toMatchObject({
        recordingAllowed: false,
        serverKoreanDate: '2026-09-30',
        routine: saved.routine,
        inputSnapshot: saved.inputSnapshot,
      });
      const history = await read('history').expect(200);
      expect(history.body.items).toEqual([detail]);
      await read('current').expect(200, 'null');
      expect(await snapshot(routine)).toEqual(before);
      expect(await activity()).toEqual(activityBefore);
    },
  );

  it('does not complete a playing routine when its final stop first arrives at or after KST midnight', async () => {
    await prepare(owner, 'less');
    const routine = (await today().expect(201)).body as Routine;
    expect(routine).toMatchObject({
      recordingAllowed: true,
      serverTime: '2026-09-29T14:59:59.000Z',
      recordingExpiresAt: '2026-09-29T15:00:00.000Z',
    });
    const device = randomUUID();
    let progress: PlaybackEventInput = {
      ...body('progress', 2, device),
      type: 'progress',
    };
    const progressKey = randomUUID();
    for (const [index, item] of routine.routine.entries()) {
      await event(routine, index, body('start', 1, device)).expect(200);
      const watched = item.progress.durationSeconds * 0.8;
      const input = {
        ...body('progress', 2, device),
        type: index === 2 ? ('progress' as const) : ('complete' as const),
        positionSeconds: watched,
        intervals: [{ start: 0, end: watched }],
      };
      if (index === 2) progress = input;
      await event(
        routine,
        index,
        input,
        index === 2 ? progressKey : randomUUID(),
      ).expect(200);
    }
    expect(await activity()).toMatchObject({ totalWorkoutDays: 0, streak: 0 });
    const before = await snapshot(routine);
    for (const timestamp of ['2026-09-29T15:00:00Z', '2026-09-29T15:00:01Z']) {
      now = new Date(timestamp);
      const late = await event(routine, 2, {
        ...progress,
        type: 'complete',
        sequence: 3,
        occurredAt: '2026-09-29T14:59:59Z',
      }).expect(409);
      expect(late.body.code).toBe('ROUTINE_EXPIRED');
    }
    await event(routine, 2, progress, progressKey).expect(200);
    const detail = (await read(routine.id).expect(200)).body as Routine;
    expect(detail.routine[2].status).toBe('in_progress');
    expect(detail.progress).toEqual({ completedItems: 2, totalItems: 3 });
    expect(await snapshot(routine)).toEqual(before);
    expect(await activity()).toMatchObject({ totalWorkoutDays: 0, streak: 0 });
  });

  it("keeps recommendation logs unchanged after expired viewing attempts and still records the same video in today's item", async () => {
    await prepare(owner, 'less');
    const yesterday = (await today().expect(201)).body as Routine;
    await event(yesterday, 0, body()).expect(200);
    await event(yesterday, 0, {
      ...body('pause'),
      positionSeconds: 10,
      intervals: [{ start: 0, end: 10 }],
    }).expect(200);
    const before = await snapshot(yesterday);
    now = new Date('2026-09-29T15:00:00Z');
    const spy = vi.spyOn(algorithm, 'recommend');
    try {
      await today().expect(201);
      const logsBefore = spy.mock.calls[0][0].logs;
      expect(logsBefore).toEqual([
        {
          videoId: yesterday.routine[0].videoId,
          date: '2026-09-29T14:59:59.000Z',
          completed: false,
        },
      ]);
      await event(yesterday, 0, body('start')).expect(409);
      await event(yesterday, 0, {
        ...body('pause'),
        positionSeconds: 20,
        intervals: [{ start: 0, end: 20 }],
      }).expect(409);
      now = new Date('2026-09-30T15:00:00Z');
      // Use the real algorithm input before and after, without writing today's outcomes.
      await today().expect(201);
      expect(spy.mock.calls[1][0].logs).toEqual(logsBefore);
      expect(await snapshot(yesterday)).toEqual(before);
      // Clone the saved output only for this test's deterministic same-video fixture.
      const old = yesterday.routine[0];
      // Random tie selection need not return the same video: make a separate next-day fixture.
      const nextDay = await db.workoutRoutine.create({
        data: {
          userId: owner.user.id,
          assignmentDate: new Date('2026-10-02T00:00:00Z'),
          referenceDate: new Date('2026-10-02T00:00:00Z'),
          algorithmVersion: 'test-only',
          dataVersion: yesterday.dataVersion,
          estimatedMinutes: 1,
          inputSnapshot: {},
          items: {
            create: {
              order: 1,
              videoId: old.videoId,
              title: old.title,
              videoUrl: old.videoUrl,
              durationSeconds: old.progress.durationSeconds,
              slot: old.slot,
              prescription: old.prescription as Prisma.InputJsonObject,
            },
          },
        },
      });
      const future = (await read(nextDay.id).expect(200)).body as Routine;
      expect(future.recordingAllowed).toBe(false);
      expect((await event(future, 0, body()).expect(409)).body.code).toBe(
        'ROUTINE_NOT_DUE',
      );
      now = new Date('2026-10-01T15:00:00Z');
      const due = (await read(nextDay.id).expect(200)).body as Routine;
      expect(due.recordingAllowed).toBe(true);
      const device = randomUUID();
      await event(due, 0, body('start', 1, device)).expect(200);
      const watched = old.progress.durationSeconds * 0.8;
      const completed = (
        await event(due, 0, {
          ...body('complete', 2, device),
          positionSeconds: watched,
          intervals: [{ start: 0, end: watched }],
        }).expect(200)
      ).body as Routine;
      expect(completed.status).toBe('completed');
      expect(completed.routine[0].performedAt).toBe(now.toISOString());
      expect(await snapshot(yesterday)).toEqual(before);
      expect(await activity()).toMatchObject({
        streak: 1,
        totalWorkoutDays: 1,
      });
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
      await event(routine, index, body()).expect(409);
      const watched = routine.routine[index].progress.durationSeconds * 0.8;
      await event(routine, index, {
        ...body('end'),
        positionSeconds: watched,
        intervals: [{ start: 0, end: watched }],
      }).expect(409);
    }
    const all = (await read(routine.id).expect(200)).body as Routine;
    expect(all.status).toBe('interrupted');
    expect(all.progress).toEqual({ completedItems: 1, totalItems: 3 });
  });

  it.each(
    (['pause', 'end', 'complete'] as const).flatMap((type) =>
      [0, 0.3].map((ratio) => ({ type, ratio })),
    ),
  )(
    'preserves the outcome time after a same-day restart without new viewing ($type, $ratio)',
    async ({ type, ratio }) => {
      now = new Date('2026-09-29T01:00:00Z');
      await prepare(owner, 'less');
      const routine = (await today().expect(201)).body as Routine;
      const duration = routine.routine[0].progress.durationSeconds;
      const watched = duration * ratio;
      const intervals = watched ? [{ start: 0, end: watched }] : [];
      const device = randomUUID();
      await event(routine, 0, body('start', 1, device)).expect(200);
      await event(routine, 0, {
        ...body('progress', 2, device),
        positionSeconds: watched,
        intervals,
      }).expect(200);
      const stopped = (
        await event(routine, 0, body('pause', 3, device)).expect(200)
      ).body as Routine;
      const performedAt = now.toISOString();
      const resultStatus = watched ? 'interrupted' : 'not_performed';
      expect(stopped.routine[0]).toMatchObject({
        status: resultStatus,
        resultStatus,
        performedAt,
      });

      now = new Date('2026-09-29T06:00:00Z');
      const restarted = (
        await event(routine, 0, body('start', 4, device)).expect(200)
      ).body as Routine;
      expect(restarted.routine[0]).toMatchObject({
        status: 'in_progress',
        resultStatus,
        performedAt,
      });
      // Seeking and overlapping/cumulative progress reports add no unique viewing.
      await event(routine, 0, {
        ...body('progress', 5, device),
        positionSeconds: duration,
        intervals: [...intervals, ...intervals],
      }).expect(200);
      const unchanged = (
        await event(routine, 0, body(type, 6, device)).expect(200)
      ).body as Routine;
      expect(unchanged.routine[0]).toMatchObject({
        status: resultStatus,
        resultStatus,
        performedAt,
        completedAt: null,
      });
      expect(unchanged.routine[0].progress.watchedSeconds).toBeCloseTo(watched);
      expect(unchanged.routine[0].revision).toBe(
        stopped.routine[0].revision + 3,
      );
      now = new Date('2026-09-29T07:00:00Z');
      const repeated = (
        await event(routine, 0, {
          ...body(type, 7, device),
          positionSeconds: watched,
          intervals,
        }).expect(200)
      ).body as Routine;
      expect(repeated.routine[0].performedAt).toBe(performedAt);
      const stored = await db.workoutRoutineItem.findUniqueOrThrow({
        where: { id: routine.routine[0].id },
      });
      expect(stored.performedAt?.toISOString()).toBe(performedAt);
      expect(
        (await read('history').expect(200)).body.items[0].routine[0],
      ).toMatchObject({ resultStatus, performedAt });
    },
  );

  it.each(['pause', 'end', 'complete'] as const)(
    'updates the outcome time for new viewing saved by progress before %s',
    async (type) => {
      now = new Date('2026-09-29T01:00:00Z');
      await prepare(owner, 'less');
      const routine = (await today().expect(201)).body as Routine;
      const duration = routine.routine[0].progress.durationSeconds;
      const device = randomUUID();
      const otherDevice = randomUUID();
      await event(routine, 0, body('start', 1, device)).expect(200);
      const stopped = (
        await event(routine, 0, {
          ...body('pause', 2, device),
          positionSeconds: duration * 0.2,
          intervals: [{ start: 0, end: duration * 0.2 }],
        }).expect(200)
      ).body as Routine;
      expect(stopped.routine[0].performedAt).toBe(now.toISOString());
      await event(routine, 0, body('start', 3, device)).expect(200);
      // All these events share a receipt timestamp; revisions identify the boundary.
      const progress = (
        await event(routine, 0, {
          ...body('progress', 1, otherDevice),
          positionSeconds: duration * 0.4,
          intervals: [{ start: duration * 0.2, end: duration * 0.4 }],
        }).expect(200)
      ).body as Routine;
      expect(progress.routine[0].performedAt).toBe(
        stopped.routine[0].performedAt,
      );
      now = new Date('2026-09-29T06:00:00Z');
      const updated = (
        await event(routine, 0, body(type, 4, device)).expect(200)
      ).body as Routine;
      const performedAt = now.toISOString();
      expect(updated.routine[0]).toMatchObject({
        status: 'interrupted',
        resultStatus: 'interrupted',
        performedAt,
      });
      expect(updated.routine[0].progress.watchedSeconds).toBeCloseTo(
        duration * 0.4,
      );
      now = new Date('2026-09-29T07:00:00Z');
      expect(
        (await event(routine, 0, body(type, 5, device)).expect(200)).body
          .routine[0].performedAt,
      ).toBe(performedAt);

      // A result change still records the new completion time.
      await event(routine, 0, body('start', 6, device)).expect(200);
      await event(routine, 0, {
        ...body('progress', 2, otherDevice),
        positionSeconds: duration * 0.8,
        intervals: [{ start: duration * 0.4, end: duration * 0.8 }],
      }).expect(200);
      now = new Date('2026-09-29T08:00:00Z');
      const completed = (
        await event(routine, 0, body(type, 7, device)).expect(200)
      ).body as Routine;
      expect(completed.routine[0]).toMatchObject({
        status: 'completed',
        resultStatus: 'completed',
        performedAt: now.toISOString(),
        completedAt: now.toISOString(),
      });
      const before = await snapshot(routine);
      now = new Date('2026-09-29T09:00:00Z');
      await event(routine, 0, body(type, 8, device)).expect(200);
      expect((await snapshot(routine)).items[0]).toMatchObject({
        performedAt: before.items[0].performedAt,
        completedAt: before.items[0].completedAt,
        revision: before.items[0].revision,
        intervals: before.items[0].intervals,
      });
    },
  );

  it('compares confirmed viewing on the catalog timeline despite raw verified-media overrun', async () => {
    now = new Date('2026-09-29T01:00:00Z');
    await prepare(owner, 'less');
    const routine = (await today().expect(201)).body as Routine;
    const item = routine.routine[0];
    const duration = item.progress.durationSeconds;
    const spy = vi.spyOn(media, 'mediaFor').mockReturnValue({
      playbackUrl: item.videoUrl.replace('http:', 'https:'),
      playbackStatus: 'verified',
      verifiedDurationSeconds: duration + 0.4,
    });
    try {
      const device = randomUUID();
      const intervals = [
        { start: duration - 0.2, end: duration + 0.4 },
        { start: duration + 0.1, end: duration + 0.4 },
      ];
      await event(routine, 0, {
        ...body('start', 1, device),
        positionSeconds: duration + 0.4,
        intervals,
      }).expect(200);
      const stopped = (
        await event(routine, 0, body('pause', 2, device)).expect(200)
      ).body as Routine;
      expect(stopped.routine[0].progress.watchedSeconds).toBeCloseTo(0.2);
      now = new Date('2026-09-29T06:00:00Z');
      await event(routine, 0, body('start', 3, device)).expect(200);
      const unchanged = (
        await event(routine, 0, body('pause', 4, device)).expect(200)
      ).body as Routine;
      expect(unchanged.routine[0].performedAt).toBe(
        stopped.routine[0].performedAt,
      );
      // A late stop from another device can still add a new distinct interval.
      now = new Date('2026-09-29T07:00:00Z');
      const added = (
        await event(routine, 0, {
          ...body('end'),
          positionSeconds: duration,
          intervals: [{ start: duration - 0.3, end: duration }],
        }).expect(200)
      ).body as Routine;
      expect(added.routine[0].progress.watchedSeconds).toBeCloseTo(0.3);
      expect(added.routine[0].performedAt).toBe(now.toISOString());
      const stored = await snapshot(routine);
      expect(
        stored.items[0].events.find(
          (entry) => entry.deviceId === device && entry.sequence === 1,
        )?.intervals,
      ).toEqual(intervals);
    } finally {
      spy.mockRestore();
    }
  });

  it('merges concurrent item progress and rejects invalid/reordered events atomically', async () => {
    await prepare(owner, 'less');
    const routine = (await today().expect(201)).body as Routine;
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

  it('bounds history by assignment or Korean completion date, pages without gaps and checks ownership', async () => {
    const empty = await read('history?from=2026-09-01&to=2026-09-01').expect(
      200,
    );
    expect(empty.body).toMatchObject({
      items: [],
      nextCursor: null,
      serverKoreanDate: '2026-09-29',
    });
    const rows = await Promise.all(
      Array.from({ length: 32 }, (_, index) => {
        const day = new Date(Date.UTC(2026, 7, 31 + index));
        const completedAt =
          index === 0
            ? new Date('2026-08-31T15:00:00Z')
            : index === 31
              ? new Date('2026-09-30T15:00:00Z')
              : null;
        return db.workoutRoutine.create({
          data: {
            userId: owner.user.id,
            assignmentDate: day,
            referenceDate: day,
            algorithmVersion: 'test-history-only',
            dataVersion: 'test-history-only',
            estimatedMinutes: 1,
            inputSnapshot: {},
            items: {
              create: {
                order: 1,
                videoId: 'TEST.mp4',
                title: '[TEST ONLY] bounded history',
                videoUrl: 'http://openapi.kspo.or.kr/web/video/TEST.mp4',
                durationSeconds: 60,
                slot: 'strength_group',
                prescription: {},
                ...(completedAt
                  ? {
                      status: 'completed',
                      resultStatus: 'completed',
                      performedAt: completedAt,
                      completedAt,
                    }
                  : {}),
              },
            },
          },
        });
      }),
    );
    const first = await read('history?from=2026-09-01&to=2026-09-30').expect(
      200,
    );
    const second = await read(
      `history?from=2026-09-01&to=2026-09-30&cursor=${first.body.nextCursor}`,
    ).expect(200);
    const found = [...first.body.items, ...second.body.items] as Routine[];
    expect(found).toHaveLength(31);
    expect(new Set(found.map((row) => row.id))).toEqual(
      new Set(rows.slice(0, 31).map((row) => row.id)),
    );
    expect(second.body.nextCursor).toBeNull();
    // Aug 31 assignment completed at Korean Sep 1 midnight is retained.
    const boundary = await read('history?from=2026-09-01&to=2026-09-01').expect(
      200,
    );
    expect(
      new Set((boundary.body.items as Routine[]).map((row) => row.id)),
    ).toEqual(new Set([rows[0].id, rows[1].id]));
    const nextMidnight = await read(
      'history?from=2026-09-30&to=2026-09-30',
    ).expect(200);
    expect((nextMidnight.body.items as Routine[]).map((row) => row.id)).toEqual(
      [rows[30].id],
    );
    await read(
      `history?from=2026-09-01&to=2026-09-30&cursor=${rows[0].id}`,
      await register(),
    ).expect(404);
    for (const query of [
      'from=2026-09-01',
      'from=2026-02-30&to=2026-03-01',
      'from=2026-01-01&to=2026-04-01',
    ]) {
      await read(`history?${query}`).expect(400);
    }
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
