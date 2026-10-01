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

  it('enables metadata publishing on Vercel without image storage credentials', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL,
        AUTH_JWT_SECRET,
        VERCEL: '1',
        AVATAR_MANAGER_TOKEN: 'c'.repeat(64),
      }),
    ).not.toThrow();
    // Legacy image environment variables no longer enable storage or block startup.
    expect(() =>
      validateEnvironment({
        DATABASE_URL,
        AUTH_JWT_SECRET,
        VERCEL: '1',
        AVATAR_ASSET_STORAGE: 'supabase',
      }),
    ).not.toThrow();
  });
});
