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
import { RecommendationsService } from '../src/recommendations/recommendations.service.js';
import { WorkoutCatalogService } from '../src/recommendations/workout-catalog.service.js';
import { catalogHash, loadCatalog } from '../src/recommendations/catalog.js';
import type { RecommendationCatalog } from '../src/recommendations/catalog.js';
import { vector } from '../src/recommendations/engine.js';
import { MeasurementsService } from '../src/measurements/measurements.service.js';
import { parseCreate } from '../src/measurements/measurement-input.js';

type Account = { user: { id: string }; access_token: string };
type Workout = Awaited<ReturnType<RecommendationsService['get']>>;
const videos = ['TEST_A.mp4', 'TEST_B.mp4'].map((videoId) => ({
  videoId,
  title: `[TEST ONLY] ${videoId}`,
  originalUrl: `http://openapi.kspo.or.kr/web/video/${videoId}`,
  ageGroup: '공통',
  equipment: [],
  fitnessWeights: { ...vector(), strength: 1 },
  durationSeconds: 100,
}));
const catalog: RecommendationCatalog = {
  version: `test-workouts-${randomUUID()}`,
  sourceCommit: 'test-fixture',
  sourceUrls: ['https://example.test/fixture'],
  checkedOn: '2026-09-27',
  contentHash: catalogHash(videos),
  videos,
};

