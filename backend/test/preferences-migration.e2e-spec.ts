import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { UserPreferencesService } from '../src/users/user-preferences.service.js';

const preferenceMigration = '20260926000100_user_preferences';
const migrationRoot = new URL('../prisma/migrations/', import.meta.url);

async function migrations() {
  const directories = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(directories).toContain(preferenceMigration);
  return Promise.all(
    directories.map(async (name) => ({
      name,
      sql: await readFile(
        new URL(`${name}/migration.sql`, migrationRoot),
        'utf8',
      ),
    })),
  );
}

async function withIsolatedSchema(
  run: (client: pg.Client, databaseUrl: string) => Promise<void>,
) {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('An isolated test schema is required.');
  const schema = `test_preferences_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  let created = false;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    url.searchParams.set('schema', schema);
    await run(client, url.toString());
  } finally {
    await client.query('ROLLBACK');
    if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
}

async function databaseTime(client: pg.Client) {
  return (
    await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')
  ).rows[0].now.getTime();
}

type PreferenceRow = {
  user_id: string;
  exercise_volume: string;
  exercise_goal: string | null;
  created_at: Date;
  updated_at: Date;
};

async function preferences(client: pg.Client) {
  return (
    await client.query<PreferenceRow>(
      'SELECT * FROM user_preferences ORDER BY user_id',
    )
  ).rows;
}

it('backfills populated accounts without inferring goals and preserves saved preferences during deployment repair', async () => {
  await withIsolatedSchema(async (client, databaseUrl) => {
    const committed = await migrations();
    for (const migration of committed.filter(
      ({ name }) => name < preferenceMigration,
    ))
      await client.query(migration.sql);

    const owner = randomUUID();
    const emptyUser = randomUUID();
    const measurement = randomUUID();
    const curriculum = randomUUID();
    await client.query(
      `INSERT INTO users(id, email, password, created_at, updated_at)
       VALUES ($1, $2, '$argon2id$legacy-test-fixture', '2020-01-01', '2020-01-02'),
              ($3, $4, NULL, '2020-01-01', '2020-01-02')`,
      [
        owner,
        `legacy-${owner}@example.test`,
        emptyUser,
        `legacy-${emptyUser}@example.test`,
      ],
    );
    await client.query(
      'INSERT INTO user_currencies(user_id, balance) VALUES ($1, 123), ($2, 0)',
      [owner, emptyUser],
    );
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO measurements(id, user_id, measured_on, age_at_measurement, catalog_version, reported_overall_grade)
       VALUES ($1, $2, '2026-09-17', 25, 'nfa100-2026-09-24', '3등급')`,
      [measurement, owner],
    );
    await client.query(
      `INSERT INTO measurement_items(measurement_id, catalog_version, code, value, unit, reported_grade)
       VALUES ($1, 'nfa100-2026-09-24', 'body_fat_percentage', '30.1', '%', '3등급')`,
      [measurement],
    );
    await client.query('COMMIT');
    await client.query(
      "INSERT INTO workout_curricula(id, name) VALUES ($1, '[TEST ONLY] body composition workout')",
      [curriculum],
    );
    await client.query(
      `INSERT INTO user_curriculum_assignments(user_id, curriculum_id, request_key, current_for_user_id, status, assigned_at, completed_at)
       VALUES ($1, $2, $3, $1, 'completed', '2026-09-17', '2026-09-18')`,
      [owner, curriculum, randomUUID()],
    );
    const unchangedTables = [
      'users',
      'user_currencies',
      'measurements',
      'measurement_items',
      'workout_curricula',
      'user_curriculum_assignments',
    ] as const;
    const snapshots: Array<{ table: string; rows: unknown[] }> = [];
    for (const table of unchangedTables)
      snapshots.push({
        table,
        rows: (await client.query(`SELECT * FROM ${table} ORDER BY 1`))
          .rows as unknown[],
      });
    const beforeMigration = await databaseTime(client);
    for (const migration of committed.filter(
      ({ name }) => name >= preferenceMigration,
    ))
      await client.query(migration.sql);
    const afterMigration = await databaseTime(client);
    const initialized = await preferences(client);
    expect(initialized).toHaveLength(2);
    for (const row of initialized) {
      expect(row.exercise_volume).toBe('standard');
      expect(row.exercise_goal).toBeNull();
      for (const timestamp of [row.created_at, row.updated_at]) {
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeMigration);
        expect(timestamp.getTime()).toBeLessThanOrEqual(afterMigration);
      }
    }
    for (const snapshot of snapshots)
      expect(
        (await client.query(`SELECT * FROM ${snapshot.table} ORDER BY 1`)).rows,
      ).toEqual(snapshot.rows);

    const database = new DatabaseService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    await database.onModuleInit();
    try {
      expect(
        await database.$queryRaw<Array<{ timezone: string }>>`
          SELECT current_setting('TimeZone') AS timezone
        `,
      ).toEqual([{ timezone: 'UTC' }]);
      const service = new UserPreferencesService(database);
      for (const row of initialized)
        expect(await service.get(row.user_id)).toEqual({
          exerciseVolume: 'standard',
          exerciseGoal: null,
          updatedAt: row.updated_at.toISOString(),
        });

      await client.query(
        `UPDATE user_preferences SET exercise_volume = 'more',
         exercise_goal = 'body_composition_management', updated_at = clock_timestamp()
         WHERE user_id = $1`,
        [owner],
      );
      const saved = await preferences(client);
      // Simulate an old application instance creating an account after migration.
      const overlapUser = randomUUID();
      await client.query(
        "INSERT INTO users(id, email, created_at, updated_at) VALUES ($1, $2, '2020-01-01', '2020-01-02')",
        [overlapUser, `overlap-${overlapUser}@example.test`],
      );
      expect(
        await database.userPreference.findUnique({
          where: { userId: overlapUser },
        }),
      ).toBeNull();
      // Reuse the actual migration's repeatable INSERT, not a test-only copy.
      const backfill = committed
        .find(({ name }) => name === preferenceMigration)!
        .sql.match(/INSERT INTO user_preferences\s*\(user_id\)[\s\S]*?;/g);
      expect(backfill).toHaveLength(1);
      const beforeRepair = await databaseTime(client);
      await client.query(backfill![0]);
      const afterRepair = await databaseTime(client);
      const repaired = await preferences(client);
      expect(repaired.filter((row) => row.user_id !== overlapUser)).toEqual(
        saved,
      );
      const repairedRow = repaired.find((row) => row.user_id === overlapUser)!;
      for (const timestamp of [
        repairedRow.created_at,
        repairedRow.updated_at,
      ]) {
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeRepair);
        expect(timestamp.getTime()).toBeLessThanOrEqual(afterRepair);
      }
      expect(await service.get(overlapUser)).toEqual({
        exerciseVolume: 'standard',
        exerciseGoal: null,
        updatedAt: repairedRow.updated_at.toISOString(),
      });
      expect(await service.get(owner)).toEqual({
        exerciseVolume: 'more',
        exerciseGoal: 'body_composition_management',
        updatedAt: saved
          .find((row) => row.user_id === owner)!
          .updated_at.toISOString(),
      });
      await client.query(backfill![0]);
      expect(await preferences(client)).toEqual(repaired);
    } finally {
      await database.onModuleDestroy();
    }
  });
}, 30_000);

