import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { AvatarService } from '../src/avatar/avatar.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
  ActivityRewardsService,
  recordRoutineReward,
} from '../src/users/activity-rewards.service.js';

it('upgrades the catalog while preserving old prices, owned a-plus, saved outfits, receipts and every other record', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('Isolated test schema required');
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const schema = `test_outputter_upgrade_${randomUUID().replaceAll('-', '')}`;
  let db: DatabaseService | undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const root = new URL('../prisma/migrations/', import.meta.url);
    const target = '20261001000400_hamster_outputter_v2';
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
    const database = db;
    const user = await database.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        currency: { create: {} },
        preference: { create: {} },
      },
    });
    const shop = new AvatarService(database);
    await shop.grantCurrency(user.id, `test:${randomUUID()}`, 200);
    // Explicit pre-upgrade fixture prices; historical purchases retain 60
    // even though the new registry raises passion and retires a-plus.
    await database.avatarProduct.updateMany({
      where: { id: { in: ['pose.a-plus', 'pose.passion'] } },
      data: { priceProvisional: false },
    });
    const purchaseKey = randomUUID();
    const aPlus = await database.avatarProduct.findUniqueOrThrow({
      where: { id: 'pose.a-plus' },
    });
    for (const id of ['pose.a-plus', 'pose.passion']) {
      const product = await database.avatarProduct.findUniqueOrThrow({
        where: { id },
      });
      await shop.purchase(
        user.id,
        id === aPlus.id ? purchaseKey : randomUUID(),
        {
          productId: id,
          catalogRevision: product.catalogRevision,
        },
      );
    }
    await shop.saveOutfit(user.id, 1, {
      characterId: 'character.gray',
      poseId: 'pose.a-plus',
      clothingIds: [],
    });
    // Stored evidence from the preceding reward migration must also survive
    // the catalog migration; this is isolated, explicit test-only history.
    const completedAt = new Date('2026-09-29T01:00:00Z');
    const routine = await database.workoutRoutine.create({
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
            title: '[TEST ONLY] preserved completion',
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
    await database.activityAchievement.create({
      data: {
        userId: user.id,
        koreanDate: new Date('2026-09-29'),
        achievedAt: completedAt,
        sourceKind: 'routine',
        sourceId: routine.id,
      },
    });
    await database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ${database.table('users')} WHERE id=${user.id}::uuid FOR NO KEY UPDATE`;
      await recordRoutineReward(database, tx, user.id, routine.id, completedAt);
    });
    const rewards = new ActivityRewardsService(database);
    const receipt = await rewards.receipt(user.id, routine.id);
    const outfit = await shop.outfit(user.id);
    const inventory = await shop.inventory(user.id);
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
    const oldProducts = await database.avatarProduct.findMany();
    const oldCombinations = await database.avatarCombination.findMany();
    const oldItems = await database.avatarCombinationItem.findMany();
    await client.query(
      await readFile(new URL(`${target}/migration.sql`, root), 'utf8'),
    );
    for (const table of tables.filter(
      (name) =>
        ![
          'avatar_products',
          'avatar_combinations',
          'avatar_combination_items',
        ].includes(name),
    ))
      expect(
        (await client.query(`SELECT * FROM "${table}" ORDER BY 1,2`)).rows,
        table,
      ).toEqual(before.get(table));
    for (const combination of oldCombinations)
      expect(
        await database.avatarCombination.findUnique({
          where: { id: combination.id },
        }),
      ).toEqual(combination);
    for (const item of oldItems)
      expect(
        await database.avatarCombinationItem.findUnique({
          where: {
            combinationId_productId: {
              combinationId: item.combinationId,
              productId: item.productId,
            },
          },
        }),
      ).toEqual(item);
    for (const product of oldProducts) {
      const current = await database.avatarProduct.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(current).toMatchObject({
        id: product.id,
        kind: product.kind,
        renderKey: product.renderKey,
        ownershipScope: product.ownershipScope,
        occupiesSlots: product.occupiesSlots,
      });
      if (product.saleStatus === 'on_sale')
        expect(current.catalogRevision).toBe(product.catalogRevision + 1);
      else expect(current).toEqual(product);
    }
    expect(await database.avatarProduct.count()).toBe(20);
    expect(await database.avatarCombination.count()).toBe(36);
    expect(
      await database.avatarProduct.findUnique({
        where: { id: 'pose.passion' },
      }),
    ).toMatchObject({
      price: 70,
      priceProvisional: false,
    });
    expect(
      await database.avatarProduct.findUnique({ where: { id: 'pose.a-plus' } }),
    ).toMatchObject({
      saleStatus: 'retired',
      price: null,
      priceProvisional: false,
    });
    expect(await shop.outfit(user.id)).toEqual(outfit);
    expect(await shop.inventory(user.id)).toEqual(inventory);
    expect(await rewards.receipt(user.id, routine.id)).toEqual(receipt);
    expect(inventory.currency.balance).toBe(81);
    expect(
      (
        await database.avatarPurchase.findMany({ where: { userId: user.id } })
      ).map((row) => row.price),
    ).toEqual([60, 60]);
    // Successful historical keys still replay even after retirement.
    expect(
      await shop.purchase(user.id, purchaseKey, {
        productId: aPlus.id,
        catalogRevision: aPlus.catalogRevision,
      }),
    ).toMatchObject({
      replayed: true,
      purchase: { price: 60 },
      currency: { balance: 81 },
    });
  } finally {
    await db?.onModuleDestroy();
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}, 30_000);
