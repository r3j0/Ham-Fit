import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';

describe('Account schema', () => {
  let database: DatabaseService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    database = new DatabaseService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await database.onModuleInit();
  });

  afterAll(async () => {
    await database.user.deleteMany({ where: { id: { in: createdIds } } });
    await database.onModuleDestroy();
  });

  it('keeps credential fields, timestamps and the explicit nullable birth date', async () => {
    const schema = new URL(process.env.DATABASE_URL!).searchParams.get(
      'schema',
    )!;
    const columns = await database.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = 'users'
    `;
    expect(columns.map((column) => column.column_name).sort()).toEqual([
      'created_at',
      'date_of_birth',
      'email',
      'id',
      'nickname',
      'password',
      'updated_at',
    ]);
  });

  it('stores a real login email without inventing a password for a social-only account', async () => {
    const email = `account-${randomUUID()}@example.test`;
    const user = await database.user.create({ data: { email } });
    createdIds.push(user.id);
    expect(user.email).toBe(email);
    expect(user.password).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
    await expect(database.user.create({ data: { email } })).rejects.toThrow();
  });

  it('rejects blank and non-normalized login emails at the database boundary', async () => {
    for (const email of [
      '',
      'NOT_NORMALIZED@example.test',
      ' user@example.test ',
      'not-an-email',
    ]) {
      await expect(database.user.create({ data: { email } })).rejects.toThrow();
    }
  });

  it('updates the timestamp without changing the user ID or creation time', async () => {
    const user = await database.user.create({
      data: { email: `before-${randomUUID()}@example.test` },
    });
    createdIds.push(user.id);
    const changed = await database.user.update({
      where: { id: user.id },
      data: { email: `after-${randomUUID()}@example.test` },
    });
    expect(changed.id).toBe(user.id);
    expect(changed.createdAt).toEqual(user.createdAt);
    expect(changed.updatedAt.getTime()).toBeGreaterThanOrEqual(
      user.updatedAt.getTime(),
    );
  });
});
