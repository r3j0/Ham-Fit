import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup-app.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AvatarService } from '../src/avatar/avatar.service.js';

const blob = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  objects: new Map<string, Buffer>(),
}));
vi.mock('@vercel/blob', () => ({ get: blob.get, put: blob.put }));
const supabase = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      getBucket: async () => ({ data: { public: false }, error: null }),
      from: () => ({
        download: async (filename: string) => {
          const bytes = supabase.objects.get(filename);
          return bytes
            ? { data: new Blob([new Uint8Array(bytes)]), error: null }
            : { data: null, error: { code: 'NoSuchKey' } };
        },
        upload: async (filename: string, bytes: Buffer) => {
          if (supabase.objects.has(filename))
            return { error: { code: 'ResourceAlreadyExists' } };
          supabase.objects.set(filename, Buffer.from(bytes));
          return { error: null };
        },
      }),
    },
  }),
}));

describe.each(['file', 'vercel-blob', 'supabase'])(
  'avatar manager registration with PostgreSQL and %s storage',
  (storage) => {
    let app: INestApplication<App>, db: DatabaseService, directory: string;
    const managerToken = 'c'.repeat(64),
      key = `test-${randomUUID()}`;
    let png: Buffer, src: string, userId: string;
    const previous = {
      token: process.env.AVATAR_MANAGER_TOKEN,
      directory: process.env.AVATAR_ASSET_DIR,
      storage: process.env.AVATAR_ASSET_STORAGE,
      blobToken: process.env.BLOB_READ_WRITE_TOKEN,
    };
    beforeAll(async () => {
      const schema = new URL(process.env.DATABASE_URL!).searchParams.get(
        'schema',
      );
      if (!schema?.startsWith('test_'))
        throw new Error(
          'Run through scripts/test-database.mjs using an isolated test schema.',
        );
      directory = await mkdtemp(path.join(tmpdir(), 'avatar-assets-'));
      blob.objects.clear();
      supabase.objects.clear();
      blob.get.mockImplementation(async (key: string) => {
        const bytes = blob.objects.get(key);
        return bytes
          ? {
              statusCode: 200,
              stream: new Response(new Uint8Array(bytes)).body,
              blob: { size: bytes.length },
            }
          : null;
      });
      blob.put.mockImplementation(async (key: string, bytes: Buffer) => {
        blob.objects.set(key, Buffer.from(bytes));
      });
      process.env.AVATAR_MANAGER_TOKEN = managerToken;
      process.env.AVATAR_ASSET_DIR = directory;
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      module.get(ConfigService).set('AVATAR_MANAGER_TOKEN', managerToken);
      module.get(ConfigService).set('AVATAR_ASSET_DIR', directory);
      module.get(ConfigService).set('AVATAR_ASSET_STORAGE', storage);
      module
        .get(ConfigService)
        .set('SUPABASE_URL', 'https://fixture.supabase.co');
      module
        .get(ConfigService)
        .set('SUPABASE_SECRET_KEY', 'sb_secret_fixture-only');
      module
        .get(ConfigService)
        .set('BLOB_READ_WRITE_TOKEN', 'test-private-token');
      app = module.createNestApplication();
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      db = app.get(DatabaseService);
      png = await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 4,
          background: '#00000000',
        },
      })
        .composite([
          {
            input: Buffer.from(
              '<svg width="1000" height="1000"><rect x="350" y="450" width="300" height="350" fill="#c9f4d1"/></svg>',
            ),
          },
        ])
        .png()
        .toBuffer();
    });
    afterAll(async () => {
      if (userId) await db.user.delete({ where: { id: userId } });
      await db.avatarRenderCatalog.deleteMany();
      const combinations = await db.avatarCombination.findMany({
        where: { items: { some: { productId: `clothing.${key}` } } },
      });
      const schema = new URL(process.env.DATABASE_URL!).searchParams.get(
        'schema',
      )!;
      if (!/^test_[a-f0-9]+$/.test(schema))
        throw new Error('Refusing cleanup outside a disposable test schema');
      await db.$transaction(async (tx) => {
        // Only discard this suite's fixtures in the runner-created temporary schema.
        await tx.$executeRawUnsafe(
          `ALTER TABLE "${schema}".avatar_combination_items DISABLE TRIGGER immutable_avatar_combination_item`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE "${schema}".avatar_combinations DISABLE TRIGGER immutable_avatar_combination`,
        );
        await tx.avatarCombinationItem.deleteMany({
          where: { combinationId: { in: combinations.map((c) => c.id) } },
        });
        await tx.avatarCombination.deleteMany({
          where: { id: { in: combinations.map((c) => c.id) } },
        });
        await tx.avatarProduct.deleteMany({ where: { id: `clothing.${key}` } });
        await tx.$executeRawUnsafe(
          `ALTER TABLE "${schema}".avatar_combination_items ENABLE TRIGGER immutable_avatar_combination_item`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE "${schema}".avatar_combinations ENABLE TRIGGER immutable_avatar_combination`,
        );
      });
      await app.close();
      await rm(directory, { recursive: true, force: true });
      if (previous.token === undefined) delete process.env.AVATAR_MANAGER_TOKEN;
      else process.env.AVATAR_MANAGER_TOKEN = previous.token;
      if (previous.directory === undefined) delete process.env.AVATAR_ASSET_DIR;
      else process.env.AVATAR_ASSET_DIR = previous.directory;
      if (previous.storage === undefined)
        delete process.env.AVATAR_ASSET_STORAGE;
      else process.env.AVATAR_ASSET_STORAGE = previous.storage;
      if (previous.blobToken === undefined)
        delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = previous.blobToken;
    });
    const manager = (method: 'get' | 'post', route: string) =>
      request(app.getHttpServer())
        [method](`/api/v1/avatar-manager/${route}`)
        .set('X-Avatar-Manager-Token', managerToken);
    const payload = (revision = 0, x = 44) => {
      const item = {
        slot: 'top',
        label: 'Test shirt',
        setId: 'test',
        poses: {
          basic: {
            cream: {
              layers: [
                {
                  src,
                  x,
                  y: 20,
                  width: 900,
                  height: 850,
                  rotation: 12,
                  fit: 'stretch',
                  zIndex: 20,
                },
              ],
              qa: {
                status: 'passed',
                reviewer: 'test fixture',
                reviewedAt: '2026-10-01T10:00:00Z',
              },
            },
          },
        },
      };
      const original = structuredClone(item);
      original.poses.basic.cream.layers[0].x = 0;
      return {
        revision,
        catalog: { [key]: item },
        sourceCatalog: { [key]: original },
        products: [{ renderKey: key, price: 25, saleStatus: 'on_sale' }],
        reviewed: true,
        combinations: [],
      };
    };
    const publish = (data: unknown) =>
      manager('post', 'publish').attach(
        'metadata',
        Buffer.from(JSON.stringify(data)),
        'catalog.json',
      );
    it('rejects unauthorized and browser-origin management; validates real PNG and stores immutable files', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/avatar-manager/catalog')
        .expect(403);
      await manager('get', 'catalog')
        .set('Origin', 'http://localhost:3002')
        .expect(403);
      await manager('post', 'images')
        .attach('png', Buffer.from('not png'), 'bad.png')
        .expect(400);
      const uploaded = await manager('post', 'images')
        .attach('png', png, 'shirt.png')
        .expect(201);
      src = (uploaded.body as { src: string }).src;
      const image = await request(app.getHttpServer()).get(src).expect(200);
      expect(image.headers['content-type']).toContain('image/png');
      expect(image.headers['cache-control']).toContain('immutable');
      const status = await manager('get', 'catalog').expect(200);
      expect(status.body).toMatchObject({ imageStorage: storage });
    });
    it('publishes placement, SKU and supported combinations atomically; purchase and saved outfit keep using the asset', async () => {
      const registered = await publish(payload()).expect(201);
      expect(registered.body).toMatchObject({
        revision: 1,
        catalog: {
          [key]: {
            poses: {
              basic: { cream: { layers: [{ x: 44, rotation: 12, src }] } },
            },
          },
        },
      });
      const account = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('X-CSRF-Protection', '1')
        .send({
          email: `${key}@example.test`,
          password: 'asset-test-password-2026',
        })
        .expect(201);
      const auth = account.body as {
        user: { id: string };
        access_token: string;
      };
      userId = auth.user.id;
      await app.get(AvatarService).grantCurrency(userId, `test:${key}`, 100);
      const api = (method: 'get' | 'post' | 'put', url: string) =>
        request(app.getHttpServer())
          [method](`/api/v1${url}`)
          .set('Authorization', `Bearer ${auth.access_token}`)
          .set('X-CSRF-Protection', '1');
      const products = await api('get', '/shop/products').expect(200);
      expect(
        (products.body as { products: unknown[] }).products,
      ).toContainEqual(
        expect.objectContaining({
          id: `clothing.${key}`,
          renderKey: key,
          slot: 'top',
        }),
      );
      await api('post', '/shop/purchases')
        .set('Idempotency-Key', randomUUID())
        .send({ productId: `clothing.${key}`, catalogRevision: 1 })
        .expect(201);
      await api('put', '/users/me/avatar/outfit')
        .set('If-Match', '"1"')
        .send({
          characterId: 'character.cream',
          poseId: 'pose.basic',
          clothingIds: [`clothing.${key}`],
        })
        .expect(200);
      await publish(payload(1, 88)).expect(201);
      const visible = await api('get', '/avatar/render-catalog').expect(200);
      expect(visible.body).toMatchObject({
        revision: 2,
        catalog: {
          [key]: { poses: { basic: { cream: { layers: [{ x: 88, src }] } } } },
        },
      });
      const outfit = await api('get', '/users/me/avatar/outfit').expect(200);
      expect(outfit.body).toMatchObject({
        revision: 2,
        clothingIds: [`clothing.${key}`],
      });
      expect(
        (
          await db.avatarOwnership.findMany({
            where: { userId, productId: `clothing.${key}` },
          })
        ).length,
      ).toBe(1);
    });
    it('rejects stale versions, external image URLs, missing files and dropping registered frames without partial DB writes', async () => {
      await publish(payload(1, 999)).expect(409);
      const bad = payload(2);
      bad.catalog[key].poses.basic.cream.layers[0].src =
        'https://external.test/image.png';
      await publish(bad).expect(400);
      const missing = payload(2);
      missing.catalog[key].poses.basic.cream.layers[0].src =
        `/api/v1/avatar/assets/${'f'.repeat(64)}.png`;
      await publish(missing).expect(404);
      const unsupported = payload(2);
      unsupported.catalog[key].poses.basic.cream.layers[0].width = -2;
      await publish(unsupported).expect(400);
      expect(
        await db.avatarRenderCatalog.findUnique({ where: { id: 'wardrobe' } }),
      ).toMatchObject({ revision: 2 });
    });
  },
);