it('enforces preference ownership, uniqueness, enum and nullability constraints in PostgreSQL', async () => {
  await withIsolatedSchema(async (client) => {
    for (const migration of await migrations())
      await client.query(migration.sql);
    const user = randomUUID();
    await client.query('INSERT INTO users(id, email) VALUES ($1, $2)', [
      user,
      `constraints-${user}@example.test`,
    ]);
    await expect(
      client.query('INSERT INTO user_preferences(user_id) VALUES (NULL)'),
    ).rejects.toMatchObject({ code: '23502' });
    await expect(
      client.query('INSERT INTO user_preferences(user_id) VALUES ($1)', [
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    await client.query('INSERT INTO user_preferences(user_id) VALUES ($1)', [
      user,
    ]);
    expect((await preferences(client))[0]).toMatchObject({
      user_id: user,
      exercise_volume: 'standard',
      exercise_goal: null,
    });
    await expect(
      client.query('INSERT INTO user_preferences(user_id) VALUES ($1)', [user]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      client.query('UPDATE user_preferences SET exercise_volume = NULL'),
    ).rejects.toMatchObject({ code: '23502' });
    for (const [column, invalidValue] of [
      ['exercise_volume', 'invalid'],
      ['exercise_volume', ''],
      ['exercise_goal', 'invalid'],
      ['exercise_goal', ''],
    ])
      await expect(
        client.query(`UPDATE user_preferences SET ${column} = $1`, [
          invalidValue,
        ]),
      ).rejects.toMatchObject({ code: '22P02' });
    for (const column of ['created_at', 'updated_at'])
      await expect(
        client.query(`UPDATE user_preferences SET ${column} = NULL`),
      ).rejects.toMatchObject({ code: '23502' });
    expect((await preferences(client))[0]).toMatchObject({
      exercise_volume: 'standard',
      exercise_goal: null,
    });
    await client.query('DELETE FROM users WHERE id = $1', [user]);
    expect(await preferences(client)).toEqual([]);
  });
}, 30_000);
