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
import { DatabaseService } from '../src/database/database.service.js';
import { RoutineAlgorithm } from '../src/recommendations/routine-algorithm.js';
import { WorkoutRoutinesService } from '../src/recommendations/workout-routines.service.js';
import { RecommendationsService } from '../src/recommendations/recommendations.service.js';
import { WorkoutCatalogService } from '../src/recommendations/workout-catalog.service.js';
import { fixtureAdjustment, fixtureCatalog } from './fixtures/workouts.js';
import { AvatarService } from '../src/avatar/avatar.service.js';
import { GroupsService } from '../src/groups/groups.service.js';
import { GroupMissionsService } from '../src/groups/group-missions.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { koreanDay, memberProfiles } from '../src/users/member-profile.js';
import { StreakRouletteService } from '../src/streak-roulette/streak-roulette.service.js';
import { configureApp } from '../src/setup-app.js';

describe('personal streak roulette on real PostgreSQL', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let routines: WorkoutRoutinesService;
  let legacy: RecommendationsService;
  let roulette: StreakRouletteService;
  let avatar: AvatarService;
  let now: Date;
  let owner: string;
  let other: string;
  let roll = 0;
  let itemIndex = 0;
  const productIds: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StreakRouletteService)
      .useFactory({
        factory: (database: DatabaseService, shop: AvatarService) =>
          new StreakRouletteService(
            database,
            shop,
            () => now,
            (max) => (max === 1000 ? roll : itemIndex),
          ),
        inject: [DatabaseService, AvatarService],
      })
      .overrideProvider(WorkoutRoutinesService)
      .useFactory({
        factory: (database: DatabaseService, algorithm: RoutineAlgorithm) =>
          new WorkoutRoutinesService(database, algorithm, () => now),
        inject: [DatabaseService, RoutineAlgorithm],
      })
      .overrideProvider(RecommendationsService)
      .useFactory({
        factory: (database: DatabaseService) =>
          new RecommendationsService(
            database,
            {
              recommend: async () => {
                throw new Error('TEST ONLY: no recommendation');
              },
              weightAdjustment: async () => fixtureAdjustment(),
            },
            () => now,
          ),
        inject: [DatabaseService],
      })
      .overrideProvider(GroupMissionsService)
      .useFactory({
        factory: (database: DatabaseService, shop: AvatarService) =>
          new GroupMissionsService(database, shop, () => now),
        inject: [DatabaseService, AvatarService],
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    routines = app.get(WorkoutRoutinesService);
    legacy = app.get(RecommendationsService);
    roulette = app.get(StreakRouletteService);
    avatar = app.get(AvatarService);
  });
  async function account() {
    const user = await db.user.create({
      data: {
        email: `streak-${randomUUID()}@example.test`,
        currency: { create: {} },
        preference: { create: {} },
      },
    });
    users.push(user.id);
    return user.id;
  }
  beforeEach(async () => {
    now = new Date('2026-10-01T01:00:00Z');
    roll = 0;
    itemIndex = 0;
    owner = await account();
    other = await account();
    await db.authRateLimit.deleteMany();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db?.group.deleteMany({ where: { leaderUserId: { in: users } } });
    await db?.user.deleteMany({ where: { id: { in: users } } });
    await db?.avatarProduct.deleteMany({ where: { id: { in: productIds } } });
    await app?.close();
  });
  const day = (value: string) => {
    now = new Date(`${value}T01:00:00Z`);
  };
  const tickets = (userId = owner) => roulette.tickets(userId, { limit: 50 });
  async function routine(userId = owner, count = 1, saved?: Date) {
    const date = new Date(`${koreanDay(now)}T00:00:00Z`);
    return db.workoutRoutine.create({
      data: {
        userId,
        assignmentDate: date,
        referenceDate: date,
        algorithmVersion: 'test-only',
        dataVersion: 'test-only',
        estimatedMinutes: 3,
        inputSnapshot: {},
        items: {
          create: Array.from({ length: count }, (_, i) => ({
            order: i + 1,
            videoId: `test-only-${i}`,
            title: '[TEST ONLY] streak',
            videoUrl: 'https://example.test/streak.mp4',
            durationSeconds: 100,
            slot: 'strength_group',
            prescription: {},
            status: 'in_progress',
            ...(saved
              ? {
                  status: 'completed' as const,
                  completedAt: saved,
                  performedAt: saved,
                  resultStatus: 'completed',
                }
              : {}),
          })),
        },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    });
  }
  type Routine = Awaited<ReturnType<typeof routine>>;
  async function complete(row: Routine, index = 0) {
    const input = {
      deviceId: randomUUID(),
      sequence: 1,
      type: 'end' as const,
      positionSeconds: 80,
      intervals: [{ start: 0, end: 80 }],
    };
    const key = randomUUID();
    await routines.event(row.userId, row.id, row.items[index].id, key, input);
    return { key, input };
  }
  async function water(userId = owner) {
    const row = await routine(userId);
    await complete(row);
    return row;
  }
  async function token(userId = owner) {
    const expiresAt = new Date(Date.now() + 3_600_000);
    const session = await db.authSession.create({
      data: { userId, expiresAt },
    });
    return (await app.get(TokenService).issue(userId, session.id, expiresAt))
      .access_token;
  }

  it('issues at 5,10,15 and again in a new segment, without any group', async () => {
    for (let n = 1; n <= 15; n++) {
      day(`2026-10-${String(n).padStart(2, '0')}`);
      await water();
      expect((await tickets()).availableCount).toBe(Math.floor(n / 5));
    }
    const earned = (await tickets()).items;
    expect(earned.map((t) => t.streakDays).sort((a, b) => a - b)).toEqual([
      5, 10, 15,
    ]);
    expect(earned.every((t) => t.segmentStartDate === '2026-10-01')).toBe(true);
    for (let n = 17; n <= 21; n++) {
      day(`2026-10-${n}`);
      await water();
    }
    expect((await tickets()).availableCount).toBe(4);
    expect(
      (await tickets()).items.find((t) => t.segmentStartDate === '2026-10-17')
        ?.streakDays,
    ).toBe(5);
  });

  async function firstFour(end = '2026-10-05') {
    const endTime = Date.parse(`${end}T01:00:00Z`);
    for (let i = 4; i > 0; i--) {
      now = new Date(endTime - i * 86_400_000);
      await water();
    }
    now = new Date(endTime);
  }
  it('includes the completion being saved, requires the whole routine, and ignores replays/expired events/GET', async () => {
    await firstFour();
    const row = await routine(owner, 2);
    await complete(row, 0);
    expect((await tickets()).availableCount).toBe(0);
    const last = await complete(row, 1);
    expect((await tickets()).availableCount).toBe(1);
    await routines.event(owner, row.id, row.items[1].id, last.key, last.input);
    await complete(row, 1);
    day('2026-10-06');
    await routines.event(owner, row.id, row.items[1].id, last.key, last.input);
    await expect(complete(row, 1)).rejects.toMatchObject({
      response: { code: 'ROUTINE_EXPIRED' },
    });
    const auth = await token();
    for (const path of [
      '/users/me/streak-roulette/tickets',
      '/users/me/profile/activity',
      '/users/me/avatar/inventory',
    ]) {
      await request(app.getHttpServer())
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${auth}`)
        .expect(200);
    }
    expect((await tickets()).availableCount).toBe(1);
    expect(
      (await db.$transaction((tx) => memberProfiles(tx, [owner], now))).get(
        owner,
      )?.streak,
    ).toBe(5);
  });

  it('shares legacy/routine success and serializes concurrent devices and two source kinds on one day', async () => {
    await firstFour();
    const row = await routine();
    const catalog = fixtureCatalog(`streak-${randomUUID()}`);
    await app.get(WorkoutCatalogService).activate(catalog);
    const definition = await db.workoutCurriculum.findUniqueOrThrow({
      where: {
        catalogVersion_videoId: {
          catalogVersion: catalog.version,
          videoId: catalog.videos[0].videoId,
        },
      },
    });
    const assignment = await db.userCurriculumAssignment.create({
      data: {
        userId: owner,
        curriculumId: definition.id,
        status: 'in_progress',
        requestKey: randomUUID(),
        assignmentDate: new Date('2026-10-05T00:00:00Z'),
        algorithmVersion: 'test-only',
        inputSnapshot: {},
      },
    });
    await Promise.all([
      complete(row),
      complete(row),
      legacy.event(owner, assignment.id, randomUUID(), {
        type: 'end',
        deviceId: randomUUID(),
        sequence: 1,
        positionSeconds: 80,
        intervals: [{ start: 0, end: 80 }],
      }),
    ]);
    expect((await tickets()).availableCount).toBe(1);
    expect(
      await db.activityAchievement.count({ where: { userId: owner } }),
    ).toBe(5);
  });

  it('recognizes group contribution and personal milestone together, and preserves personal tickets after departure/deletion', async () => {
    const groups = app.get(GroupsService);
    const group = await groups.create(owner, randomUUID(), {
      name: '[TEST ONLY] streak',
      description: '',
      maxMembers: 2,
    });
    const invitation = await groups.inviteCode(owner, group.id);
    const join = await groups.apply(other, randomUUID(), invitation.inviteCode);
    await groups.decide(owner, group.id, join.id, 'approved');
    const mission = await app
      .get(GroupMissionsService)
      .start(owner, group.id, randomUUID());
    await firstFour();
    await water();
    expect((await tickets()).availableCount).toBe(1);
    expect(
      await db.groupMissionRound.findUnique({
        where: { id: mission.mission.id },
      }),
    ).toMatchObject({ waterCount: 5 });
    expect(
      await db.groupMissionContribution.count({
        where: { roundId: mission.mission.id },
      }),
    ).toBe(5);
    await groups.transfer(owner, group.id, other);
    await groups.leave(owner, group.id);
    await groups.delete(other, group.id);
    expect((await tickets()).availableCount).toBe(1);
  });

  it.each(['2024-03-01', '2027-01-01', '2026-05-01'])(
    'uses KST receipt dates across %s and ignores client occurredAt',
    async (end) => {
      await firstFour(end);
      now = new Date(Date.parse(`${end}T15:00:00Z`) - 1);
      const row = await routine();
      await routines.event(owner, row.id, row.items[0].id, randomUUID(), {
        type: 'end',
        deviceId: randomUUID(),
        sequence: 1,
        occurredAt: '2020-01-01T00:00:00Z',
        positionSeconds: 80,
        intervals: [{ start: 0, end: 80 }],
      });
      expect((await tickets()).items[0]).toMatchObject({
        koreanDate: end,
        streakDays: 5,
      });
      now = new Date(now.getTime() + 1);
      await expect(complete(row)).rejects.toMatchObject({
        response: { code: 'ROUTINE_EXPIRED' },
      });
      expect((await tickets()).availableCount).toBe(1);
    },
  );

  it('never backfills stored milestones, and keeps GET paging private/strict/no-store', async () => {
    for (let n = 1; n <= 5; n++) {
      day(`2026-10-0${n}`);
      await routine(owner, 1, now);
    }
    expect((await tickets()).availableCount).toBe(0);
    day('2026-10-06');
    await water();
    expect((await tickets()).availableCount).toBe(0);
    for (let n = 7; n <= 9; n++) {
      day(`2026-10-0${n}`);
      await water();
    }
    day('2026-10-10');
    await water();
    const auth = await token();
    const stranger = await token(other);
    const get = (query = '', key = auth) =>
      request(app.getHttpServer())
        .get(`/api/v1/users/me/streak-roulette/tickets${query}`)
        .set('Authorization', `Bearer ${key}`);
    const response = await get('?limit=1').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      availableCount: 1,
      nextCursor: null,
      items: [{ streakDays: 10 }],
    });
    await get('?limit=0').expect(400);
    await get('?userId=bad').expect(400);
    await get('?cursor=bad').expect(400);
    expect((await get('', stranger).expect(200)).body).toMatchObject({
      availableCount: 0,
      items: [],
    });
    await request(app.getHttpServer())
      .get('/api/v1/users/me/streak-roulette/tickets')
      .expect(401);
  });

  it('rolls back source completion and all group contributions if ticket issuance fails', async () => {
    await firstFour();
    const row = await routine();
    // Force a real unique/FK failure inside the original completion transaction.
    const policy = await db.streakRoulettePolicy.findUniqueOrThrow({
      where: { version: 'streak-2026-10-01-v1' },
    });
    vi.spyOn(db, '$transaction').mockImplementationOnce(
      async (work: unknown) => {
        if (typeof work !== 'function')
          throw new Error('expected interactive transaction');
        return db.$transaction(async (tx) => {
          const proxy = new Proxy(tx, {
            get(target, prop) {
              if (prop === 'streakRouletteTicket')
                return {
                  create: () =>
                    target.streakRouletteTicket.create({
                      data: {
                        userId: owner,
                        achievementId: randomUUID(),
                        koreanDate: new Date('2026-10-05'),
                        segmentStartDate: new Date('2026-10-01'),
                        streakDays: 5,
                        createdAt: now,
                        policyVersion: policy.version,
                      },
                    }),
                };
              return Reflect.get(target, prop);
            },
          });
          return work(proxy);
        });
      },
    );
    await expect(complete(row)).rejects.toThrow();
    expect(
      await db.workoutRoutineItem.findUnique({
        where: { id: row.items[0].id },
      }),
    ).toMatchObject({ status: 'in_progress', completedAt: null });
    expect((await tickets()).availableCount).toBe(0);
    expect(
      await db.activityAchievement.count({ where: { userId: owner } }),
    ).toBe(4);
  });

  async function earn(count = 1) {
    for (let n = 1; n <= count * 5; n++) {
      day(`2026-10-${String(n).padStart(2, '0')}`);
      await water();
    }
    return (await tickets()).items;
  }
  async function product(
    kind: 'clothing' | 'pose',
    status = 'on_sale',
    slot = 'hat',
  ) {
    const id = `${kind}.streak-test-${randomUUID()}`;
    productIds.push(id);
    await db.avatarProduct.create({
      data: {
        id,
        kind,
        slot: kind === 'clothing' ? slot : null,
        occupiesSlots: kind === 'clothing' ? [slot] : [],
        renderKey: 'TEST ONLY - no asset registered',
        ownershipScope: 'shared',
        saleStatus: status,
        price: status === 'default' ? null : 50,
      },
    });
    return id;
  }
  async function ownPoses(except: string[] = []) {
    const products = await db.avatarProduct.findMany({
      where: { kind: 'pose', id: { notIn: except } },
    });
    await db.avatarOwnership.createMany({
      data: products.map((p) => ({
        userId: owner,
        productId: p.id,
        source: 'purchase',
      })),
      skipDuplicates: true,
    });
  }
  const balance = async () =>
    (await db.userCurrency.findUniqueOrThrow({ where: { userId: owner } }))
      .balance;
  const spin = (ticketId: string, key = randomUUID(), userId = owner) =>
    roulette.spin(userId, ticketId, key);

  it.each([
    [0, 1],
    [600, 3],
    [850, 5],
    [950, 10],
  ])(
    'grants exact seeds for roll %i using the existing ledger',
    async (value, amount) => {
      const [ticket] = await earn();
      roll = value;
      const outfit = await avatar.outfit(owner);
      const result = await spin(ticket.id);
      expect(result).toMatchObject({
        replayed: false,
        draw: {
          ticketId: ticket.id,
          policyVersion: ticket.policyVersion,
          achievement: {
            id: ticket.achievementId,
            koreanDate: '2026-10-05',
            segmentStartDate: '2026-10-01',
            streakDays: 5,
            sourceKind: 'routine',
          },
          originalResult: `seeds_${amount}`,
          actualReward: {
            kind: 'seeds',
            amount,
            productId: null,
            transactionId: expect.any(String),
          },
          fallback: { applied: false, reason: null },
        },
      });
      expect(await balance()).toBe(amount);
      expect(
        await db.currencyTransaction.findMany({ where: { userId: owner } }),
      ).toMatchObject([
        {
          kind: 'grant',
          amount,
          balanceAfter: amount,
          eventKey: `streak-roulette:${result.draw.id}`,
          purchaseId: null,
        },
      ]);
      expect((await tickets()).availableCount).toBe(0);
      expect((await tickets()).items[0]).toMatchObject({
        status: 'used',
        usable: false,
        usedAt: expect.any(Date),
      });
      expect(await avatar.outfit(owner)).toEqual(outfit);
    },
  );

  it('substitutes 50 for missing clothing, without registering any production item', async () => {
    const [ticket] = await earn();
    roll = 993;
    // Other regression suites may have registered test-only sale clothing.
    // Own those fixtures so this user still has an empty eligible pool.
    const clothing = await db.avatarProduct.findMany({
      where: { kind: 'clothing' },
    });
    await db.avatarOwnership.createMany({
      data: clothing.map((p) => ({
        userId: owner,
        productId: p.id,
        source: 'purchase',
      })),
      skipDuplicates: true,
    });
    expect((await spin(ticket.id)).draw).toMatchObject({
      originalResult: 'clothing',
      actualReward: { kind: 'seeds', amount: 50, productId: null },
      fallback: { applied: true, reason: 'no_eligible_product' },
    });
    expect(await balance()).toBe(50);
  });

  it('selects uniformly across unowned clothing products and excludes default/held/retired/owned', async () => {
    const [ticket] = await earn();
    roll = 998;
    const previousClothing = await db.avatarProduct.findMany({
      where: { kind: 'clothing' },
    });
    await db.avatarOwnership.createMany({
      data: previousClothing.map((p) => ({
        userId: owner,
        productId: p.id,
        source: 'purchase',
      })),
      skipDuplicates: true,
    });
    const pool = [
      await product('clothing'),
      await product('clothing'),
      await product('clothing', 'on_sale', 'top'),
      await product('clothing', 'on_sale', 'bottom'),
    ].sort();
    await product('clothing', 'default');
    await product('clothing', 'held');
    await product('clothing', 'retired');
    const owned = await product('clothing');
    await db.avatarOwnership.create({
      data: { userId: owner, productId: owned, source: 'purchase' },
    });
    const outfit = await avatar.outfit(owner);
    itemIndex = 3;
    const { draw } = await spin(ticket.id);
    expect(draw).toMatchObject({
      originalResult: 'clothing',
      actualReward: {
        kind: 'clothing',
        amount: 1,
        productId: pool[3],
        transactionId: null,
      },
      fallback: { applied: false },
    });
    expect(
      await db.avatarOwnership.findUnique({
        where: { userId_productId: { userId: owner, productId: pool[3] } },
      }),
    ).toMatchObject({ source: 'streak_roulette', acquiredAt: now });
    expect(await balance()).toBe(0);
    expect(await db.avatarPurchase.count({ where: { userId: owner } })).toBe(0);
    expect(
      await db.currencyTransaction.count({ where: { userId: owner } }),
    ).toBe(0);
    expect(await avatar.outfit(owner)).toEqual(outfit);
    // Shared inventory is unchanged by character switching.
    expect((await avatar.inventory(owner)).inventory).toContainEqual({
      productId: pool[3],
      source: 'streak_roulette',
      acquiredAt: now,
    });
  });

  it('awards the only unowned sale pose then substitutes 70 after all poses are owned', async () => {
    const earned = await earn(2);
    roll = 999;
    const eligible = await product('pose');
    const defaultPose = await product('pose', 'default');
    const heldPose = await product('pose', 'held');
    const retiredPose = await product('pose', 'retired');
    await ownPoses([eligible, defaultPose, heldPose, retiredPose]);
    const outfit = await avatar.outfit(owner);
    expect((await spin(earned[0].id)).draw).toMatchObject({
      originalResult: 'pose',
      actualReward: { kind: 'pose', amount: 1, productId: eligible },
      fallback: { applied: false },
    });
    expect((await spin(earned[1].id)).draw).toMatchObject({
      originalResult: 'pose',
      actualReward: { kind: 'seeds', amount: 70, productId: null },
      fallback: { applied: true, reason: 'no_eligible_product' },
    });
    expect(await balance()).toBe(70);
    expect(await avatar.outfit(owner)).toEqual(outfit);
  });

  it('replays committed results without rerolling after sale/inventory changes, and detects key/ticket conflicts', async () => {
    const earned = await earn(2);
    roll = 999;
    const target = await product('pose');
    await ownPoses([target]);
    const key = randomUUID();
    const first = await spin(earned[0].id, key);
    await db.avatarProduct.update({
      where: { id: first.draw.actualReward.productId! },
      data: { saleStatus: 'retired' },
    });
    // Restore this original product after asserting replay to avoid fixture drift.
    try {
      roll = 950;
      const replay = await spin(earned[0].id, key);
      expect(replay).toEqual({ draw: first.draw, replayed: true });
      await expect(spin(earned[1].id, key)).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_CONFLICT' },
      });
      await expect(spin(earned[0].id)).rejects.toMatchObject({
        response: { code: 'TICKET_USED' },
      });
      expect(
        await db.streakRouletteDraw.count({ where: { userId: owner } }),
      ).toBe(1);
      expect((await roulette.draws(owner, { limit: 20 })).items).toEqual([
        first.draw,
      ]);
      expect((await roulette.draws(other, { limit: 20 })).items).toEqual([]);
    } finally {
      await db.avatarProduct.update({
        where: { id: first.draw.actualReward.productId! },
        data: { saleStatus: 'on_sale' },
      });
    }
  });

  it('serializes concurrent keys/devices, one ticket or several tickets, and key reuse for another ticket', async () => {
    const earned = await earn(3);
    const key = randomUUID();
    const replayed = await Promise.all([
      spin(earned[0].id, key),
      spin(earned[0].id, key),
    ]);
    expect(
      replayed.map((r) => r.replayed).sort((a, b) => Number(a) - Number(b)),
    ).toEqual([false, true]);
    const contested = await Promise.allSettled([
      spin(earned[1].id),
      spin(earned[1].id),
    ]);
    expect(contested.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(contested.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await spin(earned[2].id);
    expect(await balance()).toBe(3);
    expect(
      await db.streakRouletteDraw.count({ where: { userId: owner } }),
    ).toBe(3);
    expect(
      await db.currencyTransaction.count({ where: { userId: owner } }),
    ).toBe(3);
  });

  it('serializes purchase against two item spins, never charging for an already won item', async () => {
    const earned = await earn(2);
    roll = 999;
    const target = await product('pose');
    await ownPoses([target]);
    await avatar.grantCurrency(owner, `test:${randomUUID()}`, 100);
    const result = await Promise.allSettled([
      avatar.purchase(owner, randomUUID(), {
        productId: target,
        catalogRevision: 1,
      }),
      spin(earned[0].id),
      spin(earned[1].id),
    ]);
    const purchase = result[0];
    const draws = (await roulette.draws(owner, { limit: 50 })).items;
    expect(draws).toHaveLength(2);
    if (purchase.status === 'fulfilled') {
      expect(draws.every((d) => d.fallback.applied)).toBe(true);
      expect(await balance()).toBe(190); // 100 - 50 + 70 + 70
      expect(await db.avatarPurchase.count({ where: { userId: owner } })).toBe(
        1,
      );
    } else {
      expect(purchase.reason).toMatchObject({
        response: { code: 'ALREADY_OWNED' },
      });
      expect(draws.filter((d) => d.actualReward.kind === 'pose')).toHaveLength(
        1,
      );
      expect(draws.filter((d) => d.fallback.applied)).toHaveLength(1);
      expect(await balance()).toBe(170);
      expect(await db.avatarPurchase.count({ where: { userId: owner } })).toBe(
        0,
      );
    }
    expect(
      await db.avatarOwnership.count({
        where: { userId: owner, productId: target },
      }),
    ).toBe(1);
  });

  it('rechecks a sale change that holds the product lock before the draw', async () => {
    const [ticket] = await earn();
    roll = 999;
    const target = await product('pose');
    await ownPoses([target]);
    let unlock!: () => void;
    let locked!: () => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const changing = db.$transaction(async (tx) => {
      await tx.avatarProduct.update({
        where: { id: target },
        data: { saleStatus: 'held' },
      });
      locked();
      await release;
    });
    await ready;
    const spinning = spin(ticket.id);
    try {
      await vi.waitFor(
        async () => {
          const [row] = await db.$queryRaw<
            Array<{ count: number }>
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${'%' + db.table('avatar_products').sql + '%'} AND query LIKE '%FOR SHARE%'`;
          expect(row.count).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );
      unlock();
      await changing;
      expect((await spinning).draw).toMatchObject({
        originalResult: 'pose',
        actualReward: { kind: 'seeds', amount: 70 },
        fallback: { applied: true },
      });
      expect(
        await db.avatarOwnership.findUnique({
          where: { userId_productId: { userId: owner, productId: target } },
        }),
      ).toBeNull();
    } finally {
      unlock();
      await changing;
      await spinning;
    }
  });

  it('rolls back overflow/missing currency and mid-grant DB failure, leaving the ticket/key retryable', async () => {
    const [ticket] = await earn();
    const key = randomUUID();
    await db.userCurrency.update({
      where: { userId: owner },
      data: { balance: 2147483647 },
    });
    await expect(spin(ticket.id, key)).rejects.toMatchObject({
      response: { code: 'BALANCE_LIMIT' },
    });
    expect((await tickets()).availableCount).toBe(1);
    await db.userCurrency.delete({ where: { userId: owner } });
    await expect(spin(ticket.id, key)).rejects.toMatchObject({
      response: { code: 'CURRENCY_MISSING' },
    });
    await db.userCurrency.create({ data: { userId: owner } });
    const original = avatar.grantCurrencyInTransaction.bind(avatar);
    vi.spyOn(avatar, 'grantCurrencyInTransaction').mockImplementationOnce(
      async (tx, userId, eventKey, amount) => {
        await original(tx, userId, eventKey, amount);
        // A real FK error after credit+ledger insert must roll all of them back.
        await tx.avatarOwnership.create({
          data: {
            userId,
            productId: 'TEST ONLY missing product',
            source: 'streak_roulette',
          },
        });
        throw new Error('unreachable');
      },
    );
    await expect(spin(ticket.id, key)).rejects.toThrow();
    expect(await balance()).toBe(0);
    expect(
      await db.currencyTransaction.count({ where: { userId: owner } }),
    ).toBe(0);
    expect(
      await db.streakRouletteDraw.count({ where: { userId: owner } }),
    ).toBe(0);
    expect((await tickets()).availableCount).toBe(1);
    expect((await spin(ticket.id, key)).replayed).toBe(false);
  });

  it('does not convert item-query errors into fallback rewards and rolls back item grants if result storage fails', async () => {
    const [ticket] = await earn();
    roll = 999;
    const transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementationOnce(
      async (work: unknown) => {
        if (typeof work !== 'function') throw new Error('expected transaction');
        return transaction(async (tx) => {
          const proxy = new Proxy(tx, {
            get(target, prop) {
              if (prop === '$queryRaw')
                return (
                  strings: TemplateStringsArray,
                  ...values: unknown[]
                ) => {
                  if (strings.join('').includes('SELECT p.id'))
                    return target.$queryRaw`SELECT test_only_nonexistent_column`;
                  return target.$queryRaw(strings, ...values);
                };
              return Reflect.get(target, prop);
            },
          });
          return work(proxy);
        });
      },
    );
    await expect(spin(ticket.id)).rejects.toThrow();
    expect((await tickets()).availableCount).toBe(1);
    expect(await balance()).toBe(0);
    // Invalid injected product index produces an actual error, never a fallback.
    itemIndex = 9999;
    await expect(spin(ticket.id)).rejects.toThrow('Invalid product index');
    expect((await tickets()).availableCount).toBe(1);
    expect(await balance()).toBe(0);
    itemIndex = 0;
    const policy = await db.streakRoulettePolicy.findUniqueOrThrow({
      where: { version: ticket.policyVersion },
    });
    expect(policy.snapshot).toBeTruthy();
    // An invalid draw receipt time makes the DB trigger reject after ownership.
    now = new Date('2026-10-04T01:00:00Z');
    await expect(spin(ticket.id)).rejects.toThrow();
    expect((await tickets()).availableCount).toBe(1);
    expect((await avatar.inventory(owner)).inventory).toHaveLength(3);
    expect(
      await db.streakRouletteDraw.count({ where: { userId: owner } }),
    ).toBe(0);
  });

  it('keeps draw/ticket evidence and policy immutable with real DB constraints and account cascade', async () => {
    const [ticket, otherTicket] = await earn(2);
    const { draw } = await spin(ticket.id);
    await expect(
      db.streakRouletteTicket.update({
        where: { id: ticket.id },
        data: { streakDays: 10 },
      }),
    ).rejects.toThrow();
    await expect(
      db.streakRoulettePolicy.update({
        where: { version: ticket.policyVersion },
        data: { snapshot: [] },
      }),
    ).rejects.toThrow();
    await expect(
      db.streakRoulettePolicy.delete({
        where: { version: ticket.policyVersion },
      }),
    ).rejects.toThrow();
    await expect(
      db.streakRouletteDraw.update({
        where: { id: draw.id },
        data: { amount: 3 },
      }),
    ).rejects.toThrow();
    const original = await db.streakRouletteTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    await expect(
      db.streakRouletteTicket.create({
        data: { ...original, id: randomUUID() },
      }),
    ).rejects.toThrow();
    const unissued = await db.activityAchievement.findFirstOrThrow({
      where: { userId: owner, koreanDate: new Date('2026-10-01') },
    });
    await expect(
      db.streakRouletteTicket.create({
        data: {
          ...original,
          id: randomUUID(),
          userId: other,
          achievementId: unissued.id,
          koreanDate: unissued.koreanDate,
          segmentStartDate: new Date('2026-09-27'),
          createdAt: unissued.achievedAt,
          streakDays: 5,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const receipt = await db.streakRouletteDraw.findUniqueOrThrow({
      where: { id: draw.id },
    });
    // Supply a matching real grant so receipt validation cannot mask UNIQUE.
    for (const collision of [
      { ticketId: ticket.id, key: randomUUID() },
      { ticketId: otherTicket.id, key: receipt.key },
    ]) {
      await expect(
        db.$transaction(async (tx) => {
          const id = randomUUID();
          const grant = await avatar.grantCurrencyInTransaction(
            tx,
            owner,
            `streak-roulette:${id}`,
            receipt.amount,
          );
          return tx.streakRouletteDraw.create({
            data: {
              ...receipt,
              ...collision,
              id,
              transactionId: grant.transaction.id,
            },
          });
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    }
    expect(
      await db.currencyTransaction.count({ where: { userId: owner } }),
    ).toBe(1);
    await db.user.delete({ where: { id: owner } });
    expect(
      await db.streakRouletteDraw.findUnique({ where: { id: draw.id } }),
    ).toBeNull();
    expect(
      await db.streakRouletteTicket.findUnique({ where: { id: ticket.id } }),
    ).toBeNull();
  });

  it('uses strict HTTP/UUID/auth/CSRF/Origin/no-store contracts, private results and response-loss recovery', async () => {
    const earned = await earn(2);
    const auth = await token();
    const outsider = await token(other);
    const api = (method: 'get' | 'post', path: string, key = auth) =>
      request(app.getHttpServer())
        [method](`/api/v1/users/me/streak-roulette/${path}`)
        .set('Authorization', `Bearer ${key}`)
        .set('X-CSRF-Protection', '1');
    const key = randomUUID();
    await api('post', 'spins').send({ ticketId: earned[0].id }).expect(400);
    await api('post', 'spins')
      .set('Idempotency-Key', 'bad')
      .send({ ticketId: earned[0].id })
      .expect(400);
    for (const forged of [
      { amount: 999 },
      { result: 'pose' },
      { productId: 'pose.run' },
      { userId: other },
    ])
      await api('post', 'spins')
        .set('Idempotency-Key', key)
        .send({ ticketId: earned[0].id, ...forged })
        .expect(400);
    await api('post', 'spins')
      .set('Idempotency-Key', key)
      .type('text')
      .send('oops')
      .expect(400);
    await api('post', 'spins', outsider)
      .set('Idempotency-Key', key)
      .send({ ticketId: earned[0].id })
      .expect(404);
    await api('post', 'spins')
      .set('Origin', 'https://evil.example')
      .set('Idempotency-Key', key)
      .send({ ticketId: earned[0].id })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/users/me/streak-roulette/spins')
      .set('Authorization', `Bearer ${auth}`)
      .set('Idempotency-Key', key)
      .send({ ticketId: earned[0].id })
      .expect(403);
    const first = await api('post', 'spins')
      .set('Idempotency-Key', key.toUpperCase())
      .send({ ticketId: earned[0].id.toUpperCase() })
      .expect(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['idempotency-replayed']).toBe('false');
    const replay = await api('post', 'spins')
      .set('Idempotency-Key', key)
      .send({ ticketId: earned[0].id })
      .expect(200);
    expect(replay.body).toEqual({ ...(first.body as object), replayed: true });
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect((await api('get', 'draws').expect(200)).body).toMatchObject({
      items: [(first.body as { draw: unknown }).draw],
      nextCursor: null,
    });
    expect((await api('get', 'draws', outsider).expect(200)).body).toEqual({
      items: [],
      nextCursor: null,
    });
    await api('post', 'spins')
      .set('Idempotency-Key', key)
      .send({ ticketId: earned[1].id })
      .expect(409);
    await api('post', 'spins')
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: earned[0].id })
      .expect(409);
    await api('get', 'draws?limit=51').expect(400);
    await api('get', 'draws?cursor=bad').expect(400);
    const page = await api('get', 'tickets?limit=1').expect(200);
    expect((page.body as { nextCursor: string }).nextCursor).toBeTruthy();
    await api(
      'get',
      `tickets?limit=1&cursor=${(page.body as { nextCursor: string }).nextCursor}`,
    ).expect(200);
    for (const path of ['tickets', 'draws'])
      await request(app.getHttpServer())
        .get(`/api/v1/users/me/streak-roulette/${path}`)
        .expect(401);
    await api('post', 'grants').send({}).expect(404);
  });

  it('does not count interrupted/not-performed routines as a milestone', async () => {
    await firstFour();
    const row = await routine();
    for (const watched of [0, 30]) {
      await routines.event(owner, row.id, row.items[0].id, randomUUID(), {
        deviceId: randomUUID(),
        sequence: 1,
        type: 'end',
        positionSeconds: watched,
        intervals: watched ? [{ start: 0, end: watched }] : [],
      });
      expect((await tickets()).availableCount).toBe(0);
    }
    await complete(row);
    expect((await tickets()).availableCount).toBe(1);
  });

  it('uses separate group/personal key and grant namespaces, preserving personal rewards after group deletion', async () => {
    const groups = app.get(GroupsService);
    const group = await groups.create(owner, randomUUID(), {
      name: '[TEST ONLY] separate roulette',
      description: '',
      maxMembers: 2,
    });
    const invite = await groups.inviteCode(owner, group.id);
    const application = await groups.apply(
      other,
      randomUUID(),
      invite.inviteCode,
    );
    await groups.decide(owner, group.id, application.id, 'approved');
    const missions = app.get(GroupMissionsService);
    await missions.start(owner, group.id, randomUUID());
    for (let n = 1; n <= 14; n++) {
      day(`2026-10-${String(n).padStart(2, '0')}`);
      await water();
      await water(other);
    }
    const personalTicket = (await tickets()).items[0];
    const groupTicket = (await missions.tickets(owner, group.id, { limit: 20 }))
      .items[0];
    const key = randomUUID();
    const personalDraw = await spin(personalTicket.id, key);
    await missions.spin(owner, group.id, groupTicket.id, key);
    expect((await spin(personalTicket.id, key)).replayed).toBe(true);
    const ledger = await db.currencyTransaction.findMany({
      where: { userId: owner },
    });
    expect(
      ledger.filter((t) => t.eventKey.startsWith('streak-roulette:')),
    ).toHaveLength(1);
    expect(
      ledger.filter((t) => t.eventKey.startsWith('group-roulette:')),
    ).toHaveLength(1);
    const inventory = await avatar.inventory(owner);
    await groups.delete(owner, group.id);
    expect(await avatar.inventory(owner)).toEqual(inventory);
    expect((await roulette.draws(owner, { limit: 20 })).items).toEqual([
      personalDraw.draw,
    ]);
    expect((await tickets()).availableCount).toBe(1);
  });
});
