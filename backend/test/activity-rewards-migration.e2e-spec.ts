import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { ActivityRewardsService } from '../src/users/activity-rewards.service.js';

it('adds the reward ledger without mutating or backfilling historical user/workout/group/shop records', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('Isolated test schema required');
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const schema = `test_reward_upgrade_${randomUUID().replaceAll('-', '')}`;
  let db: DatabaseService | undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const root = new URL('../prisma/migrations/', import.meta.url);
    const target = '20261001000300_routine_activity_rewards';
    for (const name of (await readdir(root))
      .filter((name) => /^\d/.test(name) && name < target)
      .sort())
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
      );
    url.searchParams.set('schema', schema);
    db = new DatabaseService(
      new ConfigService({ DATABASE_URL: url.toString() }),
    );
    await db.onModuleInit();
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        currency: { create: { balance: 99 } },
        preference: { create: {} },
      },
    });
    const completedAt = new Date('2026-09-29T01:00:00Z');
    const routine = await db.workoutRoutine.create({
      data: {
        userId: user.id,
        assignmentDate: new Date('2026-09-29'),
        referenceDate: new Date('2026-09-29'),
        algorithmVersion: 'test-only',
        dataVersion: 'test-only',
        estimatedMinutes: 1,
        inputSnapshot: {},
        items: {
          create: {
            order: 1,
            videoId: 'TEST_ONLY',
            title: '[TEST ONLY] historical',
            videoUrl: 'https://example.test/video',
            durationSeconds: 100,
            slot: 'strength_group',
            prescription: {},
            status: 'completed',
            completedAt,
            resultStatus: 'completed',
            performedAt: completedAt,
          },
        },
      },
    });
    await db.activityAchievement.create({
      data: {
        userId: user.id,
        koreanDate: new Date('2026-09-29'),
        achievedAt: completedAt,
        sourceKind: 'routine',
        sourceId: routine.id,
      },
    });
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
    await client.query(
      await readFile(new URL(`${target}/migration.sql`, root), 'utf8'),
    );
    for (const table of tables)
      expect(
        (await client.query(`SELECT * FROM "${table}" ORDER BY 1,2`)).rows,
      ).toEqual(before.get(table));
    expect(await db.routineActivityReward.count()).toBe(0);
    const rewards = new ActivityRewardsService(db);
    await expect(rewards.receipt(user.id, routine.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      (await db.userCurrency.findUniqueOrThrow({ where: { userId: user.id } }))
        .balance,
    ).toBe(99);
  } finally {
    await db?.onModuleDestroy();
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}, 30_000);
