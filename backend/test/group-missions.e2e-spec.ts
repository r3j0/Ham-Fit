import { retryTransaction } from '../src/database/transaction-retry.js';
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
import { Prisma } from '../src/generated/prisma/client.js';
import { AvatarService } from '../src/avatar/avatar.service.js';
import { GroupsService } from '../src/groups/groups.service.js';
import { GroupMissionsService } from '../src/groups/group-missions.service.js';
import { CurriculaService } from '../src/curricula/curricula.service.js';
import { WorkoutRoutinesService } from '../src/recommendations/workout-routines.service.js';
import { RecommendationsService } from '../src/recommendations/recommendations.service.js';
import { RoutineAlgorithm } from '../src/recommendations/routine-algorithm.js';
import { WorkoutCatalogService } from '../src/recommendations/workout-catalog.service.js';
import { fixtureAdjustment, fixtureCatalog } from './fixtures/workouts.js';
import { koreanDay, memberProfiles } from '../src/users/member-profile.js';
import { configureApp } from '../src/setup-app.js';
import { observeClientQueries } from './helpers/pg-queries.js';

type Routine = Awaited<ReturnType<ReturnType<typeof setupRoutineFactory>>>;
function setupRoutineFactory(db: DatabaseService) {
  return (userId: string, day: Date, items: number) =>
    db.workoutRoutine.create({
      data: {
        userId,
        assignmentDate: new Date(`${koreanDay(day)}T00:00:00Z`),
        referenceDate: new Date(`${koreanDay(day)}T00:00:00Z`),
        algorithmVersion: 'test-only',
        dataVersion: 'test-only',
        estimatedMinutes: 3,
        inputSnapshot: {},
        items: {
          create: Array.from({ length: items }, (_, index) => ({
            order: index + 1,
            videoId: `test-only-${index}`,
            title: '[TEST ONLY] mission completion',
            videoUrl: 'https://example.test/mission.mp4',
            durationSeconds: 100,
            slot: 'strength_group',
            prescription: {},
          })),
        },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    });
}

describe('group missions/roulette on real PostgreSQL', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let groups: GroupsService;
  let missions: GroupMissionsService;
  let routines: WorkoutRoutinesService;
  let legacy: RecommendationsService;
  let avatar: AvatarService;
  let now: Date;
  let roll = 0;
  let owner: string;
  let member: string;
  let other: string;
  const ids: string[] = [];
  const definitions: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GroupMissionsService)
      .useFactory({
        factory: (database: DatabaseService, shop: AvatarService) =>
          new GroupMissionsService(
            database,
            shop,
            () => now,
            () => roll,
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
                throw new Error('TEST ONLY generation is not used');
              },
              weightAdjustment: async () => fixtureAdjustment(),
            },
            () => now,
          ),
        inject: [DatabaseService],
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    groups = app.get(GroupsService);
    missions = app.get(GroupMissionsService);
    routines = app.get(WorkoutRoutinesService);
    legacy = app.get(RecommendationsService);
    avatar = app.get(AvatarService);
  });
  beforeEach(async () => {
    now = new Date('2026-10-01T01:00:00Z');
    roll = 0;
    owner = await account();
    member = await account();
    other = await account();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db?.group.deleteMany({ where: { leaderUserId: { in: ids } } });
    await db?.user.deleteMany({ where: { id: { in: ids } } });
    await db?.workoutCurriculum.deleteMany({
      where: { id: { in: definitions } },
    });
    await app?.close();
  });
  async function account() {
    const row = await db.user.create({
      data: {
        email: `missions-${randomUUID()}@example.test`,
        currency: { create: {} },
        preference: { create: {} },
      },
    });
    ids.push(row.id);
    return row.id;
  }
  async function group(members = [member]) {
    const row = await groups.create(owner, randomUUID(), {
      name: '[TEST ONLY] mission',
      description: '',
      maxMembers: 100,
    });
    for (const userId of members) await join(row.id, userId);
    return row.id;
  }
  async function join(groupId: string, userId: string) {
    const invite = await groups.inviteCode(owner, groupId);
    const application = await groups.apply(
      userId,
      randomUUID(),
      invite.inviteCode,
    );
    await groups.decide(owner, groupId, application.id, 'approved');
  }
  async function start(groupId: string) {
    const result = await missions.start(owner, groupId, randomUUID());
    return result.mission.id;
  }
  const current = (groupId: string, userId = owner) =>
    missions.current(userId, groupId);
  const savedRound = (id: string) =>
    db.groupMissionRound.findUniqueOrThrow({
      where: { id },
      include: { participants: true, contributions: true, tickets: true },
    });
  const routine = (userId = owner, items = 1) =>
    setupRoutineFactory(db)(userId, now, items);
  async function completeItem(row: Routine, index = 0) {
    const input = {
      deviceId: randomUUID(),
      sequence: 1,
      type: 'start' as const,
      positionSeconds: 0,
      intervals: [],
    };
    await routines.event(
      row.userId,
      row.id,
      row.items[index].id,
      randomUUID(),
      input,
    );
    const end = {
      ...input,
      sequence: 2,
      type: 'end' as const,
      positionSeconds: 80,
      intervals: [{ start: 0, end: 80 }],
    };
    const key = randomUUID();
    await routines.event(row.userId, row.id, row.items[index].id, key, end);
    return { key, end };
  }
  async function water(userId = owner) {
    const row = await routine(userId);
    await completeItem(row);
    return row;
  }
  async function tickets(groupId: string, userId = owner) {
    return (await missions.tickets(userId, groupId, { limit: 50 })).items;
  }
  async function balance(userId: string) {
    return (await db.userCurrency.findUniqueOrThrow({ where: { userId } }))
      .balance;
  }

  // Persisted ledger fixtures accelerate competition tests. The final completion
  // always enters the production workout event transaction; these are NOT
  // mock counters or a replacement for the end-to-end accumulation tests.
  async function seedWater(roundId: string, counts: Map<string, number>) {
    const round = await savedRound(roundId);
    const achievements: Prisma.ActivityAchievementCreateManyInput[] = [];
    const contributions: Prisma.GroupMissionContributionCreateManyInput[] = [];
    for (const participant of round.participants) {
      const count = counts.get(participant.userId!) ?? 0;
      for (let i = 0; i < count; i++) {
        const id = randomUUID();
        const at = new Date(round.startedAt.getTime() + i * 86_400_000);
        achievements.push({
          id,
          userId: participant.userId!,
          koreanDate: new Date(`${koreanDay(at)}T00:00:00Z`),
          achievedAt: at,
          sourceKind: 'routine',
          sourceId: randomUUID(),
        });
        contributions.push({
          groupId: round.groupId,
          roundId,
          participantId: participant.id,
          achievementId: id,
          contributedAt: at,
        });
      }
    }
    await db.$transaction(async (tx) => {
      if (achievements.length)
        await tx.activityAchievement.createMany({ data: achievements });
      if (contributions.length)
        await tx.groupMissionContribution.createMany({ data: contributions });
      for (const participant of round.participants)
        await tx.groupMissionParticipant.update({
          where: { id: participant.id },
          data: { waterCount: counts.get(participant.userId!) ?? 0 },
        });
      await tx.groupMissionRound.update({
        where: { id: roundId },
        data: { waterCount: contributions.length },
      });
    });
    now = new Date('2027-02-01T01:00:00Z');
  }
  async function finished() {
    const groupId = await group();
    const roundId = await start(groupId);
    await seedWater(
      roundId,
      new Map([
        [owner, 13],
        [member, 14],
      ]),
    );
    await water();
    return { groupId, roundId, ticketId: (await tickets(groupId))[0].id };
  }
  async function dailyAssignment(
    userId = owner,
    completed = false,
    internal = false,
  ) {
    const catalog = fixtureCatalog(`missions-${randomUUID()}`);
    await app.get(WorkoutCatalogService).activate(catalog);
    const definition = internal
      ? await db.workoutCurriculum.create({
          data: { name: '[TEST ONLY] internal mission' },
        })
      : await db.workoutCurriculum.findUniqueOrThrow({
          where: {
            catalogVersion_videoId: {
              catalogVersion: catalog.version,
              videoId: catalog.videos[0].videoId,
            },
          },
        });
    if (internal) definitions.push(definition.id);
    return db.userCurriculumAssignment.create({
      data: {
        userId,
        curriculumId: definition.id,
        requestKey: randomUUID(),
        ...(internal ? { currentForUserId: userId } : {}),
        assignedAt: new Date('2026-01-01'),
        ...(!internal
          ? {
              assignmentDate: new Date(`${koreanDay(now)}T00:00:00Z`),
              algorithmVersion: 'test-only',
              inputSnapshot: {},
            }
          : {}),
        ...(completed
          ? {
              status: 'completed',
              completedAt: now,
              ...(!internal
                ? { resultStatus: 'completed', performedAt: now }
                : {}),
            }
          : {}),
      },
    });
  }
  async function completeDaily(id: string, userId = owner) {
    const deviceId = randomUUID();
    await legacy.event(userId, id, randomUUID(), {
      deviceId,
      sequence: 1,
      type: 'start',
      positionSeconds: 0,
      intervals: [],
    });
    return legacy.event(userId, id, randomUUID(), {
      deviceId,
      sequence: 2,
      type: 'complete',
      positionSeconds: 0,
      intervals: [],
    });
  }

  it('requires two members/current leader, keeps create at one, deduplicates parallel starts and key conflicts', async () => {
    const groupId = await group([]);
    expect(await current(groupId)).toEqual({ status: 'not_started', id: null });
    await expect(start(groupId)).rejects.toMatchObject({ status: 409 });
    await join(groupId, member);
    await expect(
      missions.start(member, groupId, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    const key = randomUUID();
    const results = await Promise.all([
      missions.start(owner, groupId, key),
      missions.start(owner, groupId, key),
    ]);
    expect(results[0].mission.id).toBe(results[1].mission.id);
    expect((await savedRound(results[0].mission.id)).participants).toHaveLength(
      2,
    );
    expect(await db.groupMissionRound.count({ where: { groupId } })).toBe(1);
    await expect(start(groupId)).rejects.toMatchObject({ status: 409 });
    const second = await group();
    await expect(missions.start(owner, second, key)).rejects.toMatchObject({
      status: 409,
    });
    await groups.transfer(owner, groupId, member);
    await expect(missions.start(owner, groupId, key)).rejects.toMatchObject({
      status: 403,
    });
    expect(await missions.current(member, groupId)).toMatchObject({
      id: results[0].mission.id,
    });
  });
  it('serializes different start keys and rejects a second active round at DB level', async () => {
    const groupId = await group();
    const results = await Promise.allSettled([start(groupId), start(groupId)]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const row = await db.groupMissionRound.findFirstOrThrow({
      where: { groupId },
    });
    await expect(
      db.groupMissionRound.create({
        data: {
          groupId,
          memberCount: 2,
          totalTarget: 28,
          startedAt: now,
          policyVersion: row.policyVersion,
          roulettePolicy: row.roulettePolicy!,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.groupMissionRound.update({
        where: { id: row.id },
        data: { memberCount: 3, totalTarget: 42 },
      }),
    ).rejects.toThrow();
  });
  it('accepts only whole routines, deduplicates devices/keys/daily path and waters all eligible groups', async () => {
    const first = await group();
    const second = await group();
    const excluded = await group([other]);
    const roundIds = [
      await start(first),
      await start(second),
      await start(excluded),
    ];
    await join(excluded, member);
    const row = await routine(member, 2);
    await completeItem(row, 0);
    expect((await savedRound(roundIds[0])).waterCount).toBe(0);
    const final = await completeItem(row, 1);
    await routines.event(member, row.id, row.items[1].id, final.key, final.end);
    await routines.event(member, row.id, row.items[1].id, randomUUID(), {
      ...final.end,
      deviceId: randomUUID(),
      sequence: 1,
    });
    const assignment = await dailyAssignment(member);
    await completeDaily(assignment.id, member);
    for (const id of roundIds.slice(0, 2))
      expect(await savedRound(id)).toMatchObject({
        waterCount: 1,
        contributions: [expect.anything()],
      });
    expect((await savedRound(roundIds[2])).waterCount).toBe(0);
    expect(await current(excluded, member)).toMatchObject({
      me: { eligible: false, reason: 'not_in_snapshot' },
    });
    expect(
      await db.activityAchievement.count({ where: { userId: member } }),
    ).toBe(1);
  });
  it('handles simultaneous completion across devices and original paths once', async () => {
    const groupId = await group();
    const roundId = await start(groupId);
    const row = await routine();
    const item = row.items[0];
    await routines.event(owner, row.id, item.id, randomUUID(), {
      deviceId: randomUUID(),
      sequence: 1,
      type: 'start',
      positionSeconds: 0,
      intervals: [],
    });
    const assignment = await dailyAssignment();
    await Promise.all([
      routines.event(owner, row.id, item.id, randomUUID(), {
        deviceId: randomUUID(),
        sequence: 1,
        type: 'end',
        positionSeconds: 80,
        intervals: [{ start: 0, end: 80 }],
      }),
      routines.event(owner, row.id, item.id, randomUUID(), {
        deviceId: randomUUID(),
        sequence: 1,
        type: 'end',
        positionSeconds: 80,
        intervals: [{ start: 0, end: 80 }],
      }),
      completeDaily(assignment.id),
    ]);
    expect((await savedRound(roundId)).waterCount).toBe(1);
    expect(
      await db.activityAchievement.count({ where: { userId: owner } }),
    ).toBe(1);
  });
  it('accumulates nonconsecutive exercise days and every N/3N/7N/14N boundary including final water', async () => {
    const groupId = await group();
    const roundId = await start(groupId);
    const stages = new Map([
      [1, 'seed'],
      [2, 'sprout'],
      [5, 'sprout'],
      [6, 'stem'],
      [13, 'stem'],
      [14, 'bud'],
      [27, 'bud'],
      [28, 'sunflower'],
    ]);
    for (let i = 1; i <= 28; i++) {
      now = new Date(Date.UTC(2026, 9, 1 + (i - 1) * 2, 1));
      await water(i % 2 ? owner : member);
      if (stages.has(i))
        expect(await current(groupId)).toMatchObject({
          waterCount: i,
          stage: stages.get(i),
          memberCount: 2,
          totalTarget: 28,
        });
    }
    const saved = await savedRound(roundId);
    expect(saved.completedAt).not.toBeNull();
    expect(saved.contributions).toHaveLength(28);
    expect(saved.tickets).toHaveLength(4);
    expect(saved.participants.map((row) => row.waterCount)).toEqual([14, 14]);
    now = new Date('2027-03-01T01:00:00Z');
    await water();
    expect((await savedRound(roundId)).waterCount).toBe(28);
  });
  it('never uses a displayed yesterday streak or a read to water today', async () => {
    const groupId = await group();
    const id = await start(groupId);
    await water();
    now = new Date('2026-10-02T01:00:00Z');
    expect(
      (await db.$transaction((tx) => memberProfiles(tx, [owner], now))).get(
        owner,
      ),
    ).toMatchObject({ streak: 1 });
    await current(groupId);
    await tickets(groupId);
    await missions.history(owner, groupId, { limit: 1 });
    await missions.draws(owner, groupId, { limit: 1 });
    expect((await savedRound(id)).waterCount).toBe(1);
  });
  it('does not backfill completions before start/no active round or their retries', async () => {
    const groupId = await group();
    const row = await routine();
    const completion = await completeItem(row);
    const roundId = await start(groupId);
    await routines.event(
      owner,
      row.id,
      row.items[0].id,
      completion.key,
      completion.end,
    );
    await routines.event(owner, row.id, row.items[0].id, randomUUID(), {
      ...completion.end,
      deviceId: randomUUID(),
      sequence: 1,
    });
    const assignment = await dailyAssignment();
    await completeDaily(assignment.id);
    expect((await savedRound(roundId)).waterCount).toBe(0);
  });
  it('detects pre-rollout saved daily/routine completions on another completion path', async () => {
    const groupId = await group();
    const roundId = await start(groupId);
    await dailyAssignment(owner, true);
    await water();
    const row = await routine(member);
    await db.workoutRoutineItem.update({
      where: { id: row.items[0].id },
      data: {
        status: 'completed',
        completedAt: now,
        resultStatus: 'completed',
        performedAt: now,
      },
    });
    const assignment = await dailyAssignment(member);
    await completeDaily(assignment.id, member);
    expect((await savedRound(roundId)).waterCount).toBe(0);
    expect(
      await db.activityAchievement.count({
        where: { userId: { in: [owner, member] } },
      }),
    ).toBe(0);
  });
  it('excludes internal curricula, while allowing an eligible daily first completion', async () => {
    const groupId = await group();
    const roundId = await start(groupId);
    const internal = await dailyAssignment(owner, false, true);
    await app.get(CurriculaService).complete(owner, internal.id);
    expect((await savedRound(roundId)).waterCount).toBe(0);
    const assignment = await dailyAssignment();
    await completeDaily(assignment.id);
    await water();
    expect((await savedRound(roundId)).waterCount).toBe(1);
  });
  it('uses server KST midnight, preserves exact replay, and rejects expired fresh events', async () => {
    const groupId = await group();
    const roundId = await start(groupId);
    now = new Date('2026-10-01T14:59:59Z');
    const row = await routine();
    const last = await completeItem(row);
    now = new Date('2026-10-01T15:00:00Z');
    await routines.event(owner, row.id, row.items[0].id, last.key, last.end);
    await expect(
      routines.event(owner, row.id, row.items[0].id, randomUUID(), {
        ...last.end,
        deviceId: randomUUID(),
        sequence: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'ROUTINE_EXPIRED' } });
    const today = await routine();
    const item = today.items[0];
    const deviceId = randomUUID();
    await routines.event(owner, today.id, item.id, randomUUID(), {
      deviceId,
      sequence: 1,
      type: 'start',
      positionSeconds: 0,
      intervals: [],
    });
    await routines.event(owner, today.id, item.id, randomUUID(), {
      deviceId,
      sequence: 2,
      type: 'end',
      positionSeconds: 80,
      intervals: [{ start: 0, end: 80 }],
      occurredAt: '2026-10-01T01:00:00Z',
    });
    expect((await savedRound(roundId)).waterCount).toBe(2);
    expect(
      (
        await db.activityAchievement.findMany({
          where: { userId: owner },
          orderBy: { koreanDate: 'asc' },
        })
      ).map((row) => row.koreanDate.toISOString().slice(0, 10)),
    ).toEqual(['2026-10-01', '2026-10-02']);
  });
  it('permanently revokes departing/rejoining participants, preserves N/water and keeps a one-member round', async () => {
    const groupId = await group();
    const roundId = await start(groupId);
    await water(member);
    await groups.leave(member, groupId);
    await join(groupId, member);
    now = new Date('2026-10-02T01:00:00Z');
    await water(member);
    expect(await current(groupId, member)).toMatchObject({
      memberCount: 2,
      waterCount: 1,
      me: { eligible: false, reason: 'membership_ended', waterCount: 1 },
    });
    await groups.kick(owner, groupId, member);
    now = new Date('2026-10-03T01:00:00Z');
    await water();
    expect(await current(groupId)).toMatchObject({
      id: roundId,
      memberCount: 2,
      waterCount: 2,
      status: 'in_progress',
    });
  });
  it('serializes departure/admission and start snapshots', async () => {
    const groupId = await group();
    const id = await start(groupId);
    await water(member);
    const application = await groups.apply(
      other,
      randomUUID(),
      (await groups.inviteCode(owner, groupId)).inviteCode,
    );
    await Promise.all([
      groups.leave(member, groupId),
      groups.decide(owner, groupId, application.id, 'approved'),
    ]);
    await join(groupId, member);
    now = new Date('2026-10-02T01:00:00Z');
    await Promise.all([water(member), water(other)]);
    expect(await current(groupId)).toMatchObject({
      memberCount: 2,
      waterCount: 1,
    });
    expect(
      (await savedRound(id)).participants.find((row) => row.userId === member)
        ?.invalidatedAt,
    ).not.toBeNull();
  });
  it('anonymizes permanent account deletion without removing frozen progress', async () => {
    const groupId = await group();
    const id = await start(groupId);
    await water(member);
    await db.user.delete({ where: { id: member } });
    const row = await savedRound(id);
    expect(row.memberCount).toBe(2);
    expect(row.waterCount).toBe(1);
    expect(row.contributions).toHaveLength(1);
    expect(row.contributions[0].achievementId).toBeNull();
    expect(
      row.participants.find((participant) => participant.userId === null),
    ).toMatchObject({ waterCount: 1, invalidatedAt: expect.any(Date) });
  });
  it('finalizes concurrent final contributions once and never reuses the same day in a new round', async () => {
    const groupId = await group();
    const id = await start(groupId);
    await seedWater(
      id,
      new Map([
        [owner, 13],
        [member, 13],
      ]),
    );
    const a = await routine(owner);
    const b = await routine(member);
    await Promise.all([completeItem(a), completeItem(b)]);
    expect(await savedRound(id)).toMatchObject({
      waterCount: 28,
      completedAt: expect.any(Date),
    });
    expect((await savedRound(id)).tickets).toHaveLength(4);
    const next = await start(groupId);
    for (const row of [a, b])
      await routines.event(row.userId, row.id, row.items[0].id, randomUUID(), {
        deviceId: randomUUID(),
        sequence: 1,
        type: 'end',
        positionSeconds: 80,
        intervals: [{ start: 0, end: 80 }],
      });
    const daily = await dailyAssignment();
    await completeDaily(daily.id);
    expect((await savedRound(next)).waterCount).toBe(0);
    expect(
      (await tickets(groupId)).every(
        (ticket) => ticket.roundId === id && ticket.usable,
      ),
    ).toBe(true);
  });
  it('uses floor contribution/7, forfeits departures before mint and preserves the final contribution', async () => {
    const groupId = await group([member, other]);
    const id = await start(groupId);
    await seedWater(
      id,
      new Map([
        [owner, 20],
        [member, 14],
        [other, 7],
      ]),
    );
    await groups.leave(other, groupId);
    await water();
    const row = await savedRound(id);
    expect(row.waterCount).toBe(42);
    const byUser = new Map(row.participants.map((p) => [p.id, p.userId]));
    expect(
      row.tickets.filter((t) => byUser.get(t.participantId) === owner),
    ).toHaveLength(3);
    expect(
      row.tickets.filter((t) => byUser.get(t.participantId) === member),
    ).toHaveLength(2);
    expect(
      row.tickets.filter((t) => byUser.get(t.participantId) === other),
    ).toHaveLength(0);
  });
  it('revokes minted tickets on departure and never restores them on rejoin or retry', async () => {
    const { groupId, ticketId } = await finished();
    const key = randomUUID();
    await missions.spin(owner, groupId, ticketId, key);
    const unused = (await tickets(groupId)).find((ticket) => ticket.usable)!;
    await groups.transfer(owner, groupId, member);
    await groups.leave(owner, groupId);
    await expect(
      missions.spin(owner, groupId, ticketId, key),
    ).rejects.toMatchObject({ status: 403 });
    const invite = await groups.inviteCode(member, groupId);
    const application = await groups.apply(
      owner,
      randomUUID(),
      invite.inviteCode,
    );
    await groups.decide(member, groupId, application.id, 'approved');
    expect(await missions.tickets(owner, groupId, { limit: 50 })).toMatchObject(
      {
        items: expect.arrayContaining([
          expect.objectContaining({
            id: unused.id,
            status: 'invalidated',
            usable: false,
          }),
        ]),
      },
    );
    await expect(
      missions.spin(owner, groupId, unused.id, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      missions.spin(owner, groupId, ticketId, key),
    ).rejects.toMatchObject({ status: 403 });
    expect(await balance(owner)).toBe(1);
  });
  it.each([
    [0, 1],
    [50, 3],
    [75, 5],
    [88, 7],
  ])('credits the self-only result for roll %i once', async (value, amount) => {
    const { groupId, ticketId } = await finished();
    roll = value;
    const result = await missions.spin(owner, groupId, ticketId, randomUUID());
    expect(result.draw.myReward[0].amount).toBe(amount);
    expect(await balance(owner)).toBe(amount);
    expect(await balance(member)).toBe(0);
    expect(result.draw.recipients).toHaveLength(1);
  });
  it.each([
    [95, 3],
    [99, 7],
  ])(
    'pays original eligible contributors including 1-6 contributions for roll %i',
    async (value, amount) => {
      const zero = await account();
      const late = await account();
      const groupId = await group([member, other, zero]);
      const id = await start(groupId);
      await seedWater(
        id,
        new Map([
          [owner, 34],
          [member, 18],
          [other, 3],
          [zero, 0],
        ]),
      );
      await water();
      await join(groupId, late);
      await groups.leave(member, groupId);
      await join(groupId, member);
      const next = await start(groupId);
      now = new Date('2027-02-02T01:00:00Z');
      await water(late);
      const ticket = (await tickets(groupId))[0];
      roll = value;
      const result = await missions.spin(
        owner,
        groupId,
        ticket.id,
        randomUUID(),
      );
      expect(result.draw.roundId).toBe(id);
      expect(result.draw.roundId).not.toBe(next);
      expect(
        result.draw.recipients
          .map((recipient) => recipient.userId)
          .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
      ).toEqual([owner, other].sort((a, b) => a.localeCompare(b)));
      for (const userId of [owner, other])
        expect(await balance(userId)).toBe(amount);
      for (const userId of [member, zero, late])
        expect(await balance(userId)).toBe(0);
      expect(await missions.draws(other, groupId, { limit: 50 })).toMatchObject(
        {
          items: [
            expect.objectContaining({
              id: result.draw.id,
              myReward: [expect.objectContaining({ amount })],
            }),
          ],
        },
      );
    },
  );
  it('serializes concurrent same-ticket use, stable retries and changed-input conflicts', async () => {
    const { groupId, ticketId } = await finished();
    roll = 95;
    const key = randomUUID();
    const results = await Promise.all([
      missions.spin(owner, groupId, ticketId, key),
      missions.spin(owner, groupId, ticketId, key),
    ]);
    expect(results[0].draw).toEqual(results[1].draw);
    expect(await balance(owner)).toBe(3);
    expect(await balance(member)).toBe(3);
    const otherTicket = (await tickets(groupId)).find(
      (ticket) => ticket.usable,
    )!;
    await expect(
      missions.spin(owner, groupId, otherTicket.id, key),
    ).rejects.toMatchObject({ status: 409 });
    await groups.leave(member, groupId);
    roll = 99;
    expect((await missions.spin(owner, groupId, ticketId, key)).draw).toEqual(
      results[0].draw,
    );
    expect(await db.groupRouletteDraw.count({ where: { ticketId } })).toBe(1);
    expect(
      await db.currencyTransaction.count({
        where: { eventKey: `group-roulette:${results[0].draw.id}` },
      }),
    ).toBe(2);
  });
  it('allows only one winner for different keys on one ticket and checks ticket ownership', async () => {
    const { groupId, ticketId } = await finished();
    await expect(
      missions.spin(member, groupId, ticketId, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    const results = await Promise.allSettled([
      missions.spin(owner, groupId, ticketId, randomUUID()),
      missions.spin(owner, groupId, ticketId, randomUUID()),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(owner)).toBe(1);
  });
  it('rolls back ticket/draw/every currency transaction when the second group grant fails', async () => {
    const { groupId, ticketId } = await finished();
    roll = 95;
    const key = randomUUID();
    const original = avatar.grantCurrencyInTransaction.bind(avatar);
    let count = 0;
    const spy = vi
      .spyOn(avatar, 'grantCurrencyInTransaction')
      .mockImplementation(async (...args) => {
        const result = await original(...args);
        if (++count === 2) throw new Error('TEST ONLY injected payout failure');
        return result;
      });
    await expect(missions.spin(owner, groupId, ticketId, key)).rejects.toThrow(
      'injected payout failure',
    );
    spy.mockRestore();
    expect(await balance(owner)).toBe(0);
    expect(await balance(member)).toBe(0);
    expect(await db.groupRouletteDraw.count({ where: { ticketId } })).toBe(0);
    expect(
      await db.currencyTransaction.count({
        where: { userId: { in: [owner, member] } },
      }),
    ).toBe(0);
    expect(
      (await tickets(groupId)).find((ticket) => ticket.id === ticketId)?.usable,
    ).toBe(true);
    await missions.spin(owner, groupId, ticketId, key);
    expect(await balance(owner)).toBe(3);
    expect(await balance(member)).toBe(3);
  });
  it('keeps balance caps and serializes payouts against shop purchases', async () => {
    const { groupId, ticketId } = await finished();
    roll = 95;
    await db.userCurrency.update({
      where: { userId: member },
      data: { balance: 2147483647 },
    });
    await expect(
      missions.spin(owner, groupId, ticketId, randomUUID()),
    ).rejects.toMatchObject({ response: { code: 'BALANCE_LIMIT' } });
    expect(await balance(owner)).toBe(0);
    expect(
      (await tickets(groupId)).find((t) => t.id === ticketId)?.usable,
    ).toBe(true);
    await db.userCurrency.update({
      where: { userId: member },
      data: { balance: 0 },
    });
    await avatar.grantCurrency(owner, `test:${randomUUID()}`, 100);
    const product = await db.avatarProduct.findUniqueOrThrow({
      where: { id: 'pose.run' },
    });
    await Promise.all([
      missions.spin(owner, groupId, ticketId, randomUUID()),
      avatar.purchase(owner, randomUUID(), {
        productId: product.id,
        catalogRevision: product.catalogRevision,
      }),
    ]);
    expect(await balance(owner)).toBe(103 - product.price!);
    const ledger = await db.currencyTransaction.findMany({
      where: { userId: owner },
    });
    expect(ledger.reduce((sum, row) => sum + row.amount, 0)).toBe(
      await balance(owner),
    );
  });
  it.each(['leave', 'kick', 'delete'] as const)(
    'serializes roulette with %s and preserves personal funds/completions',
    async (operation) => {
      const { groupId, roundId } = await finished();
      const ticketId = (await tickets(groupId, member))[0].id;
      const results = await Promise.allSettled([
        missions.spin(member, groupId, ticketId, randomUUID()),
        operation === 'leave'
          ? groups.leave(member, groupId)
          : operation === 'kick'
            ? groups.kick(owner, groupId, member)
            : groups.delete(owner, groupId),
      ]);
      expect(results[1].status).toBe('fulfilled');
      const succeeded = results[0].status === 'fulfilled';
      expect(await balance(member)).toBe(succeeded ? 1 : 0);
      expect(
        await db.currencyTransaction.count({ where: { userId: member } }),
      ).toBe(succeeded ? 1 : 0);
      expect(await db.workoutRoutine.count({ where: { userId: owner } })).toBe(
        1,
      );
      if (operation === 'delete') {
        expect(
          await db.groupMissionRound.count({ where: { id: roundId } }),
        ).toBe(0);
        expect(await db.groupRouletteTicket.count({ where: { roundId } })).toBe(
          0,
        );
        expect(
          await db.activityAchievement.count({ where: { userId: owner } }),
        ).toBeGreaterThan(0);
      } else
        await expect(
          missions.spin(member, groupId, ticketId, randomUUID()),
        ).rejects.toMatchObject({ status: 403 });
    },
  );
  it('rolls back original completion and all groups when one contribution insert fails', async () => {
    const groupIds = [await group(), await group()].sort((a, b) =>
      a.localeCompare(b),
    );
    const roundIds: string[] = [];
    for (const groupId of groupIds) roundIds.push(await start(groupId));
    const row = await routine();
    const item = row.items[0];
    const deviceId = randomUUID();
    await routines.event(owner, row.id, item.id, randomUUID(), {
      deviceId,
      sequence: 1,
      type: 'start',
      positionSeconds: 0,
      intervals: [],
    });
    const schema = new URL(process.env.DATABASE_URL!).searchParams.get(
      'schema',
    )!;
    if (!/^test_[a-f0-9]+$/.test(schema))
      throw new Error('Isolated test schema required');
    await db.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".test_group_water_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.group_id = '${groupIds[1]}'::uuid THEN RAISE EXCEPTION 'TEST ONLY contribution failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_group_water_failure BEFORE INSERT ON "${schema}".group_mission_contributions FOR EACH ROW EXECUTE FUNCTION "${schema}".test_group_water_failure()`,
    );
    const key = randomUUID();
    const input = {
      deviceId,
      sequence: 2,
      type: 'end' as const,
      positionSeconds: 80,
      intervals: [{ start: 0, end: 80 }],
    };
    try {
      await expect(
        routines.event(owner, row.id, item.id, key, input),
      ).rejects.toThrow();
      for (const id of roundIds)
        expect((await savedRound(id)).waterCount).toBe(0);
      expect(
        await db.activityAchievement.count({ where: { userId: owner } }),
      ).toBe(0);
      expect(
        await db.workoutRoutineEvent.count({ where: { itemId: item.id, key } }),
      ).toBe(0);
      expect(
        await db.workoutRoutineItem.findUniqueOrThrow({
          where: { id: item.id },
        }),
      ).toMatchObject({ status: 'in_progress', completedAt: null });
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER test_group_water_failure ON "${schema}".group_mission_contributions`,
      );
      await db.$executeRawUnsafe(
        `DROP FUNCTION "${schema}".test_group_water_failure()`,
      );
    }
    await routines.event(owner, row.id, item.id, key, input);
    for (const id of roundIds)
      expect((await savedRound(id)).waterCount).toBe(1);
  });
  it('anonymizes old payouts and excludes deleted accounts from later group rewards', async () => {
    const { groupId, ticketId, roundId } = await finished();
    roll = 95;
    const draw = await missions.spin(owner, groupId, ticketId, randomUUID());
    await db.user.delete({ where: { id: member } });
    const remaining = (await tickets(groupId)).find((ticket) => ticket.usable)!;
    const later = await missions.spin(
      owner,
      groupId,
      remaining.id,
      randomUUID(),
    );
    expect(later.draw.recipients).toEqual([{ userId: owner, amount: 3 }]);
    expect((await savedRound(roundId)).waterCount).toBe(28);
    const anonymous = await db.groupRouletteReward.findFirst({
      where: { drawId: draw.draw.id, userId: null },
    });
    expect(anonymous).toMatchObject({ amount: 3, transactionId: null });
    expect(await balance(owner)).toBe(6);
  });
  it('paginates mission/ticket/draw history without mutating data', async () => {
    const { groupId, ticketId } = await finished();
    await start(groupId);
    const first = await missions.history(owner, groupId, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await missions.history(owner, groupId, {
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.nextCursor).toBeNull();
    await missions.spin(owner, groupId, ticketId, randomUUID());
    const page = await missions.tickets(owner, groupId, { limit: 1 });
    expect(page.nextCursor).not.toBeNull();
    const next = await missions.tickets(owner, groupId, {
      limit: 1,
      cursor: page.nextCursor!,
    });
    expect(next.items[0].id).not.toBe(page.items[0].id);
    expect(
      (await missions.draws(owner, groupId, { limit: 1 })).items,
    ).toHaveLength(1);
  });
  it('reads ticket pages in bounded sequential queries without overlapping one pg client', async () => {
    const { groupId, roundId, ticketId } = await finished();
    const used = await missions.spin(owner, groupId, ticketId, randomUUID());
    const rows = await db.groupRouletteTicket.findMany({
      where: { roundId, participant: { userId: owner } },
      orderBy: { id: 'asc' },
    });
    const round = await db.groupMissionRound.findUniqueOrThrow({
      where: { id: roundId },
    });
    const expected = rows.map((ticket) => ({
      id: ticket.id,
      roundId,
      createdAt: ticket.createdAt,
      policyVersion: round.policyVersion,
      status: ticket.id === ticketId ? 'used' : 'available',
      usable: ticket.id !== ticketId,
      usedAt: ticket.id === ticketId ? used.draw.drawnAt : null,
      invalidatedAt: null,
    }));
    const small = await observeClientQueries(() =>
      missions.tickets(owner, groupId, { limit: 1 }),
    );
    const all = await observeClientQueries(() =>
      missions.tickets(owner, groupId, { limit: 50 }),
    );
    expect(small.overlaps).toBe(0);
    expect(all.overlaps).toBe(0);
    expect(small.value).toEqual({
      items: expected.slice(0, 1),
      nextCursor: rows[0].id,
    });
    expect(all.value).toEqual({ items: expected, nextCursor: null });
    expect(all.queries).toHaveLength(small.queries.length);
    for (const table of [
      'group_mission_rounds',
      'group_mission_participants',
      'group_roulette_draws',
    ]) {
      expect(
        all.queries.filter(
          (sql) => sql.match(/\bFROM\s+"[^"]+"\."([^"]+)"/i)?.[1] === table,
        ),
      ).toHaveLength(1);
    }
    const next = await missions.tickets(owner, groupId, {
      limit: 1,
      cursor: small.value.nextCursor!,
    });
    expect(next).toEqual({ items: expected.slice(1), nextCursor: null });
    const emptyGroupId = await group();
    const empty = await observeClientQueries(() =>
      missions.tickets(owner, emptyGroupId, { limit: 50 }),
    );
    expect(empty.overlaps).toBe(0);
    expect(empty.value).toEqual({ items: [], nextCursor: null });
  });
  it('spins and replays with sequential queries on the transaction client', async () => {
    const { groupId, ticketId } = await finished();
    roll = 95;
    const key = randomUUID();
    const first = await observeClientQueries(() =>
      missions.spin(owner, groupId, ticketId, key),
    );
    expect(first.overlaps).toBe(0);
    expect(first.value.replayed).toBe(false);
    const replay = await observeClientQueries(() =>
      missions.spin(owner, groupId, ticketId, key),
    );
    expect(replay.overlaps).toBe(0);
    expect(replay.value).toEqual({ draw: first.value.draw, replayed: true });
    expect(await balance(owner)).toBe(3);
    expect(await balance(member)).toBe(3);
    expect(await db.groupRouletteDraw.count({ where: { ticketId } })).toBe(1);
  });
  it('excludes whole routines with a preexisting future completion, matching activity eligibility', async () => {
    const groupId = await group();
    const roundId = await start(groupId);
    const row = await routine(owner, 2);
    const future = new Date(now.getTime() + 86_400_000);
    await db.workoutRoutineItem.update({
      where: { id: row.items[0].id },
      data: {
        status: 'completed',
        completedAt: future,
        resultStatus: 'completed',
        performedAt: future,
      },
    });
    await completeItem(row, 1);
    expect((await savedRound(roundId)).waterCount).toBe(0);
    expect(
      await db.activityAchievement.count({ where: { userId: owner } }),
    ).toBe(0);
    expect(
      (await db.$transaction((tx) => memberProfiles(tx, [owner], now))).get(
        owner,
      ),
    ).toMatchObject({ totalWorkoutDays: 0 });
  });
  it.each([
    [6, 0],
    [7, 1],
    [14, 2],
    [20, 2],
    [21, 3],
  ])(
    'persists %i personal contributions as exactly %i minted tickets',
    async (count, expected) => {
      const groupId = await group();
      const roundId = await start(groupId);
      await seedWater(
        roundId,
        new Map([
          [owner, count - 1],
          [member, 28 - count],
        ]),
      );
      await water();
      const saved = await savedRound(roundId);
      expect(
        saved.participants.find((participant) => participant.userId === owner)
          ?.waterCount,
      ).toBe(count);
      expect(saved.contributions).toHaveLength(28);
      expect(await tickets(groupId)).toHaveLength(expected);
    },
  );
  it('retries the whole PostgreSQL deadlock between account cascade and group roulette', async () => {
    const { groupId, ticketId, roundId } = await finished();
    roll = 95;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const deletion = retryTransaction(() =>
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM ${db.table('users')} WHERE id = ${member}::uuid FOR UPDATE`;
        acquired();
        await gate;
        await tx.user.delete({ where: { id: member } });
      }),
    );
    await locked;
    let ready!: () => void;
    const reached = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const table = db.table.bind(db);
    const spy = vi.spyOn(db, 'table').mockImplementation((name) => {
      if (name === 'group_memberships') ready();
      return table(name);
    });
    try {
      const spin = missions.spin(owner, groupId, ticketId, randomUUID());
      await reached;
      release();
      const [result] = await Promise.all([spin, deletion]);
      expect(await balance(owner)).toBe(3);
      expect(await db.user.findUnique({ where: { id: member } })).toBeNull();
      expect(await db.groupRouletteDraw.count({ where: { ticketId } })).toBe(1);
      expect(
        await db.currencyTransaction.count({
          where: {
            userId: owner,
            eventKey: `group-roulette:${result.draw.id}`,
          },
        }),
      ).toBe(1);
      expect((await savedRound(roundId)).waterCount).toBe(28);
      const rewards = await db.groupRouletteReward.findMany({
        where: { drawId: result.draw.id },
      });
      expect(rewards.find((reward) => reward.userId === owner)?.amount).toBe(3);
      expect(
        rewards.every(
          (reward) => reward.userId === owner || reward.userId === null,
        ),
      ).toBe(true);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it('uses strict v1 HTTP/auth/CSRF/cache/page contracts and has no manual watering route', async () => {
    await db.authRateLimit.deleteMany();
    const registration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `mission-http-${randomUUID()}@example.test`,
        password: 'mission-http-test-password',
      })
      .expect(201);
    const accountBody = registration.body as {
      user: { id: string };
      access_token: string;
    };
    ids.push(accountBody.user.id);
    const groupId = await group();
    await join(groupId, accountBody.user.id);
    const api = (method: 'get' | 'post', path: string) =>
      request(app.getHttpServer())
        [method](`/api/v1/groups/${groupId}${path}`)
        .set('Authorization', `Bearer ${accountBody.access_token}`)
        .set('X-CSRF-Protection', '1');
    await api('post', '/missions/start').send({}).expect(400);
    await api('post', '/missions/start')
      .set('Idempotency-Key', randomUUID())
      .send({ result: 'self_7' })
      .expect(400);
    await api('post', '/missions/start')
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
    await start(groupId);
    const response = await api('get', '/missions/current').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    await api('get', '/missions?limit=0').expect(400);
    await api('get', '/missions?limit=1').expect(200);
    await api('post', '/roulette/spins')
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: randomUUID(), amount: 7 })
      .expect(400);
    await api('post', '/missions/water').send({}).expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/groups/${groupId}/missions/current`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/roulette/spins`)
      .set('Authorization', `Bearer ${accountBody.access_token}`)
      .send({ ticketId: randomUUID() })
      .expect(403);
    expect(JSON.stringify(response.body)).not.toMatch(
      /balance|inventory|purchases/,
    );
  });
});
