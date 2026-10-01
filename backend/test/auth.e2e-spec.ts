import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { verify } from 'argon2';
import { decodeJwt, SignJWT } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { validateEnvironment } from '../src/config/environment.js';
import { configureApp } from '../src/setup-app.js';

const password = 'correct horse battery staple';
const origin = 'http://localhost:3000';
const testTag = randomUUID();
const email = () => `auth-${testTag}-${randomUUID()}@example.test`;
type AuthBody = {
  user: { id: string; email: string; created_at: string; updated_at: string };
  access_token: string;
  token_type: string;
  expires_in: number;
};

describe('Email authentication against PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
  });

  beforeEach(async () => {
    // This schema belongs exclusively to the current test run.
    await database.authRateLimit.deleteMany();
  });

  afterAll(async () => {
    await database?.user.deleteMany({
      where: { email: { startsWith: `auth-${testTag}-` } },
    });
    await app?.close();
  });

  function post(path: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/auth/${path}`)
      .set('Origin', origin)
      .set('X-CSRF-Protection', '1');
  }

  async function register(loginEmail = email()) {
    const response = await post('register')
      .send({ email: loginEmail, password })
      .expect(201);
    const body = response.body as AuthBody;
    const cookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    return { body, cookie, response };
  }

  function me(token: string) {
    return request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
  }

  it('accepts eight-character passwords for registration and account changes, rejecting seven', async () => {
    const loginEmail = email();
    await post('register')
      .send({ email: loginEmail, password: '1234567' })
      .expect(400);
    const response = await post('register')
      .send({ email: loginEmail, password: '12345678' })
      .expect(201);
    const body = response.body as AuthBody;
    const change = (newPassword: string) =>
      request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${body.access_token}`)
        .set('X-CSRF-Protection', '1')
        .send({ currentPassword: '12345678', newPassword });
    await change('7654321').expect(400);
    await change('87654321').expect(204);
    await post('login')
      .send({ email: loginEmail, password: '12345678' })
      .expect(401);
    await post('login')
      .send({ email: loginEmail, password: '87654321' })
      .expect(200);
  });

  it('registers real data, stores only an Argon2id hash, and returns safe account fields', async () => {
    const inputEmail = email();
    const { body, cookie, response } = await register(
      `  ${inputEmail.toUpperCase()}  `,
    );
    expect(body.user.email).toBe(inputEmail);
    expect(Object.keys(body.user).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'updated_at',
    ]);
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(900);
    expect(response.headers['cache-control']).toBe('no-store');
    const setCookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0];
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(JSON.stringify(body)).not.toContain(password);
    expect(JSON.stringify(body)).not.toContain('refresh_token');
    const stored = await database.user.findUniqueOrThrow({
      where: { id: body.user.id },
    });
    expect(stored.password).toMatch(/^\$argon2id\$/);
    expect(await verify(stored.password!, password)).toBe(true);
    const rawRefresh = cookie.split('=')[1];
    const tokens = await database.authRefreshToken.findMany({
      where: { session: { userId: stored.id } },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toBe(
      createHash('sha256').update(rawRefresh).digest('hex'),
    );
    expect(tokens[0].tokenHash).not.toBe(rawRefresh);
    expect((await me(body.access_token).expect(200)).body).toMatchObject(
      body.user,
    );
  });

  it('uses a different salt for the same password', async () => {
    const first = await register();
    const second = await register();
    const users = await database.user.findMany({
      where: { id: { in: [first.body.user.id, second.body.user.id] } },
    });
    expect(users[0].password).not.toBe(users[1].password);
  });

  it('rejects duplicate emails including concurrent registration', async () => {
    const loginEmail = email();
    const responses = await Promise.all([
      post('register').send({ email: loginEmail, password }),
      post('register').send({ email: loginEmail.toUpperCase(), password }),
    ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(await database.user.count({ where: { email: loginEmail } })).toBe(1);
  });

  it.each([
    { email: 'invalid', password },
    { email: 'valid@example.test', password: 'short' },
    { email: 'valid@example.test', password: 'x'.repeat(129) },
    { email: 'valid@example.test', password, admin: true },
    { email: 'valid@example.test' },
    { email: 123, password },
  ])('rejects malformed signup without storing a user: %j', async (input) => {
    const count = await database.user.count();
    await post('register').send(input).expect(400);
    expect(await database.user.count()).toBe(count);
  });

  it('logs in with normalized email and returns a uniform credential error', async () => {
    const { body } = await register();
    const failed = await post('login')
      .send({ email: body.user.email, password: 'wrong' })
      .expect(401);
    const missing = await post('login')
      .send({ email: email(), password: 'wrong' })
      .expect(401);
    expect(failed.body).toEqual(missing.body);
    expect(failed.headers['set-cookie']).toBeUndefined();
    const response = await post('login')
      .send({ email: body.user.email.toUpperCase(), password })
      .expect(200);
    expect(
      (await me((response.body as AuthBody).access_token).expect(200)).body,
    ).toMatchObject(body.user);
  });

  it('never accepts null or manually entered plaintext passwords', async () => {
    for (const storedPassword of [null, password, '$argon2id$broken']) {
      const loginEmail = email();
      await database.user.create({
        data: { email: loginEmail, password: storedPassword },
      });
      await post('login').send({ email: loginEmail, password }).expect(401);
    }
  });

  it('rotates refresh tokens without extending the session lifetime', async () => {
    const { body, cookie } = await register();
    const before = await database.authSession.findFirstOrThrow({
      where: { userId: body.user.id },
    });
    const response = await post('refresh').set('Cookie', cookie).expect(200);
    const nextCookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    expect(nextCookie).not.toBe(cookie);
    expect((response.body as AuthBody).access_token).not.toBe(
      body.access_token,
    );
    const after = await database.authSession.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.expiresAt).toEqual(before.expiresAt);
    const oldHash = createHash('sha256')
      .update(cookie.split('=')[1])
      .digest('hex');
    expect(
      (
        await database.authRefreshToken.findUniqueOrThrow({
          where: { tokenHash: oldHash },
        })
      ).usedAt,
    ).not.toBeNull();
    await me((response.body as AuthBody).access_token).expect(200);
    await post('refresh').set('Cookie', nextCookie).expect(200);
  });

  it('revokes the session when a consumed refresh token is replayed', async () => {
    const { body, cookie } = await register();
    const rotated = await post('refresh').set('Cookie', cookie).expect(200);
    const nextCookie = (
      rotated.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    await post('refresh').set('Cookie', cookie).expect(401);
    await post('refresh').set('Cookie', nextCookie).expect(401);
    await me(body.access_token).expect(401);
    await me((rotated.body as AuthBody).access_token).expect(401);
  });

  it('allows at most one concurrent refresh and revokes replayed sessions', async () => {
    const { cookie } = await register();
    const responses = await Promise.all([
      post('refresh').set('Cookie', cookie),
      post('refresh').set('Cookie', cookie),
    ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
    const success = responses.find((r) => r.status === 200)!;
    await me((success.body as AuthBody).access_token).expect(401);
  });

  it('logs out immediately, is repeatable, and leaves other logins active', async () => {
    const { body, cookie } = await register();
    const other = await post('login')
      .send({ email: body.user.email, password })
      .expect(200);
    const logout = await post('logout').set('Cookie', cookie).expect(204);
    expect((logout.headers['set-cookie'] as unknown as string[])[0]).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    await me(body.access_token).expect(401);
    await me((other.body as AuthBody).access_token).expect(200);
    await post('refresh').set('Cookie', cookie).expect(401);
    await post('logout').set('Cookie', cookie).expect(204);
    await post('logout').expect(204);
  });

  it('can log out with a Bearer token when no refresh cookie is available', async () => {
    const { body, cookie } = await register();
    await post('logout')
      .set('Authorization', `Bearer ${body.access_token}`)
      .expect(204);
    await me(body.access_token).expect(401);
    await post('refresh').set('Cookie', cookie).expect(401);
  });

  it('does not let concurrent logout and refresh revive a session', async () => {
    const { body, cookie } = await register();
    const [refresh, logout] = await Promise.all([
      post('refresh').set('Cookie', cookie),
      post('logout').set('Cookie', cookie),
    ]);
    expect(logout.status).toBe(204);
    expect([200, 401]).toContain(refresh.status);
    await me(body.access_token).expect(401);
    if (refresh.status === 200)
      await me((refresh.body as AuthBody).access_token).expect(401);
  });

  it('rejects expired sessions, including otherwise valid access tokens', async () => {
    const { body, cookie } = await register();
    await database.authSession.updateMany({
      where: { userId: body.user.id },
      data: {
        createdAt: new Date(Date.now() - 3000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await me(body.access_token).expect(401);
    await post('refresh').set('Cookie', cookie).expect(401);
  });

  it('validates JWT signature, expiry, issuer, audience, and algorithm', async () => {
    const { body } = await register();
    await me(`${body.access_token}tampered`).expect(401);
    const payload = decodeJwt(body.access_token);
    const key = Buffer.from(process.env.AUTH_JWT_SECRET!, 'hex');
    for (const claims of [
      { ...payload, exp: 1 },
      { ...payload, iss: 'other' },
      { ...payload, aud: 'other' },
    ]) {
      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
        .sign(key);
      await me(token).expect(401);
    }
    const wrongKey = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .sign(randomBytes(32));
    await me(wrongKey).expect(401);
    const wrongAlgorithm = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS384', typ: 'at+jwt' })
      .sign(randomBytes(48));
    await me(wrongAlgorithm).expect(401);
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await post('refresh').expect(401);
    await post('refresh')
      .set('Cookie', 'project_health_refresh=invalid')
      .expect(401);
  });

  it('requires a CSRF header and rejects untrusted origins', async () => {
    for (const path of ['register', 'login', 'refresh', 'logout']) {
      await request(app.getHttpServer())
        .post(`/api/v1/auth/${path}`)
        .send({ email: email(), password })
        .expect(403);
      await post(path)
        .set('Origin', 'https://untrusted.example')
        .send({ email: email(), password })
        .expect(403);
    }
    await request(app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-CSRF-Protection,Content-Type')
      .expect('Access-Control-Allow-Credentials', 'true')
      .expect(204);
  });

  it('limits repeated login attempts with persistent database counters', async () => {
    const loginEmail = email();
    for (let i = 0; i < 10; i++)
      await post('login')
        .send({ email: loginEmail, password: 'wrong' })
        .expect(401);
    const blocked = await post('login')
      .send({ email: loginEmail, password: 'wrong' })
      .expect(429);
    expect(
      (blocked.body as { retry_after: number }).retry_after,
    ).toBeGreaterThan(0);
    const rows = await database.authRateLimit.findMany();
    expect(JSON.stringify(rows)).not.toContain(loginEmail);
    expect(rows.some((r) => r.attempts === 11)).toBe(true);
  });

  it('sets Secure host-only cookies under the production configuration', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService(
          validateEnvironment({
            NODE_ENV: 'production',
            FRONTEND_ORIGIN: 'https://app.example.test',
            DATABASE_URL: process.env.DATABASE_URL,
            AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
          }),
        ),
      )
      .compile();
    const productionApp = module.createNestApplication();
    configureApp(productionApp);
    await productionApp.listen(0, '127.0.0.1');
    try {
      const response = await request(productionApp.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'https://app.example.test')
        .set('X-CSRF-Protection', '1')
        .send({ email: email(), password })
        .expect(201);
      const cookie = (response.headers['set-cookie'] as unknown as string[])[0];
      expect(cookie).toMatch(/^__Host-project_health_refresh=/);
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
      expect(cookie).not.toContain('Domain=');
    } finally {
      await productionApp.close();
    }
  });
});
