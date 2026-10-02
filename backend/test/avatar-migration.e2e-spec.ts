import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { AvatarService } from '../src/avatar/avatar.service.js';

it('backfills existing users and repairs defaults without resetting purchases, funds or outfits', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('An isolated test schema is required.');
  const schema = `test_avatar_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  let db: DatabaseService | undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const root = new URL('../prisma/migrations/', import.meta.url);
    const migrationName = '20260930000300_avatar_shop';
    for (const name of (await readdir(root))
      .filter((name) => name < migrationName && /^\d/.test(name))
      .sort())
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
      );
    const owner = randomUUID();
    const other = randomUUID();
    const session = randomUUID();
    await client.query(
      "INSERT INTO users(id,email,password,nickname,created_at,updated_at) VALUES ($1,$2,'legacy-hash','기존사용자','2020-01-01','2020-01-02'),($3,$4,NULL,NULL,'2020-01-01','2020-01-02')",
      [
        owner,
        `legacy-${owner}@example.test`,
        other,
        `legacy-${other}@example.test`,
      ],
    );
    await client.query(
      'INSERT INTO user_currencies(user_id,balance) VALUES ($1,123),($2,0)',
      [owner, other],
    );
    await client.query(
      'INSERT INTO user_preferences(user_id) VALUES ($1),($2)',
      [owner, other],
    );
    await client.query(
      "INSERT INTO auth_sessions(id,user_id,expires_at) VALUES ($1,$2,'2030-01-01')",
      [session, owner],
    );
    const tables = [
      'users',
      'user_currencies',
      'user_preferences',
      'auth_sessions',
    ];
    const before: unknown[][] = [];
    for (const table of tables)
      before.push(
        (await client.query(`SELECT * FROM ${table} ORDER BY 1`))
          .rows as unknown[],
      );
    await client.query(
      await readFile(new URL(`${migrationName}/migration.sql`, root), 'utf8'),
    );
    for (const [i, table] of tables.entries())
      expect(
        (await client.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      ).toEqual(before[i]);
    // The current service needs the additive batch schema; old defaults stay intact.
    await client.query(
      await readFile(
        new URL('20261002001000_avatar_purchase_batches/migration.sql', root),
        'utf8',
      ),
    );
    url.searchParams.set('schema', schema);
    db = new DatabaseService(
      new ConfigService({ DATABASE_URL: url.toString() }),
    );
    await db.onModuleInit();
    const service = new AvatarService(db);
    for (const userId of [owner, other]) {
      expect(
        (await service.inventory(userId)).inventory.map((item) => [
          item.productId,
          item.source,
        ]),
      ).toEqual([
        ['character.cream', 'default'],
        ['character.gray', 'default'],
        ['pose.basic', 'default'],
      ]);
      expect(await service.outfit(userId)).toMatchObject({
        characterId: 'character.cream',
        poseId: 'pose.basic',
        clothingIds: [],
        revision: 1,
      });
    }
    // Explicitly confirm the legacy fixture price before exercising purchases.
    const run = await db.avatarProduct.update({
      where: { id: 'pose.run' },
      data: { priceProvisional: false },
    });
    await service.purchase(owner, randomUUID(), {
      productId: 'pose.run',
      catalogRevision: run.catalogRevision,
    });
    await service.saveOutfit(owner, 1, {
      characterId: 'character.gray',
      poseId: 'pose.run',
      clothingIds: [],
    });
    const snapshot = await service.inventory(owner);
    const outfit = await service.outfit(owner);
    const purchases = await db.avatarPurchase.findMany({
      where: { userId: owner },
    });
    const ledger = await db.currencyTransaction.findMany({
      where: { userId: owner },
    });
    await client.query('SELECT initialize_avatar(id) FROM users');
    await client.query('SELECT initialize_avatar(id) FROM users');
    expect(await service.inventory(owner)).toEqual(snapshot);
    expect(await service.outfit(owner)).toEqual(outfit);
    expect(
      await db.avatarPurchase.findMany({ where: { userId: owner } }),
    ).toEqual(purchases);
    expect(
      await db.currencyTransaction.findMany({ where: { userId: owner } }),
    ).toEqual(ledger);
    expect((await client.query('SELECT * FROM users ORDER BY 1')).rows).toEqual(
      before[0],
    );
    const overlapping = randomUUID();
    await client.query('INSERT INTO users(id,email) VALUES ($1,$2)', [
      overlapping,
      `${overlapping}@example.test`,
    ]);
    expect(
      await db.avatarOwnership.count({ where: { userId: overlapping } }),
    ).toBe(3);
    expect(await service.outfit(overlapping)).toMatchObject({
      characterId: 'character.cream',
      revision: 1,
    });
    expect(
      await db.userCurrency.findUnique({ where: { userId: overlapping } }),
    ).toBeNull();
    await client.query('BEGIN');
    const rolledBack = randomUUID();
    await client.query('INSERT INTO users(id,email) VALUES ($1,$2)', [
      rolledBack,
      `${rolledBack}@example.test`,
    ]);
    await client.query('ROLLBACK');
    expect(
      await db.avatarOwnership.count({ where: { userId: rolledBack } }),
    ).toBe(0);
    await expect(
      client.query(
        "UPDATE avatar_products SET render_key='different' WHERE id='pose.run'",
      ),
    ).rejects.toThrow();
    await expect(
      client.query(
        "UPDATE avatar_combinations SET pose_id='pose.basic' WHERE id=$1",
        [JSON.stringify(['character.gray', 'pose.run', []])],
      ),
    ).rejects.toThrow();
    await expect(
      client.query('UPDATE user_currencies SET balance=-1 WHERE user_id=$1', [
        owner,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query(
        "INSERT INTO avatar_ownerships(user_id,product_id,source) VALUES ($1,'pose.run','purchase')",
        [owner],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await client.query('DELETE FROM users WHERE id=$1', [owner]);
    for (const table of [
      'avatar_ownerships',
      'avatar_outfits',
      'avatar_purchases',
      'currency_transactions',
    ])
      expect(
        (await client.query(`SELECT * FROM ${table} WHERE user_id=$1`, [owner]))
          .rows,
      ).toEqual([]);
    expect(await db.avatarProduct.count()).toBe(15);
    expect(await db.avatarOwnership.count({ where: { userId: other } })).toBe(
      3,
    );
  } finally {
    await db?.onModuleDestroy();
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}, 30_000);
