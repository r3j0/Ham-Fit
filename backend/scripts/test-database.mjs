import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

config({ quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is required. Use a dedicated test database; DATABASE_URL is never used as a fallback.',
  );
}
const testUrl = new URL(process.env.TEST_DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(testUrl.protocol))
  throw new Error('TEST_DATABASE_URL must use PostgreSQL.');
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (!process.env[key]) continue;
  const applicationUrl = new URL(process.env[key]);
  if (
    applicationUrl.hostname === testUrl.hostname &&
    (applicationUrl.port || '5432') === (testUrl.port || '5432') &&
    applicationUrl.pathname === testUrl.pathname
  ) {
    throw new Error(
      `TEST_DATABASE_URL must target a different database from ${key}.`,
    );
  }
}
const schema = `test_${randomUUID().replaceAll('-', '')}`;
testUrl.searchParams.delete('schema');
const client = new pg.Client({
  connectionString: testUrl.toString(),
  connectionTimeoutMillis: 5_000,
});
testUrl.searchParams.set('schema', schema);
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: testUrl.toString(),
  // Prisma CLI must never inherit the production migration connection.
  DIRECT_URL: testUrl.toString(),
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  AUTH_ACCESS_TTL_SECONDS: '900',
  AUTH_REFRESH_TTL_SECONDS: '604800',
  AUTH_COOKIE_SAME_SITE: 'lax',
};

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      signal
        ? reject(new Error(`Test process stopped by ${signal}`))
        : resolve(code ?? 1),
    );
  });
}

let created = false;
try {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  const migration = await run([
    'node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
  ]);
  if (migration !== 0) {
    process.exitCode = migration;
  } else {
    // A second deploy verifies that committed migrations are safe to re-run.
    const repeated = await run([
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
    ]);
    process.exitCode =
      repeated ||
      (await run([
        'node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        'vitest.config.e2e.ts',
        ...process.argv.slice(2),
      ]));
  }
} finally {
  if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  await client.end();
}
