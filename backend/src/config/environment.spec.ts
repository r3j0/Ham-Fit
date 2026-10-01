import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

const DATABASE_URL =
  'postgresql://test:password@localhost:5432/test_database?schema=public';
const AUTH_JWT_SECRET = 'ab'.repeat(32);
const authDefaults = {
  AUTH_JWT_SECRET,
  AUTH_ACCESS_TTL_SECONDS: 900,
  AUTH_REFRESH_TTL_SECONDS: 604800,
  AUTH_COOKIE_SAME_SITE: 'lax',
  TRUST_PROXY_CIDRS: [],
};

describe('Environment configuration', () => {
  it('uses local HTTP defaults when a database URL is supplied', () => {
    expect(validateEnvironment({ DATABASE_URL, AUTH_JWT_SECRET })).toEqual({
      ...authDefaults,
      NODE_ENV: 'development',
      PORT: 3001,
      FRONTEND_ORIGIN: 'http://localhost:3000',
      DATABASE_URL,
    });
  });

  it('converts the environment port into a TCP port number', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        PORT: '4000',
        FRONTEND_ORIGIN: 'https://example.com',
        DATABASE_URL,
        AUTH_JWT_SECRET,
      }),
    ).toEqual({
      ...authDefaults,
      NODE_ENV: 'production',
      PORT: 4000,
      FRONTEND_ORIGIN: 'https://example.com',
      DATABASE_URL,
    });
  });

  it.each(['', 'abc', '0', '-1', '65536', '3001.5'])(
    'rejects an invalid port: %s',
    (PORT) => {
      expect(() => validateEnvironment({ PORT })).toThrow('PORT');
    },
  );

  it.each([
    '*',
    '',
    'file:///tmp',
    'https://example.com/path',
    'http://localhost:3000/',
  ])('rejects an invalid frontend origin: %s', (FRONTEND_ORIGIN) => {
    expect(() => validateEnvironment({ FRONTEND_ORIGIN })).toThrow(
      'FRONTEND_ORIGIN',
    );
  });

  it('rejects a misspelled runtime environment', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'prod' })).toThrow('NODE_ENV');
  });

  it.each([
    undefined,
    '',
    'file:./db',
    'postgresql://user@localhost',
    'postgresql://localhost/db',
    'postgresql://user@localhost/db?schema=',
    'postgresql://user@localhost/db?schema=public&schema=other',
  ])('rejects an absent or invalid database URL: %s', (value) => {
    expect(() => validateEnvironment({ DATABASE_URL: value })).toThrow(
      'DATABASE_URL',
    );
  });

  it('does not expose credentials in a validation error', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'https://user:private-password@host/db',
      }),
    ).toThrow(/^DATABASE_URL must be/);
  });

  it.each([undefined, '', 'shared-default', 'a'.repeat(63)])(
    'rejects an invalid JWT secret: %s',
    (AUTH_JWT_SECRET) => {
      expect(() =>
        validateEnvironment({ DATABASE_URL, AUTH_JWT_SECRET }),
      ).toThrow('AUTH_JWT_SECRET');
    },
  );

  it.each([
    { AUTH_ACCESS_TTL_SECONDS: '0' },
    { AUTH_ACCESS_TTL_SECONDS: '3601' },
    { AUTH_REFRESH_TTL_SECONDS: '60' },
    { AUTH_COOKIE_SAME_SITE: 'none' },
    { AUTH_COOKIE_SAME_SITE: 'invalid' },
  ])('rejects unsafe auth settings: %j', (settings) => {
    expect(() =>
      validateEnvironment({ DATABASE_URL, AUTH_JWT_SECRET, ...settings }),
    ).toThrow('AUTH_');
  });

  it('requires an HTTPS frontend in production', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL,
        AUTH_JWT_SECRET,
        NODE_ENV: 'production',
      }),
    ).toThrow('HTTPS');
  });

  it('accepts explicit proxy networks and rejects blanket trust', () => {
    expect(
      validateEnvironment({
        DATABASE_URL,
        AUTH_JWT_SECRET,
        TRUST_PROXY_CIDRS: '127.0.0.1/32, ::1',
      }).TRUST_PROXY_CIDRS,
    ).toEqual(['127.0.0.1/32', '::1']);
    for (const TRUST_PROXY_CIDRS of [
      'true',
      '0.0.0.0/0',
      '::/0',
      '127.0.0.1/33',
    ]) {
      expect(() =>
        validateEnvironment({
          DATABASE_URL,
          AUTH_JWT_SECRET,
          TRUST_PROXY_CIDRS,
        }),
      ).toThrow('TRUST_PROXY_CIDRS');
    }
  });

  it('requires durable private Blob credentials before enabling Vercel publishing', () => {
    const settings = {
      DATABASE_URL,
      AUTH_JWT_SECRET,
      VERCEL: '1',
      AVATAR_MANAGER_TOKEN: 'c'.repeat(64),
    };
    expect(() => validateEnvironment(settings)).toThrow('private Vercel Blob');
    expect(() =>
      validateEnvironment({ ...settings, AVATAR_ASSET_STORAGE: 'file' }),
    ).toThrow('vercel-blob');
    expect(() =>
      validateEnvironment({ ...settings, BLOB_READ_WRITE_TOKEN: 'test-token' }),
    ).not.toThrow();
    expect(() =>
      validateEnvironment({
        ...settings,
        BLOB_STORE_ID: 'test-store',
        VERCEL_OIDC_TOKEN: 'test-oidc',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnvironment({
        DATABASE_URL,
        AUTH_JWT_SECRET,
        AVATAR_ASSET_STORAGE: 'unknown',
      }),
    ).toThrow('AVATAR_ASSET_STORAGE');
  });
  it('accepts explicit Supabase Storage on Vercel independently of database credentials', () => {
    const settings = {
      DATABASE_URL,
      AUTH_JWT_SECRET,
      VERCEL: '1',
      AVATAR_ASSET_STORAGE: 'supabase',
    };
    expect(() => validateEnvironment(settings)).toThrow('SUPABASE_URL');
    expect(() =>
      validateEnvironment({
        ...settings,
        SUPABASE_URL: 'https://fixture.supabase.co',
      }),
    ).toThrow('SUPABASE_SECRET_KEY');
    expect(() =>
      validateEnvironment({
        ...settings,
        SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_SECRET_KEY: 'sb_secret_fixture-only',
      }),
    ).not.toThrow();
  });
  it.each([
    'http://fixture.supabase.co',
    'https://fixture.supabase.co/',
    'https://user:pass@fixture.supabase.co',
    'https://fixture.supabase.co/storage/v1',
    'https://fixture.supabase.co?key=secret',
  ])('rejects an unsafe Supabase origin: %s', (SUPABASE_URL) => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL,
        AUTH_JWT_SECRET,
        AVATAR_ASSET_STORAGE: 'supabase',
        SUPABASE_URL,
        SUPABASE_SECRET_KEY: 'sb_secret_fixture',
      }),
    ).toThrow('SUPABASE_URL');
  });
  it('accepts a legacy service_role key, rejects public keys and validates bucket IDs', () => {
    const settings = {
      DATABASE_URL,
      AUTH_JWT_SECRET,
      AVATAR_ASSET_STORAGE: 'supabase',
      SUPABASE_URL: 'https://fixture.supabase.co',
    };
    const jwt = (role: string) =>
      `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`;
    expect(() =>
      validateEnvironment({
        ...settings,
        SUPABASE_SECRET_KEY: jwt('service_role'),
      }),
    ).not.toThrow();
    for (const SUPABASE_SECRET_KEY of [
      jwt('anon'),
      'sb_publishable_fixture',
      'database-password',
      '',
      'a.b.c',
    ]) {
      expect(() =>
        validateEnvironment({ ...settings, SUPABASE_SECRET_KEY }),
      ).toThrow('SUPABASE_SECRET_KEY');
    }
    for (const SUPABASE_AVATAR_BUCKET of [
      '',
      '../private',
      'avatar/assets',
      'Avatar Assets',
    ]) {
      expect(() =>
        validateEnvironment({
          ...settings,
          SUPABASE_SECRET_KEY: 'sb_secret_fixture',
          SUPABASE_AVATAR_BUCKET,
        }),
      ).toThrow('SUPABASE_AVATAR_BUCKET');
    }
  });
});
