import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';

it('migrates legacy capacities without deleting members and restores admission constraints', async () => {
  // The runner supplies an isolated test database URL; never use the development URL.
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Test environment required.');
  const schema = `capacity_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const root = new URL('../prisma/migrations/', import.meta.url);
    const migration = '20261002000100_group_capacity_five';
    for (const name of (await readdir(root)).sort()) {
      if (name >= migration) break;
      const sql = await readFile(
        new URL(`${name}/migration.sql`, root),
        'utf8',
      );
      await client.query(sql);
    }
    const users = Array.from({ length: 7 }, () => randomUUID());
    for (const id of users)
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [
        id,
        `${id}@example.test`,
      ]);
    const large = randomUUID(),
      small = randomUUID();
    await client.query('BEGIN');
    for (const [id, max] of [
      [large, 100],
      [small, 2],
    ] as const) {
      await client.query(
        'INSERT INTO groups (id, name, description, max_members, leader_user_id, invite_code) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          id,
          '[TEST ONLY]',
          '',
          max,
          users[0],
          id.replaceAll('-', '') + 'a'.repeat(11),
        ],
      );
      for (const user of id === large ? users.slice(0, 6) : users.slice(0, 1))
        await client.query(
          'INSERT INTO group_memberships (group_id, user_id) VALUES ($1, $2)',
          [id, user],
        );
    }
    await client.query('COMMIT');
    await client.query(
      await readFile(new URL(`${migration}/migration.sql`, root), 'utf8'),
    );
    const result = await client.query<{ max_members: number; members: number }>(
      'SELECT max_members, (SELECT count(*)::int FROM group_memberships WHERE group_id = groups.id) AS members FROM groups WHERE id = $1',
      [large],
    );
    expect(result.rows).toEqual([{ max_members: 5, members: 6 }]);
    expect(
      (
        await client.query('SELECT max_members FROM groups WHERE id = $1', [
          small,
        ])
      ).rows,
    ).toEqual([{ max_members: 2 }]);
    await expect(
      client.query('UPDATE groups SET max_members = 6 WHERE id = $1', [large]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query(
        'INSERT INTO group_memberships (group_id, user_id) VALUES ($1, $2)',
        [large, users[6]],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await client.query(
      'DELETE FROM group_memberships WHERE group_id = $1 AND user_id = ANY($2::uuid[])',
      [large, users.slice(4, 6)],
    );
    await client.query(
      'INSERT INTO group_memberships (group_id, user_id) VALUES ($1, $2)',
      [large, users[6]],
    );
    await expect(
      client.query('UPDATE groups SET max_members = 4 WHERE id = $1', [large]),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
