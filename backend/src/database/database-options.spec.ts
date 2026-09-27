import { describe, expect, it } from 'vitest';
import { databaseOptions } from './database-options.js';

const connectionString =
  'postgresql://test:p%40ssword@127.0.0.1:5432/test_database';

describe('PostgreSQL connection options', () => {
  it('sets UTC at pool connection startup while retaining the default schema and limits', () => {
    const options = databaseOptions(connectionString);
    expect(new URL(options.connectionString).searchParams.get('options')).toBe(
      '-c timezone=UTC',
    );
    expect(options).toMatchObject({
      schema: 'public',
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
    });
  });

  it('keeps the Prisma schema separate and preserves credentials and unrelated URL options', () => {
    const original = new URL(connectionString);
    original.searchParams.set('schema', 'test_preferences');
    original.searchParams.set('application_name', 'Project Health API');
    original.searchParams.set('sslmode', 'require');
    original.searchParams.set('options', '-c search_path=custom,public');
    const options = databaseOptions(original.toString());
    const actual = new URL(options.connectionString);
    expect(options.schema).toBe('test_preferences');
    expect(actual.searchParams.has('schema')).toBe(false);
    expect(actual.username).toBe(original.username);
    expect(actual.password).toBe(original.password);
    expect(actual.host).toBe(original.host);
    expect(actual.pathname).toBe(original.pathname);
    expect(actual.searchParams.get('application_name')).toBe(
      'Project Health API',
    );
    expect(actual.searchParams.get('sslmode')).toBe('require');
    expect(actual.searchParams.get('options')).toBe(
      '-c search_path=custom,public -c timezone=UTC',
    );
  });

  it.each([
    '-c timezone=Asia/Seoul',
    '-c statement_timeout=5000 -c TimeZone=America/New_York',
  ])(
    'overrides an existing timezone after all caller options: %s',
    (existing) => {
      const original = new URL(connectionString);
      original.searchParams.set('options', existing);
      const actual = new URL(
        databaseOptions(original.toString()).connectionString,
      );
      expect(actual.searchParams.get('options')).toBe(
        `${existing} -c timezone=UTC`,
      );
    },
  );
});
