import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { UserProfileService } from '../src/users/user-profile.service.js';

it('upgrades populated schemas, removes retired profile data and preserves credentials, measurements and account relations', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  // Only the isolated runner can opt into creating this additional test schema.
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('An isolated test schema is required.');
  const schema = `test_upgrade_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  let database: DatabaseService | undefined;
  let created = false;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    const migrationRoot = new URL('../prisma/migrations/', import.meta.url);
    const extension = '20260921000100_user_features';
    const directories = (await readdir(migrationRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of directories.filter((name) => name < extension))
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, migrationRoot), 'utf8'),
      );
    const owner = randomUUID();
    const emptyUser = randomUUID();
    const measurementId = randomUUID();
    const sessionId = randomUUID();
    const key = randomUUID();
    await client.query(
      'INSERT INTO users(id, email, password) VALUES ($1, $2, $3), ($4, $5, NULL)',
      [
        owner,
        `legacy-${owner}@example.test`,
        '$argon2id$legacy-test-fixture',
        emptyUser,
        `legacy-${emptyUser}@example.test`,
      ],
    );
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO measurements(id, user_id, measured_on, age_at_measurement, catalog_version) VALUES ($1, $2, '2026-09-17', 25, 'nfa100-2026-09-19')",
      [measurementId, owner],
    );
    await client.query(
      "INSERT INTO measurement_items(measurement_id, catalog_version, code, value, unit) VALUES ($1, 'nfa100-2026-09-19', 'reaction_time', '0.301234567890123456789', '초')",
      [measurementId],
    );
    await client.query('COMMIT');
    await client.query(
      "INSERT INTO measurement_create_requests(user_id, key, request_hash, measurement_id) VALUES ($1, $2, repeat('a', 64), $3)",
      [owner, key, measurementId],
    );
    await client.query(
      "INSERT INTO auth_sessions(id, user_id, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + interval '7 days')",
      [sessionId, owner],
    );
    await client.query(
      "INSERT INTO auth_refresh_tokens(token_hash, session_id) VALUES (repeat('b', 64), $1)",
      [sessionId],
    );
    let accountBefore = (await client.query('SELECT * FROM users ORDER BY id'))
      .rows as unknown[];
    const measurementBefore = (await client.query('SELECT * FROM measurements'))
      .rows as unknown[];
    const itemsBefore = (await client.query('SELECT * FROM measurement_items'))
      .rows as Record<string, unknown>[];
    const sessionsBefore = (await client.query('SELECT * FROM auth_sessions'))
      .rows as unknown[];
    let assignmentsBefore: unknown[] = [];
    for (const name of directories.filter((name) => name >= extension)) {
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, migrationRoot), 'utf8'),
      );
      if (name === extension) {
        // Represent a database that already used the now-retired first version.
        expect(
          (await client.query('SELECT balance FROM user_currencies')).rows,
        ).toEqual([{ balance: 0 }, { balance: 0 }]);
        await client.query(
          "UPDATE users SET preferred_exercises = ARRAY['수영'], exercise_goals = ARRAY['체력 유지'] WHERE id = $1",
          [owner],
        );
        await client.query(
          "INSERT INTO user_fitness_goals(user_id, catalog_version, code, value, unit) VALUES ($1, 'nfa100-2026-09-19', 'height', '170', 'cm')",
          [owner],
        );
        await client.query(
          'UPDATE user_currencies SET balance = 123 WHERE user_id = $1',
          [owner],
        );
        const curriculumId = randomUUID();
        await client.query(
          "INSERT INTO workout_curricula(id, name) VALUES ($1, '[TEST ONLY] retained workout')",
          [curriculumId],
        );
        await client.query(
          'INSERT INTO user_curriculum_assignments(user_id, curriculum_id, request_key, current_for_user_id) VALUES ($1, $2, $3, $1)',
          [owner, curriculumId, randomUUID()],
        );
        accountBefore = (
          await client.query(
            'SELECT id, email, password, created_at, updated_at FROM users ORDER BY id',
          )
        ).rows as unknown[];
        assignmentsBefore = (
          await client.query('SELECT * FROM user_curriculum_assignments')
        ).rows as unknown[];
      }
    }
    expect(
      (
        await client.query(
          'SELECT id, email, password, created_at, updated_at FROM users ORDER BY id',
        )
      ).rows,
    ).toEqual(accountBefore);
    expect((await client.query('SELECT * FROM measurements')).rows).toEqual(
      measurementBefore,
    );
    expect(
      (await client.query('SELECT * FROM measurement_items')).rows,
    ).toEqual(itemsBefore.map((item) => ({ ...item, evaluation: null })));
    expect((await client.query('SELECT * FROM auth_sessions')).rows).toEqual(
      sessionsBefore,
    );
    expect(
      (await client.query('SELECT * FROM auth_refresh_tokens')).rowCount,
    ).toBe(1);
    expect(
      (await client.query('SELECT * FROM measurement_create_requests'))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await client.query(
          'SELECT user_id, balance FROM user_currencies ORDER BY user_id',
        )
      ).rows,
    ).toEqual(
      [owner, emptyUser]
        .sort()
        .map((user_id) => ({ user_id, balance: user_id === owner ? 123 : 0 })),
    );
    url.searchParams.set('schema', schema);
    database = new DatabaseService(
      new ConfigService({ DATABASE_URL: url.toString() }),
    );
    await database.onModuleInit();
    const profiles = new UserProfileService(database);
    const profile = await profiles.get(owner);
    expect(profile).toMatchObject({
      id: owner,
      currency: { balance: 123 },
      isOnboarded: true,
      currentCurriculum: { status: 'assigned' },
    });
    for (const field of [
      'preferredExercises',
      'exerciseGoals',
      'currentFitness',
      'fitnessGoals',
    ])
      expect(profile).not.toHaveProperty(field);
    expect(await profiles.get(emptyUser)).toMatchObject({
      isOnboarded: false,
      currency: { balance: 0 },
    });
    expect(
      (await client.query('SELECT * FROM user_curriculum_assignments')).rows,
    ).toEqual(
      assignmentsBefore.map((row) => ({
        ...(row as Record<string, unknown>),
        assignment_date: null,
        superseded_at: null,
        algorithm_version: null,
        input_snapshot: null,
        intervals: [],
        position_seconds: 0,
        revision: 1,
        result_status: null,
        performed_at: null,
      })),
    );
    expect(await database.workoutCurriculum.count()).toBe(1);
    expect(
      (
        await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'user_fitness_goals'",
          [schema],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users' ORDER BY column_name",
          [schema],
        )
      ).rows.map((row: { column_name: string }) => row.column_name),
    ).toEqual([
      'created_at',
      'date_of_birth',
      'email',
      'id',
      'password',
      'updated_at',
    ]);
    expect(
      (await client.query('SELECT date_of_birth FROM users ORDER BY id')).rows,
    ).toEqual([{ date_of_birth: null }, { date_of_birth: null }]);
    await database.measurement.delete({ where: { id: measurementId } });
    expect(await profiles.get(owner)).toMatchObject({ isOnboarded: false });
  } finally {
    await database?.onModuleDestroy();
    // Clear a failed transaction before removing only this test's own schema.
    await client.query('ROLLBACK');
    if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
}, 30_000);
