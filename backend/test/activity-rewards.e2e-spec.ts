import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
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
import { AvatarService } from '../src/avatar/avatar.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { GroupsService } from '../src/groups/groups.service.js';
import { GroupMissionsService } from '../src/groups/group-missions.service.js';
import { WorkoutRoutinesService } from '../src/recommendations/workout-routines.service.js';
import { RoutineAlgorithm } from '../src/recommendations/routine-algorithm.js';
import { recordRoutineReward } from '../src/users/activity-rewards.service.js';
import { koreanDay } from '../src/users/member-profile.js';
import { configureApp } from '../src/setup-app.js';

type Account = { user: { id: string }; access_token: string };
type Routine = Awaited<ReturnType<typeof createRoutine>>;
let db: DatabaseService;
let now: Date;
async function createRoutine(
  userId: string,
  count = 2,
  day = koreanDay(now),
  completed = false,
) {
  return db.workoutRoutine.create({
    data: {
      userId,
      assignmentDate: new Date(`${day}T00:00:00Z`),
      referenceDate: new Date(`${day}T00:00:00Z`),
      algorithmVersion: 'test-only',
      dataVersion: 'test-only',
      estimatedMinutes: 3,
      inputSnapshot: {},
      items: {
        create: Array.from({ length: count }, (_, index) => ({
          order: index + 1,
          videoId: `test-only-${index}`,
          title: '[TEST ONLY] reward transaction',
          videoUrl: 'https://example.test/reward.mp4',
          durationSeconds: 100,
          slot: 'strength_group',
          prescription: {},
          ...(completed
            ? {
                status: 'completed',
                completedAt: now,
                resultStatus: 'completed',
                performedAt: now,
              }
            : {}),
        })),
      },
    },
    include: { items: { orderBy: { order: 'asc' } } },
  });
}

