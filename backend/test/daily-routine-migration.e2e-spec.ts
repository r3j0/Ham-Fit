import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';

it('upgrades populated next-day routines without changing snapshots, events, keys or progress', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('An isolated test database is required.');
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  const schema = `test_daily_${randomUUID().replaceAll('-', '')}`;
  const root = new URL('../prisma/migrations/', import.meta.url);
  const target = '20260929000500_daily_routine_requests';
  let created = false;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    const migrations = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const name of migrations.filter((name) => name < target))
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
      );
    const userId = randomUUID();
    await client.query(
      'INSERT INTO users(id, email, password) VALUES ($1, $2, NULL)',
      [userId, `daily-${userId}@example.test`],
    );
    const insert = async (
      date: string,
      reference: string,
      adjustment: object | null,
    ) => {
      const id = randomUUID();
      const item = randomUUID();
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO workout_routines(id,user_id,assignment_date,reference_date,algorithm_version,data_version,estimated_minutes,input_snapshot,weight_adjustment)
          VALUES ($1,$2,$3,$4,'test-only','test-only',2,'{}',$5)`,
          [id, userId, date, reference, adjustment],
        );
        await client.query(
          `INSERT INTO workout_routine_items(id,routine_id,"order",video_id,title,video_url,duration_seconds,slot,prescription,status,intervals,position_seconds,revision,result_status,performed_at)
          VALUES ($1,$2,1,'TEST.mp4','[TEST ONLY]','http://openapi.kspo.or.kr/web/video/TEST.mp4',100,'strength_group','{}','interrupted','[{"start":0,"end":60}]',60,2,'interrupted','2026-09-29T01:00:00Z')`,
          [item, id],
        );
        await client.query(
          'INSERT INTO workout_routine_requests(user_id,key,routine_id) VALUES ($1,$2,$3)',
          [userId, randomUUID(), id],
        );
        await client.query(
          `INSERT INTO workout_routine_events(item_id,key,request_hash,device_id,sequence,type,intervals,position_seconds,received_at,resulting_revision)
          VALUES ($1,$2,$3,$4,1,'end','[{"start":0,"end":60}]',60,'2026-09-29T01:00:00Z',2)`,
          [item, randomUUID(), 'a'.repeat(64), randomUUID()],
        );
        await client.query('COMMIT');
        return id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    };
    const legacy = await insert('2026-09-30', '2026-09-29', { legacy: true });
    const tables = [
      'users',
      'workout_routines',
      'workout_routine_items',
      'workout_routine_requests',
      'workout_routine_events',
    ];
    const before: unknown[][] = [];
    for (const table of tables)
      before.push(
        (await client.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      );
    await client.query(
      await readFile(new URL(`${target}/migration.sql`, root), 'utf8'),
    );
    for (const [index, table] of tables.entries())
      expect(
        (await client.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      ).toEqual(before[index]);
    await insert('2026-10-01', '2026-10-01', null);
    // Daily uniqueness is retained. Historical dates and completed definitions remain immutable.
    await expect(
      insert('2026-10-01', '2026-10-01', null),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insert('2026-10-03', '2026-10-02', null),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query(
        'UPDATE workout_routines SET reference_date=assignment_date WHERE id=$1',
        [legacy],
      ),
    ).rejects.toThrow();
  } finally {
    await client.query('ROLLBACK');
    if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
});