describe('Daily workouts API against isolated PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let service: RecommendationsService;
  let catalogs: WorkoutCatalogService;
  let measurements: MeasurementsService;
  let owner: Account;
  let other: Account;
  let now = new Date('2026-09-26T14:59:59Z');
  let rngCalls = 0;
  const users: string[] = [];
  const devices = new Map<string, { id: string; sequence: number }>();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RecommendationsService)
      .useFactory({
        factory: (db: DatabaseService) =>
          new RecommendationsService(
            db,
            () => now,
            () => {
              rngCalls++;
              return 0.25;
            },
          ),
        inject: [DatabaseService],
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
    service = app.get(RecommendationsService);
    catalogs = app.get(WorkoutCatalogService);
    measurements = app.get(MeasurementsService);
    owner = await register();
    other = await register();
  });
  beforeEach(async () => {
    now = new Date('2026-09-26T14:59:59Z');
    rngCalls = 0;
    devices.clear();
    await database.userCurriculumAssignment.deleteMany({
      where: { userId: { in: users } },
    });
    await database.measurement.deleteMany({ where: { userId: { in: users } } });
    await database.user.updateMany({
      where: { id: { in: users } },
      data: { dateOfBirth: new Date('2000-01-01T00:00:00Z') },
    });
    await catalogs.activate(catalog);
  });
  afterAll(async () => {
    await database?.user.deleteMany({ where: { id: { in: users } } });
    await app?.close();
  });
  async function register() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `workouts-${randomUUID()}@example.test`,
        password: 'workouts integration secure password',
      })
      .expect(201);
    const account = response.body as Account;
    users.push(account.user.id);
    return account;
  }
  async function measure(extra: Record<string, unknown> = {}) {
    return (
      await measurements.create(
        owner.user.id,
        randomUUID(),
        parseCreate({
          catalogVersion: 'nfa100-2026-09-24-grip-v1',
          measuredOn: '2026-09-20',
          ageAtMeasurement: 26,
          sexAtMeasurement: 'male',
          entryMethod: 'self_assessment',
          items: [{ measurementCode: 'cross_sit_up', value: '0', unit: '회' }],
          ...extra,
        }),
      )
    ).record;
  }
  const today = (key = randomUUID(), account = owner, body = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/workouts/today')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const get = (id: string, account = owner) =>
    request(app.getHttpServer())
      .get(`/api/v1/workouts/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`);
  function event(
    id: string,
    type: string,
    intervals: Array<{ start: number; end: number }> = [],
    extra: Record<string, unknown> = {},
    key = randomUUID(),
    account = owner,
  ) {
    const state = devices.get(id) ?? { id: randomUUID(), sequence: 0 };
    state.sequence++;
    devices.set(id, state);
    return request(app.getHttpServer())
      .post(`/api/v1/workouts/${id}/events`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('Idempotency-Key', key)
      .send({
        type,
        deviceId: state.id,
        sequence: state.sequence,
        intervals,
        positionSeconds: intervals.at(-1)?.end ?? 0,
        ...extra,
      });
  }
  async function assign() {
    await measure();
    return (await today().expect(201)).body as Workout;
  }

  it('keeps reads empty and exposes DOB/measurement/age readiness without creating assignments', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/workouts/current')
      .expect(401);
    expect(await service.current(owner.user.id)).toBeNull();
    const empty = await request(app.getHttpServer())
      .get('/api/v1/workouts/current')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .expect(200);
    expect(empty.headers['content-type']).toMatch(/application\/json/);
    expect(empty.text).toBe('null');
    await database.user.update({
      where: { id: owner.user.id },
      data: { dateOfBirth: null },
    });
    expect((await today().expect(409)).body).toMatchObject({
      code: 'DATE_OF_BIRTH_REQUIRED',
    });
    await database.user.update({
      where: { id: owner.user.id },
      data: { dateOfBirth: new Date('2000-01-01') },
    });
    expect((await today().expect(409)).body).toMatchObject({
      code: 'MEASUREMENT_REQUIRED',
    });
    await database.user.update({
      where: { id: owner.user.id },
      data: { dateOfBirth: new Date('1900-01-01') },
    });
    expect((await today().expect(409)).body).toMatchObject({
      code: 'AGE_UNSUPPORTED',
    });
    expect(
      await database.userCurriculumAssignment.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
    await today(randomUUID(), owner, { date: '2026-09-25' }).expect(400);
  });
  it('serializes distinct concurrent request keys and snapshots the latest single measurement', async () => {
    await measure({
      measuredOn: '2026-09-19',
      items: [{ measurementCode: 'sit_and_reach', value: '20', unit: 'cm' }],
    });
    const selected = await measure();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => today()),
    );
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 200, 200, 200, 201,
    ]);
    expect(rngCalls).toBe(1);
    const first = responses[0].body as Workout;
    expect(new Set(responses.map((r) => (r.body as Workout).id)).size).toBe(1);
    expect(first.inputSnapshot).toMatchObject({
      measurementId: selected.id,
      measurementRevision: selected.revision,
      currentAge: 26,
      referenceDate: '2026-09-26',
      catalogVersion: catalog.version,
    });
    expect((first.inputSnapshot as { factors: unknown[] }).factors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factor: 'flexibility',
          status: 'not_measured',
        }),
        expect.objectContaining({
          factor: 'muscularEndurance',
          status: 'below_standard',
          grade: null,
          need: 1,
        }),
      ]),
    );
    await measure({ measuredOn: '2026-09-21' });
    expect((await today().expect(200)).body).toEqual(first);
    expect(rngCalls).toBe(1);
    expect(
      await database.userCurriculumAssignment.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(1);
    expect(
      await database.workoutAssignmentRequest.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(6);
    await get(first.id, other).expect(404);
    await event(first.id, 'start', [], {}, randomUUID(), other).expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workouts/history?cursor=${first.id}`)
      .set('Authorization', `Bearer ${other.access_token}`)
      .expect(404);
  });
  it('unions seeks/repeats, preserves provisional pause and finalizes 49.9% vs exactly 50%', async () => {
    const first = await assign();
    await event(first.id, 'progress', [{ start: 0, end: 5 }]).expect(409);
    await event(first.id, 'start').expect(200);
    await event(first.id, 'progress', [
      { start: 0, end: 20 },
      { start: 70, end: 80 },
    ]).expect(200);
    const repeat = (
      await event(first.id, 'pause', [
        { start: 0, end: 20 },
        { start: 10, end: 39.9 },
      ]).expect(200)
    ).body as Workout;
    expect(repeat.status).toBe('in_progress');
    expect(repeat.resultStatus).toBeNull();
    expect(repeat.progress.watchedSeconds).toBeCloseTo(49.9);
    const ended = (await event(first.id, 'end').expect(200)).body as Workout;
    expect(ended.status).toBe('not_performed');
    expect(ended.progress.watchedSeconds).toBeCloseTo(49.9);
    expect(ended.weightAdjustment.strength.delta).toBe(0);
    expect((await today().expect(200)).body).toEqual(ended);
    await event(first.id, 'start').expect(200);
    await event(first.id, 'progress', [{ start: 39.9, end: 40 }]).expect(200);
    const interrupted = (await event(first.id, 'end').expect(200))
      .body as Workout;
    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.progress.watchedSeconds).toBe(50);
    expect(interrupted.weightAdjustment.strength.delta).toBe(0.15);
    await event(first.id, 'start').expect(200);
    const completed = (await event(first.id, 'complete').expect(200))
      .body as Workout;
    expect(completed.status).toBe('completed');
    expect(completed.progress.watchedSeconds).toBe(50);
    expect(completed.weightAdjustment.strength.delta).toBe(0.3);
    expect(
      await database.userCurriculumAssignment.count({
        where: { userId: owner.user.id, resultStatus: 'completed' },
      }),
    ).toBe(1);
    const repeated = await Promise.all([
      event(first.id, 'complete', [], { deviceId: randomUUID(), sequence: 1 }),
      event(first.id, 'complete', [], { deviceId: randomUUID(), sequence: 1 }),
    ]);
    expect(repeated.map((r) => r.status)).toEqual([200, 200]);
    expect(repeated.map((r) => (r.body as Workout).revision)).toEqual([
      completed.revision,
      completed.revision,
    ]);
    expect(
      repeated.map((r) => (r.body as Workout).weightAdjustment.strength.delta),
    ).toEqual([0.3, 0.3]);
    await event(first.id, 'start').expect(409);
    await get(first.id).expect(200, completed);
  });
  it('deduplicates event retries/concurrent devices and rejects stale, swapped and future inputs', async () => {
    const first = await assign();
    await event(first.id, 'start').expect(200);
    const key = randomUUID();
    const body = {
      type: 'progress',
      deviceId: randomUUID(),
      sequence: 1,
      intervals: [{ start: 0, end: 60 }],
      positionSeconds: 60,
    };
    const send = (payload = body, requestKey = key) =>
      request(app.getHttpServer())
        .post(`/api/v1/workouts/${first.id}/events`)
        .set('Authorization', `Bearer ${owner.access_token}`)
        .set('Idempotency-Key', requestKey)
        .send(payload);
    const replay = await Promise.all([send(), send()]);
    expect(replay.map((r) => r.status)).toEqual([200, 200]);
    expect(replay[0].body).toEqual(replay[1].body);
    await send({ ...body, positionSeconds: 20 }).expect(409);
    await send(body, randomUUID()).expect(409);
    const concurrent = await Promise.all([
      send(
        {
          ...body,
          deviceId: randomUUID(),
          intervals: [{ start: 40, end: 80 }],
          positionSeconds: 80,
        },
        randomUUID(),
      ),
      send(
        {
          ...body,
          deviceId: randomUUID(),
          intervals: [{ start: 70, end: 90 }],
          positionSeconds: 90,
        },
        randomUUID(),
      ),
    ]);
    expect(concurrent.map((r) => r.status)).toEqual([200, 200]);
    expect(
      ((await get(first.id).expect(200)).body as Workout).progress
        .watchedSeconds,
    ).toBe(90);
    await event(first.id, 'progress', [], {
      occurredAt: '2026-09-26T15:00:00Z',
    }).expect(400);
    await event(first.id, 'progress', [], { videoId: 'spoofed' }).expect(400);
    await event(first.id, 'progress', [{ start: 0, end: 101 }]).expect(400);
    await event(first.id, 'progress', [], { positionSeconds: -1 }).expect(400);
    expect(
      await database.workoutProgressEvent.count({
        where: { assignmentId: first.id, key },
      }),
    ).toBe(1);
  });
  it('rolls over KST midnight and saves late results without replacing the new current', async () => {
    await measure();
    const key = randomUUID();
    const old = (await today(key).expect(201)).body as Workout;
    await event(old.id, 'start').expect(200);
    now = new Date('2026-09-26T15:00:01Z');
    expect((await service.current(owner.user.id))?.koreanDate).toBe(
      '2026-09-26',
    );
    const next = (await today().expect(201)).body as Workout;
    expect(next.id).not.toBe(old.id);
    expect(next.koreanDate).toBe('2026-09-27');
    expect(((await today(key).expect(200)).body as Workout).id).toBe(old.id);
    const completed = (
      await event(old.id, 'complete', [], {
        occurredAt: '2026-09-26T14:59:59Z',
      }).expect(200)
    ).body as Workout;
    expect(completed.performedAt).toBe('2026-09-26T15:00:01.000Z');
    expect(completed.koreanDate).toBe('2026-09-26');
    expect((await service.current(owner.user.id))?.id).toBe(next.id);
    expect(
      (await service.history(owner.user.id)).items.map((r) => r.id),
    ).toEqual([next.id, old.id]);
    expect(completed.progress.watchedSeconds).toBe(0);
    expect(completed.status).toBe('completed');
  });
  it('retires legacy unfinished current assignment while preserving definition and history', async () => {
    const definition = await database.workoutCurriculum.create({
      data: { name: '[TEST ONLY] Legacy' },
    });
    const legacy = await database.userCurriculumAssignment.create({
      data: {
        userId: owner.user.id,
        currentForUserId: owner.user.id,
        curriculumId: definition.id,
        requestKey: randomUUID(),
        assignedAt: new Date('2026-09-25T00:00:00Z'),
      },
    });
    const first = await assign();
    expect(first.id).not.toBe(legacy.id);
    expect(
      await database.userCurriculumAssignment.findUnique({
        where: { id: legacy.id },
      }),
    ).toMatchObject({
      status: 'assigned',
      currentForUserId: null,
      supersededAt: now,
    });
    await expect(
      database.workoutCurriculum.update({
        where: { id: definition.id },
        data: { name: 'rewritten' },
      }),
    ).rejects.toThrow();
    await expect(
      database.userCurriculumAssignment.update({
        where: { id: first.id },
        data: { assignmentDate: new Date('2026-09-25') },
      }),
    ).rejects.toThrow();
  });
  it('enforces daily uniqueness in DB and exposes unavailable catalog without generating fallback', async () => {
    await database.workoutCatalogActivation.delete({
      where: { id: 'current' },
    });
    await measure();
    expect((await today().expect(503)).body).toMatchObject({
      code: 'WORKOUT_CATALOG_UNAVAILABLE',
    });
    expect(
      await database.userCurriculumAssignment.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
    await catalogs.activate(catalog);
    const first = (await today().expect(201)).body as Workout;
    const row = await database.userCurriculumAssignment.findUniqueOrThrow({
      where: { id: first.id },
    });
    await expect(
      database.userCurriculumAssignment.create({
        data: {
          userId: owner.user.id,
          curriculumId: row.curriculumId,
          requestKey: randomUUID(),
          assignmentDate: row.assignmentDate,
          algorithmVersion: row.algorithmVersion,
          inputSnapshot: {},
          assignedAt: now,
        },
      }),
    ).rejects.toThrow();
    const ended = (await event(first.id, 'start').expect(200)).body as Workout;
    expect(ended.video.playbackUrl).toBeNull();
    expect(ended.video.playbackStatus).toBe('unavailable');
  });

  it('excludes not-performed from tomorrow exposure and uses interrupted with one-day decay', async () => {
    const first = await assign();
    await event(first.id, 'start').expect(200);
    await event(first.id, 'end', [{ start: 0, end: 49.9 }]).expect(200);
    now = new Date('2026-09-26T15:00:01Z');
    const second = (await today().expect(201)).body as Workout;
    expect(second.inputSnapshot).toMatchObject({ exposure: { strength: 0 } });
    await event(second.id, 'start').expect(200);
    await event(second.id, 'end', [{ start: 0, end: 50 }]).expect(200);
    now = new Date('2026-09-27T15:00:01Z');
    const third = (await today().expect(201)).body as Workout;
    expect(
      (third.inputSnapshot as { exposure: { strength: number } }).exposure
        .strength,
    ).toBeCloseTo(0.15 * 0.5 ** (1 / 7), 12);
    expect(third.video.id).not.toBe(second.video.id);
  });

  it('atomically imports all actual 731 videos, deduplicates reimport and preserves old versions', async () => {
    const real = loadCatalog();
    expect(await catalogs.activate(real)).toMatchObject({ videoCount: 731 });
    expect(await catalogs.activate(real)).toMatchObject({ reused: true });
    expect(
      await database.workoutVideo.count({
        where: { catalogVersion: real.version },
      }),
    ).toBe(731);
    const bad = structuredClone(real);
    bad.version += '-bad';
    bad.videos[0].fitnessWeights = vector();
    bad.contentHash = catalogHash(bad.videos);
    await expect(catalogs.activate(bad)).rejects.toThrow(/weight sum/);
    expect(
      (
        await database.workoutCatalogActivation.findUniqueOrThrow({
          where: { id: 'current' },
        })
      ).catalogVersion,
    ).toBe(real.version);
    expect(
      await database.workoutCatalog.findUnique({
        where: { version: bad.version },
      }),
    ).toBeNull();
    await measure();
    const assigned = (await today().expect(201)).body as Workout;
    expect(assigned.video.catalogVersion).toBe(real.version);
    expect(assigned.video.durationSeconds).toBeGreaterThanOrEqual(32);
    await catalogs.activate(catalog);
    expect(
      ((await get(assigned.id).expect(200)).body as Workout).video.id,
    ).toBe(assigned.video.id);
    expect(
      await database.workoutVideo.count({
        where: { catalogVersion: real.version },
      }),
    ).toBe(731);
  });
});