describe('daily whole-routine rewards and immutable HTTP receipts on PostgreSQL', () => {
  let app: INestApplication<App>;
  let routines: WorkoutRoutinesService;
  let groups: GroupsService;
  let missions: GroupMissionsService;
  let owner: Account;
  const ids: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WorkoutRoutinesService)
      .useFactory({
        factory: (database: DatabaseService, algorithm: RoutineAlgorithm) =>
          new WorkoutRoutinesService(database, algorithm, () => now),
        inject: [DatabaseService, RoutineAlgorithm],
      })
      .overrideProvider(GroupMissionsService)
      .useFactory({
        factory: (database: DatabaseService, avatar: AvatarService) =>
          new GroupMissionsService(database, avatar, () => now),
        inject: [DatabaseService, AvatarService],
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    routines = app.get(WorkoutRoutinesService);
    groups = app.get(GroupsService);
    missions = app.get(GroupMissionsService);
  });
  beforeEach(async () => {
    now = new Date('2026-10-01T01:00:00Z');
    await db.authRateLimit.deleteMany();
    owner = await account();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db?.group.deleteMany({ where: { leaderUserId: { in: ids } } });
    await db?.user.deleteMany({ where: { id: { in: ids } } });
    await app?.close();
  });
  async function account() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `daily-rewards-${randomUUID()}@example.test`,
        password: 'test-only secure reward password',
      })
      .expect(201);
    const result = response.body as Account;
    ids.push(result.user.id);
    return result;
  }
  const get = (routineId: string, user = owner) =>
    request(app.getHttpServer())
      .get(`/api/v1/users/me/activity-rewards?routineId=${routineId}`)
      .set('Authorization', `Bearer ${user.access_token}`);
  const balance = async () =>
    (
      await db.userCurrency.findUniqueOrThrow({
        where: { userId: owner.user.id },
      })
    ).balance;
  const event = (
    row: Routine,
    index: number,
    body: object,
    key = randomUUID(),
  ) =>
    routines.event(
      row.userId,
      row.id,
      row.items[index].id,
      key,
      body as Parameters<WorkoutRoutinesService['event']>[4],
    );
  async function complete(row: Routine, index = 0, watched = 80) {
    const deviceId = randomUUID();
    await event(row, index, {
      deviceId,
      sequence: 1,
      type: 'start',
      intervals: [],
      positionSeconds: 0,
    });
    const body = {
      deviceId,
      sequence: 2,
      type: 'end',
      intervals: [{ start: 0, end: watched }],
      positionSeconds: watched,
    };
    const key = randomUUID();
    await event(row, index, body, key);
    return { body, key };
  }
  async function group() {
    const member = await account();
    const created = await groups.create(owner.user.id, randomUUID(), {
      name: '[TEST ONLY] evidence',
      description: '',
      maxMembers: 10,
    });
    const invite = await groups.inviteCode(owner.user.id, created.id);
    const application = await groups.apply(
      member.user.id,
      randomUUID(),
      invite.inviteCode,
    );
    await groups.decide(owner.user.id, created.id, application.id, 'approved');
    const result = await missions.start(
      owner.user.id,
      created.id,
      randomUUID(),
    );
    return { groupId: created.id, roundId: result.mission.id!, member };
  }

  it('grants one seed only at whole completion; GET and exact/fresh past replays never grant again', async () => {
    const row = await createRoutine(owner.user.id);
    await get(row.id).expect(409);
    await complete(row);
    expect(await balance()).toBe(0);
    await get(row.id).expect(409);
    const final = await complete(row, 1);
    const receipt = await get(row.id).expect(200);
    expect(receipt.headers['cache-control']).toBe('no-store');
    expect(receipt.body).toEqual({
      routineId: row.id,
      koreanDate: '2026-10-01',
      seed: { status: 'granted', amount: 1, transactionId: expect.any(String) },
      waters: [],
      personalTicketIds: [],
    });
    expect(await balance()).toBe(1);
    await event(row, 1, final.body, final.key);
    await event(row, 1, { ...final.body, deviceId: randomUUID() });
    now = new Date('2026-10-01T15:00:00Z');
    await event(row, 1, final.body, final.key);
    await expect(
      event(row, 1, { ...final.body, deviceId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await get(row.id).expect(200)).body).toEqual(receipt.body);
    expect(await balance()).toBe(1);
    expect(
      await db.currencyTransaction.count({ where: { userId: owner.user.id } }),
    ).toBe(1);
  });
  it('keeps optional practice and the 80% boundary outside reward issuance', async () => {
    const row = await createRoutine(owner.user.id, 1);
    const partial = await complete(row, 0, 79.999999);
    expect(await balance()).toBe(0);
    await get(row.id).expect(409);
    await event(row, 0, {
      ...partial.body,
      sequence: 3,
      type: 'start',
      intervals: [],
    });
    await event(row, 0, {
      ...partial.body,
      sequence: 4,
      intervals: [{ start: 0, end: 80 }],
      positionSeconds: 80,
    });
    expect(await balance()).toBe(1);
  });
  it('serializes simultaneous last item completions from different devices', async () => {
    const row = await createRoutine(owner.user.id);
    await Promise.all(row.items.map((_, index) => complete(row, index)));
    expect(await balance()).toBe(1);
    expect(
      await db.routineActivityReward.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(1);
  });
  it('uses KST midnight, leaves expired completions unchanged, and grants the next day separately', async () => {
    now = new Date('2026-10-01T14:59:59.999Z');
    const yesterday = await createRoutine(owner.user.id, 1);
    await complete(yesterday);
    now = new Date('2026-10-01T15:00:00Z');
    const today = await createRoutine(owner.user.id, 1);
    await complete(today);
    expect((await get(yesterday.id)).body.koreanDate).toBe('2026-10-01');
    expect((await get(today.id)).body.koreanDate).toBe('2026-10-02');
    expect(await balance()).toBe(2);
  });
  it('returns already_granted for a second completion source on the same day', async () => {
    // A historical next-day completion fixture represents two sources sharing
    // one completion date; new v2 requests still enforce their assignment day.
    const earlier = await createRoutine(owner.user.id, 1, '2026-09-30', true);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ${db.table('users')} WHERE id=${owner.user.id}::uuid FOR NO KEY UPDATE`;
      await recordRoutineReward(db, tx, owner.user.id, earlier.id, now);
    });
    const row = await createRoutine(owner.user.id, 1);
    await complete(row);
    expect((await get(row.id)).body.seed).toEqual({
      status: 'already_granted',
      amount: 0,
      transactionId: null,
    });
    expect(await balance()).toBe(1);
  });
  it('does not backfill old completions or credit a day already completed before introduction', async () => {
    const earlier = await createRoutine(owner.user.id, 1, '2026-09-30', true);
    await get(earlier.id).expect(409);
    expect(await balance()).toBe(0);
    const row = await createRoutine(owner.user.id, 1);
    await complete(row);
    expect((await get(row.id)).body.seed).toEqual({
      status: 'not_eligible',
      amount: 0,
      transactionId: null,
    });
    expect(await balance()).toBe(0);
  });
  it('separates personal eligibility from an earlier legacy group achievement', async () => {
    await db.activityAchievement.create({
      data: {
        userId: owner.user.id,
        koreanDate: new Date('2026-10-01'),
        achievedAt: now,
        sourceKind: 'daily_assignment',
        sourceId: randomUUID(),
      },
    });
    await group();
    const row = await createRoutine(owner.user.id, 1);
    await complete(row);
    expect((await get(row.id)).body).toMatchObject({
      seed: { status: 'granted', amount: 1 },
      waters: [],
      personalTicketIds: [],
    });
    expect(await balance()).toBe(1);
  });
  it('snapshots only actual contributions to every eligible group and preserves them after rename/deletion', async () => {
    const a = await group();
    const b = await group();
    const row = await createRoutine(owner.user.id, 1);
    await complete(row);
    const receipt = (await get(row.id)).body;
    expect(receipt.waters).toEqual(
      [a, b]
        .sort((x, y) => x.groupId.localeCompare(y.groupId))
        .map((value) => ({
          groupId: value.groupId,
          groupName: '[TEST ONLY] evidence',
          roundId: value.roundId,
          amount: 1,
        })),
    );
    expect(
      await db.groupMissionContribution.count({
        where: { groupId: { in: [a.groupId, b.groupId] } },
      }),
    ).toBe(2);
    await db.group.update({
      where: { id: a.groupId },
      data: { name: 'renamed' },
    });
    await groups.delete(owner.user.id, b.groupId);
    expect((await get(row.id)).body).toEqual(receipt);
  });
  it('does not infer water from current membership or a round started after completion', async () => {
    const row = await createRoutine(owner.user.id, 1);
    await complete(row);
    await group();
    expect((await get(row.id)).body.waters).toEqual([]);
  });
  it('attaches only the personal ticket actually issued by this completion', async () => {
    for (let day = 27; day <= 30; day++)
      await db.activityAchievement.create({
        data: {
          userId: owner.user.id,
          koreanDate: new Date(`2026-09-${day}`),
          achievedAt: new Date(`2026-09-${day}T01:00:00Z`),
          sourceKind: 'daily_assignment',
          sourceId: randomUUID(),
        },
      });
    // Streak calculation reads actual workout sources, never achievement counters.
    for (let day = 27; day <= 30; day++) {
      const old = await createRoutine(owner.user.id, 1, `2026-09-${day}`);
      await db.workoutRoutineItem.update({
        where: { id: old.items[0].id },
        data: {
          status: 'completed',
          completedAt: new Date(`2026-09-${day}T01:00:00Z`),
          resultStatus: 'completed',
          performedAt: new Date(`2026-09-${day}T01:00:00Z`),
        },
      });
    }
    const row = await createRoutine(owner.user.id, 1);
    await complete(row);
    const tickets = await db.streakRouletteTicket.findMany({
      where: { userId: owner.user.id },
    });
    expect(tickets).toHaveLength(1);
    expect((await get(row.id)).body.personalTicketIds).toEqual([tickets[0].id]);
  });
  it('rolls back every group, achievement, final item and event if personal credit exceeds the balance cap', async () => {
    const a = await group();
    const b = await group();
    const row = await createRoutine(owner.user.id, 1);
    await db.userCurrency.update({
      where: { userId: owner.user.id },
      data: { balance: 2147483647 },
    });
    await expect(complete(row)).rejects.toMatchObject({ status: 409 });
    expect(
      await db.activityAchievement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
    expect(
      await db.groupMissionContribution.count({
        where: { groupId: { in: [a.groupId, b.groupId] } },
      }),
    ).toBe(0);
    expect(
      await db.routineActivityReward.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
    const item = await db.workoutRoutineItem.findUniqueOrThrow({
      where: { id: row.items[0].id },
    });
    expect(item.status).toBe('in_progress');
    expect(item.completedAt).toBeNull();
    expect(
      await db.workoutRoutineEvent.count({ where: { itemId: item.id } }),
    ).toBe(1);
  });
  it('rolls back a failure after actual seed storage and retries the original completion request', async () => {
    await group();
    const row = await createRoutine(owner.user.id, 1);
    const deviceId = randomUUID();
    const key = randomUUID();
    await event(row, 0, {
      deviceId,
      sequence: 1,
      type: 'start',
      intervals: [],
      positionSeconds: 0,
    });
    const body = {
      deviceId,
      sequence: 2,
      type: 'end',
      intervals: [{ start: 0, end: 80 }],
      positionSeconds: 80,
    };
    const shop = new AvatarService(db);
    const original = shop.grantCurrencyInTransaction.bind(shop);
    vi.spyOn(
      AvatarService.prototype,
      'grantCurrencyInTransaction',
    ).mockImplementationOnce(async function (
      this: AvatarService,
      ...args: Parameters<AvatarService['grantCurrencyInTransaction']>
    ) {
      await original(...args);
      throw new Error(
        'TEST ONLY failure after actual credit and ledger storage',
      );
    });
    await expect(event(row, 0, body, key)).rejects.toThrow('TEST ONLY');
    expect(await balance()).toBe(0);
    expect(
      await db.groupMissionContribution.count({
        where: { achievement: { userId: owner.user.id } },
      }),
    ).toBe(0);
    expect(
      await db.routineActivityReward.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
    expect(
      await db.currencyTransaction.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
    await event(row, 0, body, key);
    expect(await balance()).toBe(1);
    expect((await get(row.id)).body.seed.status).toBe('granted');
    expect(
      await db.groupMissionContribution.count({
        where: { achievement: { userId: owner.user.id } },
      }),
    ).toBe(1);
  });
  it('enforces authenticated ownership, strict UUID query and read-only requests', async () => {
    const row = await createRoutine(owner.user.id, 1);
    await complete(row);
    const other = await account();
    await get(row.id, other).expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/users/me/activity-rewards?routineId=${row.id}`)
      .expect(401);
    await get('invalid').expect(400);
    await get(`${row.id}&unexpected=true`).expect(400);
    await get(`${row.id}&routineId=${row.id}`).expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/users/me/activity-rewards')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .expect(400);
    expect(await balance()).toBe(1);
  });
  it('protects immutable receipt/payment evidence and supports complete account deletion', async () => {
    const row = await createRoutine(owner.user.id, 1);
    await complete(row);
    const receipt = await db.routineActivityReward.findUniqueOrThrow({
      where: { routineId: row.id },
    });
    await expect(
      db.routineActivityReward.update({
        where: { routineId: row.id },
        data: { waters: [] },
      }),
    ).rejects.toThrow();
    await expect(
      db.routineActivityReward.delete({ where: { routineId: row.id } }),
    ).rejects.toThrow();
    await expect(
      db.currencyTransaction.update({
        where: { id: receipt.transactionId! },
        data: { amount: 2 },
      }),
    ).rejects.toThrow();
    await expect(
      db.currencyTransaction.delete({ where: { id: receipt.transactionId! } }),
    ).rejects.toThrow();
    await db.user.delete({ where: { id: owner.user.id } });
    expect(
      await db.routineActivityReward.findUnique({
        where: { routineId: row.id },
      }),
    ).toBeNull();
    await get(row.id).expect(401);
  });
});
