import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup-app.js';
import { DatabaseService } from '../src/database/database.service.js';
import { POSES } from '../src/avatar/assets-input.js';
import { AvatarService } from '../src/avatar/avatar.service.js';

describe('frontend-owned image metadata registration with PostgreSQL', () => {
  let app: INestApplication<App>, db: DatabaseService;
  const managerToken = 'c'.repeat(64),
    key = `test-${randomUUID()}`;
  let userId: string;
  const cleanupProducts = [`clothing.${key}`];
  const previousToken = process.env.AVATAR_MANAGER_TOKEN;
  beforeAll(async () => {
    const schema = new URL(process.env.DATABASE_URL!).searchParams.get(
      'schema',
    );
    if (!schema?.startsWith('test_'))
      throw new Error(
        'Run through scripts/test-database.mjs using an isolated test schema.',
      );
    process.env.AVATAR_MANAGER_TOKEN = managerToken;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    module.get(ConfigService).set('AVATAR_MANAGER_TOKEN', managerToken);
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
  });
  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.avatarRenderCatalog.deleteMany();
    const combinations = await db.avatarCombination.findMany({
      where: { items: { some: { productId: { in: cleanupProducts } } } },
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
      await tx.avatarProduct.deleteMany({
        where: { id: { in: cleanupProducts } },
      });
      await tx.$executeRawUnsafe(
        `ALTER TABLE "${schema}".avatar_combination_items ENABLE TRIGGER immutable_avatar_combination_item`,
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE "${schema}".avatar_combinations ENABLE TRIGGER immutable_avatar_combination`,
      );
    });
    await app.close();
    if (previousToken === undefined) delete process.env.AVATAR_MANAGER_TOKEN;
    else process.env.AVATAR_MANAGER_TOKEN = previousToken;
  });
  const manager = (method: 'get' | 'post', route: string, version = 2) =>
    request(app.getHttpServer())
      [method](`/api/v${version}/avatar-manager/${route}`)
      .set('X-Avatar-Manager-Token', managerToken);
  const payload = (revision = 0, price = 25) => ({
    revision,
    products: [
      {
        renderKey: key,
        slot: 'top',
        price,
        saleStatus: 'on_sale',
        frames: [{ pose: 'basic', variant: 'cream' }],
      },
    ],
    reviewed: true,
    combinations: [],
  });
  const publish = (data: unknown) =>
    request(app.getHttpServer())
      .post('/api/v2/avatar-manager/publish')
      .set('X-Avatar-Manager-Token', managerToken)
      .attach('metadata', Buffer.from(JSON.stringify(data)), 'catalog.json');
  it('rejects unauthorized management and retires image routes without storage access', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/avatar-manager/catalog')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v2/avatar-manager/publish')
      .expect(403);
    await manager('get', 'catalog')
      .set('Origin', 'http://localhost:3002')
      .expect(403);
    await manager('post', 'images', 1)
      .attach('png', Buffer.from('unused image'), 'shirt.png')
      .expect(410);
    await manager('post', 'publish', 1).expect(410);
    await request(app.getHttpServer())
      .get(`/api/v1/avatar/assets/${'a'.repeat(64)}.png`)
      .expect(410);
    const status = await manager('get', 'catalog').expect(200);
    expect(status.body).toMatchObject({ imageStorage: 'frontend' });
  });
  it('publishes prices and supported combinations atomically; frontend appearance never enters the DB', async () => {
    const registered = await publish(payload()).expect(201);
    expect(registered.body).toMatchObject({ revision: 1 });
    expect(
      await db.avatarRenderCatalog.findUnique({ where: { id: 'wardrobe' } }),
    ).toMatchObject({ catalog: {}, sourceCatalog: {} });
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
    expect((products.body as { products: unknown[] }).products).toContainEqual(
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
    await publish(payload(1, 30)).expect(201);
    await api('get', '/avatar/render-catalog').expect(410);
    expect(
      await db.avatarRenderCatalog.findUnique({ where: { id: 'wardrobe' } }),
    ).toMatchObject({ revision: 2, catalog: {}, sourceCatalog: {} });
    expect(
      await db.avatarProduct.findUnique({ where: { id: `clothing.${key}` } }),
    ).toMatchObject({ price: 30 });
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
  it('rejects stale prices and display data without partial DB writes', async () => {
    await publish(payload(1, 999)).expect(409);
    await publish({
      ...payload(2),
      catalog: { src: 'unused-image.png' },
    }).expect(400);
    await publish({
      ...payload(2),
      products: [{ ...payload(2).products[0], x: 40 }],
    }).expect(400);
    await publish(payload(2, -2)).expect(400);
    expect(
      await db.avatarRenderCatalog.findUnique({ where: { id: 'wardrobe' } }),
    ).toMatchObject({ revision: 2, catalog: {}, sourceCatalog: {} });
    expect(
      await db.avatarProduct.findUnique({ where: { id: `clothing.${key}` } }),
    ).toMatchObject({ price: 30 });
  });
  it('registers 54 products and 1728 supported frames without storing appearance; repeat registration preserves price revisions', async () => {
    const products = Array.from({ length: 54 }, (_, index) => ({
      renderKey: `${key}-${index}`,
      slot: 'top',
      price: 25,
      saleStatus: 'on_sale',
      frames: POSES.flatMap((pose) =>
        (['cream', 'gray'] as const).map((variant) => ({ pose, variant })),
      ),
    }));
    cleanupProducts.push(...products.map((p) => `clothing.${p.renderKey}`));
    await publish({
      revision: 2,
      products,
      combinations: [],
      reviewed: true,
    }).expect(201);
    expect(
      await db.avatarCombination.count({
        where: {
          items: { some: { productId: { in: cleanupProducts.slice(1) } } },
        },
      }),
    ).toBe(1728);
    await publish({
      revision: 3,
      products,
      combinations: [],
      reviewed: true,
    }).expect(201);
    const rows = await db.avatarProduct.findMany({
      where: { id: { in: cleanupProducts.slice(1) } },
    });
    expect(rows).toHaveLength(54);
    expect(
      rows.every((row) => row.price === 25 && row.catalogRevision === 1),
    ).toBe(true);
    expect(
      await db.avatarRenderCatalog.findUnique({ where: { id: 'wardrobe' } }),
    ).toMatchObject({ revision: 4, catalog: {}, sourceCatalog: {} });
  });
});
