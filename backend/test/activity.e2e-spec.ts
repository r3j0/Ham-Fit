import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { GroupsService } from '../src/groups/groups.service.js';
import { RoutineAlgorithm } from '../src/recommendations/routine-algorithm.js';
import { WorkoutRoutinesService } from '../src/recommendations/workout-routines.service.js';
import { configureApp } from '../src/setup-app.js';
import { koreanDay, memberProfiles } from '../src/users/member-profile.js';
import { observeClientQueries } from './helpers/pg-queries.js';

describe('shared activity aggregation against PostgreSQL', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let now: Date;
  let owner: { user: { id: string }; access_token: string };
  const users: string[] = [];
  const curricula: string[] = [];
  let assignment = 0;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WorkoutRoutinesService)
      .useFactory({
        factory: (database: DatabaseService, algorithm: RoutineAlgorithm) =>
          new WorkoutRoutinesService(database, algorithm, () => now),
        inject: [DatabaseService, RoutineAlgorithm],
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
  });
  beforeEach(async () => {
    now = new Date('2026-09-29T14:59:59Z');
    await db.authRateLimit.deleteMany();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `activity-${randomUUID()}@example.test`,
        password: 'activity-test-password-2026',
      })
      .expect(201);
    owner = response.body as typeof owner;
    users.push(owner.user.id);
  });
  afterAll(async () => {
    await db?.group.deleteMany({ where: { leaderUserId: { in: users } } });
    await db?.user.deleteMany({ where: { id: { in: users } } });
    await db?.workoutCurriculum.deleteMany({
      where: { id: { in: curricula } },
    });
    await app?.close();
  });

  // Saved prescriptions, no recommender or external media needed for aggregation.
  async function routine(
    dates: Array<string | null>,
    userId = owner.user.id,
    assignmentDate = new Date(Date.UTC(2020, 0, ++assignment)),
  ) {
    const date = assignmentDate;
    return db.workoutRoutine.create({
      data: {
        userId,
        assignmentDate: date,
        referenceDate: date,
        algorithmVersion: 'test-only',
        dataVersion: 'test-only',
        estimatedMinutes: 6,
        inputSnapshot: {},
        items: {
          create: dates.map((completedAt, index) => ({
            order: index + 1,
            videoId: `test-only-${index}`,
            title: '[TEST ONLY] activity fixture',
            videoUrl: 'https://example.test/activity.mp4',
            durationSeconds: 100,
            slot: 'strength_group',
            prescription: {},
            ...(completedAt
              ? {
                  status: 'completed' as const,
                  resultStatus: 'completed',
                  completedAt: new Date(completedAt),
                  performedAt: new Date(completedAt),
                }
              : {}),
          })),
        },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    });
  }
  const profile = (at = now, userIds = [owner.user.id]) =>
    db.$transaction((tx) => memberProfiles(tx, userIds, at));
  const stats = async (at = now) => (await profile(at)).get(owner.user.id);
  async function legacy(completedAt: string, daily = true) {
    const definition = await db.workoutCurriculum.create({
      data: { name: '[TEST ONLY] legacy activity' },
    });
    curricula.push(definition.id);
    return db.userCurriculumAssignment.create({
      data: {
        userId: owner.user.id,
        curriculumId: definition.id,
        requestKey: randomUUID(),
        assignedAt: new Date('2020-01-01T00:00:00Z'),
        ...(daily
          ? {
              assignmentDate: new Date(Date.UTC(2020, 0, ++assignment)),
              algorithmVersion: 'test-only',
              inputSnapshot: {},
              resultStatus: 'completed',
              performedAt: new Date(completedAt),
            }
          : {}),
        status: 'completed',
        completedAt: new Date(completedAt),
      },
    });
  }

  it('excludes partial routines, includes the final item, and ignores duplicate events across midnight', async () => {
    const saved = await routine(
      ['2026-09-29T12:00:00Z', null, '2026-09-29T13:00:00Z'],
      owner.user.id,
      new Date('2026-09-29T00:00:00Z'),
    );
    expect(await stats()).toMatchObject({
      streak: 0,
      longestStreak: 0,
      totalWorkoutDays: 0,
    });
    const service = app.get(WorkoutRoutinesService);
    const item = saved.items[1]; // Last completion is not necessarily the last ordered item.
    const deviceId = randomUUID();
    await service.event(owner.user.id, saved.id, item.id, randomUUID(), {
      type: 'start',
      deviceId,
      sequence: 1,
      positionSeconds: 0,
      intervals: [],
    });
    const key = randomUUID();
    const input = {
      type: 'end' as const,
      deviceId,
      sequence: 2,
      positionSeconds: 80,
      intervals: [{ start: 0, end: 80 }],
    };
    await service.event(owner.user.id, saved.id, item.id, key, input);
    expect(await stats()).toMatchObject({
      streak: 1,
      longestStreak: 1,
      totalWorkoutDays: 1,
    });
    expect(await stats(new Date('2026-09-29T14:59:58Z'))).toMatchObject({
      totalWorkoutDays: 0,
    });
    now = new Date('2026-09-29T15:00:00Z');
    await service.event(owner.user.id, saved.id, item.id, key, input);
    const before = await db.workoutRoutineItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { events: true },
    });
    await expect(
      service.event(owner.user.id, saved.id, item.id, randomUUID(), {
        ...input,
        sequence: 3,
      }),
    ).rejects.toMatchObject({ response: { code: 'ROUTINE_EXPIRED' } });
    expect(
      await db.workoutRoutineItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { events: true },
      }),
    ).toEqual(before);
    expect(await stats()).toMatchObject({
      streak: 1,
      longestStreak: 1,
      totalWorkoutDays: 1,
    });
    expect(await stats(new Date('2026-09-30T15:00:00Z'))).toMatchObject({
      streak: 0,
      totalWorkoutDays: 1,
    });
    expect(
      await db.userCurriculumAssignment.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
  });

  it('uses the last completion in KST for stored multi-day routines, unions legacy days and keeps yesterday alive', async () => {
    await routine(['2026-09-24T14:59:59Z', '2026-09-25T15:00:00Z']); // Sep 26 only
    await routine(['2026-09-26T15:00:00Z']); // Sep 27
    await routine(['2026-09-28T14:59:59Z']); // Sep 28
    await routine(['2026-09-28T13:00:00Z']); // Same exercise day, different assignment
    await routine(['2026-09-29T15:00:00Z']); // Future completion excluded
    await routine(['2026-09-29T12:00:00Z', null]);
    await legacy('2026-09-28T14:00:00Z'); // Same day as routines
    await legacy('2026-09-20T14:00:00Z');
    await legacy('2026-09-29T12:00:00Z', false); // Historically not a daily assignment
    expect(await stats()).toMatchObject({
      streak: 3,
      longestStreak: 3,
      totalWorkoutDays: 4,
    });
    expect(await stats(new Date('2026-10-01T15:00:00Z'))).toMatchObject({
      streak: 0,
      longestStreak: 3,
      totalWorkoutDays: 5,
    });
    expect(
      await db.workoutRoutineEvent.count({
        where: { item: { routine: { userId: owner.user.id } } },
      }),
    ).toBe(0);
  });

  it('counts a routine finished after KST midnight only on the actual final day', async () => {
    await routine(['2026-09-29T14:59:59Z', '2026-09-29T15:00:00Z']);
    expect(await stats()).toMatchObject({ totalWorkoutDays: 0 });
    expect(await stats(new Date('2026-09-29T15:00:00Z'))).toMatchObject({
      streak: 1,
      longestStreak: 1,
      totalWorkoutDays: 1,
    });
    expect(await stats(new Date('2026-09-30T15:00:00Z'))).toMatchObject({
      streak: 1,
    });
    expect(await stats(new Date('2026-10-01T15:00:00Z'))).toMatchObject({
      streak: 0,
    });
  });

  it('returns zero for empty records and batches isolated member histories', async () => {
    expect(await stats()).toMatchObject({
      streak: 0,
      longestStreak: 0,
      totalWorkoutDays: 0,
    });
    const other = await db.user.create({
      data: {
        email: `activity-${randomUUID()}@example.test`,
        password: 'test-only',
      },
    });
    users.push(other.id);
    await routine(['2026-09-29T12:00:00Z'], other.id);
    const single = await observeClientQueries(() => profile());
    const batch = await observeClientQueries(() =>
      profile(now, [owner.user.id, other.id]),
    );
    expect(single.overlaps).toBe(0);
    expect(batch.overlaps).toBe(0);
    const avatarQueries = (queries: string[]) =>
      queries.filter((sql) =>
        sql.match(/\bFROM\s+"[^"]+"\."([^"]+)"/i)?.[1]?.startsWith('avatar_'),
      );
    expect(avatarQueries(batch.queries)).toHaveLength(
      avatarQueries(single.queries).length,
    );
    const profiles = batch.value;
    expect(profiles.get(owner.user.id)).toMatchObject({ totalWorkoutDays: 0 });
    expect(profiles.get(other.id)).toMatchObject({
      streak: 1,
      totalWorkoutDays: 1,
    });
    expect(await profile(now, [])).toEqual(new Map());
  });

  it('rejects inconsistent completion state/time at storage without inventing a success date', async () => {
    const saved = await routine([null]);
    for (const data of [
      {
        status: 'completed' as const,
        resultStatus: 'completed',
        performedAt: now,
      },
      { completedAt: now },
    ]) {
      await expect(
        db.workoutRoutineItem.update({
          where: { id: saved.items[0].id },
          data,
        }),
      ).rejects.toThrow();
    }
    expect(await stats()).toMatchObject({ totalWorkoutDays: 0 });
  });

  it('returns identical activity metrics through personal, group member and group detail APIs', async () => {
    const midnight = new Date(`${koreanDay(new Date())}T00:00:00+09:00`);
    const yesterday = new Date(midnight.getTime() - 3_600_000).toISOString();
    await routine([yesterday]);
    await legacy(yesterday);
    const group = await app
      .get(GroupsService)
      .create(owner.user.id, randomUUID(), {
        name: '활동 집계 테스트',
        description: '',
        maxMembers: 3,
      });
    const get = (path: string) =>
      request(app.getHttpServer())
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${owner.access_token}`)
        .expect(200);
    const own = (await get('/users/me/profile/activity')).body as Record<
      string,
      unknown
    >;
    const member = (await get(`/groups/${group.id}/members/${owner.user.id}`))
      .body as Record<string, unknown>;
    const detail = (await get(`/groups/${group.id}`)).body as {
      members: Record<string, unknown>[];
    };
    expect(own).toMatchObject({
      streak: 1,
      longestStreak: 1,
      totalWorkoutDays: 1,
    });
    expect(member).toMatchObject(own);
    expect(detail.members[0]).toEqual(member);
  });
});
