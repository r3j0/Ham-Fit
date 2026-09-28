import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { configureApp } from '../src/setup-app.js';
import { RecommendationsService } from '../src/recommendations/recommendations.service.js';
import { WorkoutCatalogService } from '../src/recommendations/workout-catalog.service.js';
import { catalogHash } from '../src/recommendations/catalog.js';
import {
  DisconnectedWorkoutAlgorithm,
  WorkoutAlgorithm,
} from '../src/recommendations/workout-algorithm.js';
import { fixtureAdjustment, fixtureCatalog } from './fixtures/workouts.js';
import { MeasurementsService } from '../src/measurements/measurements.service.js';
import { parseCreate } from '../src/measurements/measurement-input.js';

type Account = { user: { id: string }; access_token: string };
type Workout = Awaited<ReturnType<RecommendationsService['get']>>;
const catalog = fixtureCatalog(`test-workouts-${randomUUID()}`);
const videos = catalog.videos;
const algorithm = {
  recommend: vi.fn<WorkoutAlgorithm['recommend']>(),
  weightAdjustment: vi.fn<WorkoutAlgorithm['weightAdjustment']>(),
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
  let mediaDirectory: string;
  const users: string[] = [];
  const devices = new Map<string, { id: string; sequence: number }>();
  beforeAll(async () => {
    mediaDirectory = mkdtempSync(join(tmpdir(), 'health-workouts-media-'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RecommendationsService)
      .useFactory({
        factory: (db: DatabaseService) =>
          new RecommendationsService(db, algorithm, () => now),
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
    vi.stubEnv(
      'WORKOUT_MEDIA_REPORT_PATH',
      join(mediaDirectory, 'missing.json'),
    );
    now = new Date('2026-09-26T14:59:59Z');
    algorithm.recommend.mockReset().mockImplementation((input) =>
      Promise.resolve({
        videoId: input.videos[0].videoId,
        algorithmVersion: 'test-only-provider',
        snapshot: { testOnly: true },
      }),
    );
    algorithm.weightAdjustment
      .mockReset()
      .mockResolvedValue(fixtureAdjustment());
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
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await database?.user.deleteMany({ where: { id: { in: users } } });
    await app?.close();
    rmSync(mediaDirectory, { recursive: true, force: true });
  });
  function verifiedMedia(actualDurationSeconds = 100.4, status = 'verified') {
    const path = join(mediaDirectory, `${randomUUID()}.json`);
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 2,
        sourceCommit: catalog.sourceCommit,
        durationToleranceSeconds: 1,
        videos: videos.map((video) => ({
          videoId: video.videoId,
          originalUrl: video.originalUrl,
          catalogDurationSeconds: video.durationSeconds,
          status,
          verifiedUrl: video.originalUrl.replace('http:', 'https:'),
          actualDurationSeconds,
          httpsVerified: true,
          rangeSupported: true,
          mp4Validated: true,
          sourceContentTypes: ['video/mp4'],
        })),
      }),
    );
    vi.stubEnv('WORKOUT_MEDIA_REPORT_PATH', path);
  }
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
  it('keeps the real provider disconnected and never writes a fallback recommendation', async () => {
    await measure();
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const disconnectedApp = module.createNestApplication();
    configureApp(disconnectedApp);
    await disconnectedApp.listen(0, '127.0.0.1');
    try {
      expect(disconnectedApp.get(WorkoutAlgorithm)).toBeInstanceOf(
        DisconnectedWorkoutAlgorithm,
      );
      const result = await request(disconnectedApp.getHttpServer())
        .post('/api/v1/workouts/today')
        .set('Authorization', `Bearer ${owner.access_token}`)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(503);
      expect(result.body).toMatchObject({
        code: 'RECOMMENDATION_NOT_CONNECTED',
      });
      expect(
        await database.userCurriculumAssignment.count({
          where: { userId: owner.user.id },
        }),
      ).toBe(0);
      expect(algorithm.recommend).not.toHaveBeenCalled();
      const existing = await assign();
      await request(disconnectedApp.getHttpServer())
        .get(`/api/v1/workouts/${existing.id}`)
        .set('Authorization', `Bearer ${owner.access_token}`)
        .expect(503);
      const failedEvent = await request(disconnectedApp.getHttpServer())
        .post(`/api/v1/workouts/${existing.id}/events`)
        .set('Authorization', `Bearer ${owner.access_token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          type: 'start',
          deviceId: randomUUID(),
          sequence: 1,
          intervals: [],
          positionSeconds: 0,
        })
        .expect(503);
      expect(failedEvent.body).toMatchObject({
        code: 'RECOMMENDATION_NOT_CONNECTED',
      });
      expect(
        await database.userCurriculumAssignment.findUniqueOrThrow({
          where: { id: existing.id },
        }),
      ).toMatchObject({ status: 'assigned', revision: 1 });
      expect(
        await database.workoutProgressEvent.count({
          where: { assignmentId: existing.id },
        }),
      ).toBe(0);
    } finally {
      await disconnectedApp.close();
    }
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
    expect(algorithm.recommend).toHaveBeenCalledTimes(1);
    const first = responses[0].body as Workout;
    expect(new Set(responses.map((r) => (r.body as Workout).id)).size).toBe(1);
    expect(first.inputSnapshot).toMatchObject({
      measurementId: selected.id,
      measurementRevision: selected.revision,
      currentAge: 26,
      referenceDate: '2026-09-26',
      catalogVersion: catalog.version,
    });
    expect(first.inputSnapshot).toMatchObject({ testOnly: true });
    const rawMeasurement = algorithm.recommend.mock.calls[0][0].measurement;
    expect(rawMeasurement.id).toBe(selected.id);
    expect(rawMeasurement.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          axis: 'flexibility',
          status: 'not_measured',
        }),
        expect.objectContaining({
          axis: 'muscular_endurance',
          status: 'below_standard',
          grade: null,
        }),
      ]),
    );
    await measure({ measuredOn: '2026-09-21' });
    expect((await today().expect(200)).body).toEqual(first);
    expect(algorithm.recommend).toHaveBeenCalledTimes(1);
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
    expect(ended.weightAdjustment).toEqual(fixtureAdjustment());
    expect(algorithm.weightAdjustment.mock.lastCall?.[0].logs).toEqual([]);
    expect((await today().expect(200)).body).toEqual(ended);
    await event(first.id, 'start').expect(200);
    await event(first.id, 'progress', [{ start: 39.9, end: 40 }]).expect(200);
    const interrupted = (await event(first.id, 'end').expect(200))
      .body as Workout;
    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.progress.watchedSeconds).toBe(50);
    expect(interrupted.weightAdjustment).toEqual(fixtureAdjustment());
    expect(algorithm.weightAdjustment.mock.lastCall?.[0].logs).toHaveLength(1);
    expect(algorithm.weightAdjustment.mock.lastCall?.[0].logs[0]).toMatchObject(
      { completed: false },
    );
    await event(first.id, 'start').expect(200);
    const completed = (await event(first.id, 'complete').expect(200))
      .body as Workout;
    expect(completed.status).toBe('completed');
    expect(completed.progress.watchedSeconds).toBe(50);
    expect(completed.weightAdjustment).toEqual(fixtureAdjustment());
    expect(algorithm.weightAdjustment.mock.lastCall?.[0].logs).toHaveLength(1);
    expect(algorithm.weightAdjustment.mock.lastCall?.[0].logs[0]).toMatchObject(
      { completed: true },
    );
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
    ).toEqual([0.222, 0.222]);
    await event(first.id, 'start').expect(409);
    await get(first.id).expect(200, completed);
  });
  it.each(['progress', 'end', 'complete'])(
    'accepts the verified 100.4-second endpoint for %s on a 100-second catalog video',
    async (type) => {
      verifiedMedia();
      const first = await assign();
      expect(first.video).toMatchObject({
        durationSeconds: 100,
        playbackStatus: 'verified',
        verifiedDurationSeconds: 100.4,
      });
      await event(first.id, 'start').expect(200);
      const key = randomUUID();
      const extra = { deviceId: randomUUID(), sequence: 1 };
      const saved = (
        await event(
          first.id,
          type,
          [{ start: 0, end: 100.4 }],
          extra,
          key,
        ).expect(200)
      ).body as Workout;
      expect(saved.status).toBe(
        type === 'end'
          ? 'interrupted'
          : type === 'complete'
            ? 'completed'
            : 'in_progress',
      );
      expect(saved.progress).toMatchObject({
        durationSeconds: 100,
        watchedSeconds: 100,
        positionSeconds: 100,
        intervals: [{ start: 0, end: 100 }],
        ratio: 1,
      });
      await event(
        first.id,
        type,
        [{ start: 0, end: 100.4 }],
        extra,
        key,
      ).expect(200, saved);
      // Equal normalized progress is still a different raw request under the same key.
      await event(first.id, type, [{ start: 0, end: 100 }], extra, key).expect(
        409,
      );
      await get(first.id).expect(200, saved);
      expect(
        await database.workoutProgressEvent.findFirstOrThrow({
          where: { assignmentId: first.id, type },
        }),
      ).toMatchObject({
        positionSeconds: 100.4,
        intervals: [{ start: 0, end: 100.4 }],
      });
    },
  );
  it.each([
    ['verified', 100.4, 100.5],
    ['duration_mismatch', 104, 100.4],
    ['unavailable', 100.4, 100.4],
  ] as const)(
    'rejects out-of-bounds positions and intervals without writing when media is %s',
    async (status, duration, endpoint) => {
      verifiedMedia(duration, status);
      const first = await assign();
      expect(first.video.playbackStatus).toBe(status);
      const started = (await event(first.id, 'start').expect(200))
        .body as Workout;
      for (const [intervals, positionSeconds] of [
        [[], endpoint],
        [[{ start: 0, end: endpoint }], 100],
      ] as const) {
        const failed = await event(first.id, 'end', [...intervals], {
          positionSeconds,
        }).expect(400);
        expect(failed.body).toMatchObject({ code: 'INVALID_PLAYBACK_EVENT' });
      }
      await get(first.id).expect(200, started);
      expect(
        await database.workoutProgressEvent.count({
          where: { assignmentId: first.id },
        }),
      ).toBe(1);
    },
  );
  it('does not count a verified overrun or seek as additional watched time', async () => {
    verifiedMedia();
    const first = await assign();
    await event(first.id, 'start').expect(200);
    const saved = (
      await event(first.id, 'end', [
        { start: 0, end: 49.9 },
        { start: 100.1, end: 100.4 },
      ]).expect(200)
    ).body as Workout;
    expect(saved.status).toBe('not_performed');
    expect(saved.progress).toMatchObject({
      durationSeconds: 100,
      watchedSeconds: 49.9,
      positionSeconds: 100,
      intervals: [{ start: 0, end: 49.9 }],
    });
    expect(algorithm.weightAdjustment.mock.lastCall?.[0].logs).toEqual([]);
  });
  it('stores decimal 50% as one interrupted record for a future provider', async () => {
    verifiedMedia();
    const first = await assign();
    await event(first.id, 'start').expect(200);
    const saved = (
      await event(first.id, 'end', [
        { start: 0.1, end: 25.1 },
        { start: 50.1, end: 75.1 },
      ]).expect(200)
    ).body as Workout;
    expect(saved.status).toBe('interrupted');
    expect(saved.resultStatus).toBe('interrupted');
    expect(algorithm.weightAdjustment.mock.lastCall?.[0].logs).toEqual([
      expect.objectContaining({ videoId: first.video.id, completed: false }),
    ]);
    await get(first.id).expect(200, saved);
    now = new Date('2026-09-26T15:00:01Z');
    const next = (await today().expect(201)).body as Workout;
    expect(next.algorithmVersion).toBe('test-only-provider');
    expect(algorithm.recommend.mock.lastCall?.[0].logs).toEqual([
      expect.objectContaining({
        videoId: first.video.id,
        completed: false,
        date: '2026-09-26T14:59:59.000Z',
      }),
    ]);
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

  it('passes only one representative interrupted record and excludes not-performed', async () => {
    const first = await assign();
    await event(first.id, 'start').expect(200);
    await event(first.id, 'end', [{ start: 0, end: 49.9 }]).expect(200);
    now = new Date('2026-09-26T15:00:01Z');
    const second = (await today().expect(201)).body as Workout;
    expect(algorithm.recommend.mock.lastCall?.[0].logs).toEqual([]);
    await event(second.id, 'start').expect(200);
    await event(second.id, 'end', [{ start: 0, end: 50 }]).expect(200);
    now = new Date('2026-09-27T15:00:01Z');
    const third = (await today().expect(201)).body as Workout;
    expect(third.algorithmVersion).toBe('test-only-provider');
    expect(algorithm.recommend.mock.lastCall?.[0].logs).toEqual([
      expect.objectContaining({ videoId: second.video.id, completed: false }),
    ]);
  });

  it('persists supplied catalog definitions atomically, deduplicates and preserves old versions', async () => {
    const real = fixtureCatalog(`test-new-catalog-${randomUUID()}`);
    expect(await catalogs.activate(real)).toMatchObject({ videoCount: 2 });
    expect(await catalogs.activate(real)).toMatchObject({ reused: true });
    expect(
      await database.workoutVideo.count({
        where: { catalogVersion: real.version },
      }),
    ).toBe(2);
    const bad = structuredClone(real);
    bad.version += '-bad';
    bad.videos[0].durationSeconds = 0;
    bad.contentHash = catalogHash(bad.videos);
    await expect(catalogs.activate(bad)).rejects.toThrow(/durationSeconds/);
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
    expect(assigned.video.durationSeconds).toBe(100);
    await catalogs.activate(catalog);
    expect(
      ((await get(assigned.id).expect(200)).body as Workout).video.id,
    ).toBe(assigned.video.id);
    expect(
      await database.workoutVideo.count({
        where: { catalogVersion: real.version },
      }),
    ).toBe(2);
  });
});
