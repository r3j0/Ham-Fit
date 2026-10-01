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

it('migrates existing groups/workout/currency records without backfill or changes', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('An isolated test database/schema is required.');
  const schema = `test_missions_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  let db: DatabaseService | undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const root = new URL('../prisma/migrations/', import.meta.url);
    const migration = '20260930000400_group_missions';
    for (const name of (await readdir(root))
      .filter((name) => /^\d/.test(name) && name < migration)
      .sort())
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
      );
    const owner = randomUUID();
    const member = randomUUID();
    const groupId = randomUUID();
    const curriculum = randomUUID();
    const assignment = randomUUID();
    await client.query('BEGIN');
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
      "INSERT INTO groups(id,name,description,max_members,leader_user_id,invite_code) VALUES ($1,'기존 그룹','기존 소개',5,$2,$3)",
      [groupId, owner, 'x'.repeat(43)],
    );
    await client.query(
      'INSERT INTO group_memberships(group_id,user_id) VALUES ($1,$2),($1,$3)',
      [groupId, owner, member],
    );
    await client.query(
      "INSERT INTO workout_curricula(id,name) VALUES ($1,'기존 배정')",
      [curriculum],
    );
    await client.query(
      "INSERT INTO user_curriculum_assignments(id,user_id,curriculum_id,request_key,status,assigned_at,completed_at,assignment_date,algorithm_version,input_snapshot,result_status,performed_at) VALUES ($1,$2,$3,$4,'completed','2026-09-30T00:00:00Z','2026-09-30T01:00:00Z','2026-09-30','test-only','{}','completed','2026-09-30T01:00:00Z')",
      [assignment, owner, curriculum, randomUUID()],
    );
    await client.query('COMMIT');
    const tables = [
      'users',
      'groups',
      'group_memberships',
      'user_curriculum_assignments',
      'user_currencies',
      'currency_transactions',
      'avatar_ownerships',
      'avatar_outfits',
    ];
    const before: unknown[][] = [];
    for (const table of tables)
      before.push(
        (await client.query(`SELECT * FROM ${table} ORDER BY 1,2`))
          .rows as unknown[],
      );
    await client.query(
      await readFile(new URL(`${migration}/migration.sql`, root), 'utf8'),
    );
    for (const [i, table] of tables.entries())
      expect(
        (await client.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows,
      ).toEqual(before[i]);
    for (const table of [
      'activity_achievements',
      'group_mission_rounds',
      'group_mission_contributions',
      'group_roulette_tickets',
      'group_roulette_draws',
    ])
      expect(
        (await client.query(`SELECT count(*) FROM ${table}`)).rows,
      ).toEqual([{ count: '0' }]);
    url.searchParams.set('schema', schema);
    db = new DatabaseService(
      new ConfigService({ DATABASE_URL: url.toString() }),
    );
    await db.onModuleInit();
    const groups = new GroupsService(db);
    const shop = new AvatarService(db);
    const missions = new GroupMissionsService(
      db,
      shop,
      () => new Date('2026-09-30T02:00:00Z'),
    );
    const round = await missions.start(owner, groupId, randomUUID());
    expect(round.mission).toMatchObject({
      memberCount: 2,
      totalTarget: 28,
      waterCount: 0,
    });
    await groups.leave(member, groupId);
    expect(await missions.current(owner, groupId)).toMatchObject({
      memberCount: 2,
      waterCount: 0,
      status: 'in_progress',
    });
    await groups.delete(owner, groupId);
    expect(
      await db.userCurriculumAssignment.findUnique({
        where: { id: assignment },
      }),
    ).not.toBeNull();
    expect((await shop.inventory(owner)).currency.balance).toBe(53);
    expect(
      await db.currencyTransaction.count({ where: { userId: owner } }),
    ).toBe(1);
  } finally {
    await db?.onModuleDestroy();
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}, 30_000);
