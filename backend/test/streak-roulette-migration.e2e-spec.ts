import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { AvatarService } from '../src/avatar/avatar.service.js';
import { GroupMissionsService } from '../src/groups/group-missions.service.js';
import { GroupsService } from '../src/groups/groups.service.js';
import { StreakRouletteService } from '../src/streak-roulette/streak-roulette.service.js';
import { STREAK_POLICY } from '../src/streak-roulette/streak-policy.js';
import { STREAK_POLICY_VERSION } from '../src/streak-roulette/streak-ticket.js';

it('upgrades existing workouts, achievements, group tickets/draws, shop ledger and outfits without backfill or mutation', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  ) {
    throw new Error('An isolated test database/schema is required.');
  }
  const schema = `test_streak_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  let db: DatabaseService | undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const root = new URL('../prisma/migrations/', import.meta.url);
    const migrations = (await readdir(root))
      .filter((name) => /^\d/.test(name))
      .sort();
    for (const name of migrations.filter(
      (name) => name < '20261001000100_streak_roulette_tickets',
    )) {
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
      );
    }
    url.searchParams.set('schema', schema);
    db = new DatabaseService(
      new ConfigService({ DATABASE_URL: url.toString() }),
    );
    await db.onModuleInit();
    const database = db;
    const now = new Date('2026-10-01T01:00:00Z');
    const owner = await database.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        currency: { create: {} },
        preference: { create: {} },
      },
    });
    const member = await database.user.create({
      data: { email: `${randomUUID()}@example.test`, currency: { create: {} } },
    });
    const shop = new AvatarService(database);
    await shop.grantCurrency(owner.id, `test:${randomUUID()}`, 150);
    await shop.purchase(owner.id, randomUUID(), {
      productId: 'pose.run',
      catalogRevision: 1,
    });
    await shop.saveOutfit(owner.id, 1, {
      characterId: 'character.gray',
      poseId: 'pose.run',
      clothingIds: [],
    });
    const groups = new GroupsService(database);
    const group = await groups.create(owner.id, randomUUID(), {
      name: '[TEST ONLY] preserved',
      description: '',
      maxMembers: 2,
    });
    const invite = await groups.inviteCode(owner.id, group.id);
    const application = await groups.apply(
      member.id,
      randomUUID(),
      invite.inviteCode,
    );
    await groups.decide(owner.id, group.id, application.id, 'approved');
    const missions = new GroupMissionsService(
      database,
      shop,
      () => now,
      () => 0,
    );
    const { mission } = await missions.start(owner.id, group.id, randomUUID());
    const participant = await database.groupMissionParticipant.findFirstOrThrow(
      { where: { roundId: mission.id, userId: owner.id } },
    );
    await database.groupMissionParticipant.update({
      where: { id: participant.id },
      data: { waterCount: 14 },
    });
    await database.groupMissionRound.update({
      where: { id: mission.id },
      data: { waterCount: 28, completedAt: now },
    });
    const groupTicket = await database.groupRouletteTicket.create({
      data: {
        roundId: mission.id,
        participantId: participant.id,
        ordinal: 1,
        createdAt: now,
      },
    });
    await missions.spin(owner.id, group.id, groupTicket.id, randomUUID());
    const definition = await database.workoutCurriculum.create({
      data: { name: '[TEST ONLY] preserved daily' },
    });
    for (let n = 1; n <= 5; n++) {
      const day = new Date(`2026-09-${25 + n}T00:00:00Z`);
      const completedAt = new Date(day.getTime() + 3_600_000);
      const assignment = await database.userCurriculumAssignment.create({
        data: {
          userId: owner.id,
          curriculumId: definition.id,
          requestKey: randomUUID(),
          assignmentDate: day,
          assignedAt: day,
          status: 'completed',
          completedAt,
          resultStatus: 'completed',
          performedAt: completedAt,
          algorithmVersion: 'test-only',
          inputSnapshot: {},
        },
      });
      await database.activityAchievement.create({
        data: {
          userId: owner.id,
          koreanDate: day,
          achievedAt: completedAt,
          sourceKind: 'daily_assignment',
          sourceId: assignment.id,
        },
      });
    }
    const tables = (
      await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
        [schema],
      )
    ).rows.map((row) => row.table_name);
    const before = new Map<string, unknown[]>();
    for (const table of tables)
      before.set(
        table,
        (await client.query(`SELECT * FROM "${table}" ORDER BY 1,2`))
          .rows as unknown[],
      );
    for (const name of migrations.filter(
      (name) => name >= '20261001000100_streak_roulette_tickets',
    )) {
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
      );
    }
    for (const table of tables)
      expect(
        (await client.query(`SELECT * FROM "${table}" ORDER BY 1,2`)).rows,
        table,
      ).toEqual(before.get(table));
    expect(await database.streakRouletteTicket.count()).toBe(0);
    expect(await database.streakRouletteDraw.count()).toBe(0);
    expect(
      await database.avatarProduct.count({ where: { kind: 'clothing' } }),
    ).toBe(0);
    expect(
      await database.streakRoulettePolicy.findUnique({
        where: { version: STREAK_POLICY_VERSION },
      }),
    ).toEqual({ version: STREAK_POLICY_VERSION, snapshot: STREAK_POLICY });
    const personal = new StreakRouletteService(database, shop);
    expect(await personal.tickets(owner.id, { limit: 20 })).toEqual({
      items: [],
      availableCount: 0,
      nextCursor: null,
    });
    expect(await personal.draws(owner.id, { limit: 20 })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(await shop.inventory(owner.id)).toMatchObject({
      currency: { balance: 81 },
    });
    // Existing sources still pass their CHECK, while roulette is added.
    await shop.purchase(owner.id, randomUUID(), {
      productId: 'pose.curious',
      catalogRevision: 1,
    });
    expect((await shop.outfit(owner.id)).poseId).toBe('pose.run');
  } finally {
    await db?.onModuleDestroy();
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}, 30_000);
