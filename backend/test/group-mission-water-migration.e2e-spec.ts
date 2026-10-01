import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import {
  roulettePolicy,
  MISSION_POLICY_VERSION,
} from '../src/groups/mission-policy.js';

it('preserves historical multi-group contributions and balances without backfilling or reclaiming rewards', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('Isolated test schema required');
  const schema = `test_water_upgrade_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const root = new URL('../prisma/migrations/', import.meta.url);
    const target = '20261002000200_single_group_water';
    for (const name of (await readdir(root))
      .filter((n) => /^\d/.test(n) && n < target)
      .sort())
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
      );
    await client.query('BEGIN');
    const owner = randomUUID(),
      member = randomUUID(),
      achievement = randomUUID();
    await client.query('INSERT INTO users(id,email) VALUES ($1,$2),($3,$4)', [
      owner,
      `${owner}@example.test`,
      member,
      `${member}@example.test`,
    ]);
    await client.query(
      'INSERT INTO user_currencies(user_id,balance) VALUES ($1,53),($2,0)',
      [owner, member],
    );
    await client.query(
      "INSERT INTO currency_transactions(user_id,event_key,amount,balance_after,kind) VALUES ($1,'test:existing',53,53,'grant')",
      [owner],
    );
    await client.query(
      "INSERT INTO activity_achievements(id,user_id,korean_date,achieved_at,source_kind,source_id) VALUES ($1,$2,'2026-10-01','2026-10-01T01:00:00Z','routine',$3)",
      [achievement, owner, randomUUID()],
    );
    for (let i = 0; i < 2; i++) {
      const group = randomUUID(),
        round = randomUUID(),
        participant = randomUUID();
      await client.query(
        "INSERT INTO groups(id,name,description,max_members,leader_user_id,invite_code) VALUES ($1,$2,'',5,$3,$4)",
        [group, `[TEST ONLY] historical ${i}`, owner, `${i}${'x'.repeat(42)}`],
      );
      await client.query(
        'INSERT INTO group_memberships(group_id,user_id) VALUES ($1,$2),($1,$3)',
        [group, owner, member],
      );
      await client.query(
        "INSERT INTO group_mission_rounds(id,group_id,member_count,total_target,water_count,started_at,policy_version,roulette_policy) VALUES ($1,$2,2,28,1,'2026-10-01T00:00:00Z',$3,$4)",
        [round, group, MISSION_POLICY_VERSION, JSON.stringify(roulettePolicy)],
      );
      await client.query(
        'INSERT INTO group_mission_participants(id,round_id,user_id,water_count) VALUES ($1,$2,$3,1)',
        [participant, round, owner],
      );
      await client.query(
        "INSERT INTO group_mission_contributions(group_id,round_id,participant_id,achievement_id,contributed_at) VALUES ($1,$2,$3,$4,'2026-10-01T01:00:00Z')",
        [group, round, participant, achievement],
      );
    }
    await client.query('COMMIT');
    const tables = [
      'users',
      'user_currencies',
      'currency_transactions',
      'groups',
      'group_memberships',
      'activity_achievements',
      'group_mission_rounds',
      'group_mission_participants',
      'group_roulette_tickets',
    ];
    const before = new Map<string, unknown[]>();
    for (const table of tables)
      before.set(
        table,
        (await client.query(`SELECT * FROM ${table} ORDER BY 1`))
          .rows as unknown[],
      );
    const ledger = (
      await client.query<Record<string, unknown>>(
        'SELECT * FROM group_mission_contributions ORDER BY id',
      )
    ).rows;
    await client.query(
      await readFile(new URL(`${target}/migration.sql`, root), 'utf8'),
    );
    for (const table of tables)
      expect(
        (await client.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      ).toEqual(before.get(table));
    expect(
      (
        await client.query(
          'SELECT * FROM group_mission_contributions ORDER BY id',
        )
      ).rows,
    ).toEqual(ledger.map((row) => ({ ...row, water_choice_id: null })));
    expect(
      (await client.query('SELECT count(*) FROM group_mission_water_choices'))
        .rows,
    ).toEqual([{ count: '0' }]);
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}, 30000);
