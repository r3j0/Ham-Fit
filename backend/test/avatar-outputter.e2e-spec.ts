import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AvatarService } from '../src/avatar/avatar.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { StreakRouletteService } from '../src/streak-roulette/streak-roulette.service.js';
import { STREAK_POLICY_VERSION } from '../src/streak-roulette/streak-ticket.js';
import { configureApp } from '../src/setup-app.js';

const prices = {
  curious: 50,
  drink: 50,
  lying: 50,
  stretch: 50,
  droopy: 50,
  'cant-hear': 50,
  'foam-roller': 50,
  phone: 50,
  toilet: 50,
  passion: 70,
  victory: 70,
  run: 70,
  pushup: 70,
  situp: 70,
  weight: 70,
};
type Account = { user: { id: string }; access_token: string };
describe('hamster-outputter-v2 catalog, purchase, outfit and roulette contracts', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let shop: AvatarService;
  let account: Account;
  const ids: string[] = [];
  let roll = 999;
  const now = new Date('2026-10-01T02:00:00Z');
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StreakRouletteService)
      .useFactory({
        factory: (database: DatabaseService, avatar: AvatarService) =>
          new StreakRouletteService(
            database,
            avatar,
            () => now,
            (max) => (max === 1000 ? roll : 0),
          ),
        inject: [DatabaseService, AvatarService],
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    shop = app.get(AvatarService);
  });
  beforeEach(async () => {
    await db.authRateLimit.deleteMany();
    roll = 999;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `outputter-${randomUUID()}@example.test`,
        password: 'test-only outputter secure password',
      })
      .expect(201);
    account = response.body as Account;
    ids.push(account.user.id);
  });
  afterAll(async () => {
    await db?.user.deleteMany({ where: { id: { in: ids } } });
    await app?.close();
  });
  const api = (method: 'get' | 'post' | 'put', path: string) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1');
  const credit = (amount: number) =>
    shop.grantCurrency(account.user.id, `test:${randomUUID()}`, amount);
  async function buy(id: string) {
    const product = await db.avatarProduct.findUniqueOrThrow({ where: { id } });
    return api('post', '/shop/purchases')
      .set('Idempotency-Key', randomUUID())
      .send({ productId: id, catalogRevision: product.catalogRevision });
  }
  const outfit = (
    revision: number,
    characterId: string,
    poseId: string,
    clothingIds: string[] = [],
  ) =>
    api('put', '/users/me/avatar/outfit')
      .set('If-Match', `"${revision}"`)
      .send({ characterId, poseId, clothingIds });
  async function ticket() {
    // Explicit test-only milestone evidence; the roulette HTTP request still
    // runs production candidate selection, ownership and atomic draw storage.
    const achievement = await db.activityAchievement.create({
      data: {
        userId: account.user.id,
        koreanDate: new Date('2026-10-01'),
        achievedAt: new Date('2026-10-01T01:00:00Z'),
        sourceKind: 'daily_assignment',
        sourceId: randomUUID(),
      },
    });
    return db.streakRouletteTicket.create({
      data: {
        userId: account.user.id,
        achievementId: achievement.id,
        koreanDate: achievement.koreanDate,
        segmentStartDate: new Date('2026-09-27'),
        streakDays: 5,
        createdAt: achievement.achievedAt,
        policyVersion: STREAK_POLICY_VERSION,
      },
    });
  }
  async function own(kind: string, except: string[]) {
    const products = await db.avatarProduct.findMany({
      where: { kind, id: { notIn: except } },
    });
    await db.avatarOwnership.createMany({
      data: products.map((product) => ({
        userId: account.user.id,
        productId: product.id,
        source: 'purchase',
      })),
      skipDuplicates: true,
    });
  }
  it('publishes all confirmed prices, retains defaults, and certifies only the supplied mint-shirt combinations', async () => {
    const response = await api('get', '/shop/products').expect(200);
    const catalog = response.body as Awaited<
      ReturnType<AvatarService['catalog']>
    >;
    for (const [key, price] of Object.entries(prices))
      expect(
        catalog.products.find((product) => product.id === `pose.${key}`),
      ).toMatchObject({
        renderKey: key,
        price,
        priceProvisional: false,
        saleStatus: 'on_sale',
        ownershipScope: 'shared',
      });
    for (const id of ['character.cream', 'character.gray', 'pose.basic'])
      expect(
        catalog.products.find((product) => product.id === id),
      ).toMatchObject({ price: null, saleStatus: 'default' });
    expect(
      catalog.products.find((product) => product.id === 'clothing.mint-shirt'),
    ).toMatchObject({
      kind: 'clothing',
      slot: 'top',
      occupiesSlots: ['top'],
      renderKey: 'mint-shirt',
      price: 25,
      priceProvisional: false,
      ownershipScope: 'shared',
      scopeCharacterId: null,
    });
    expect(
      catalog.combinations.filter((value) =>
        value.clothingIds.includes('clothing.mint-shirt'),
      ),
    ).toEqual(
      ['character.cream', 'character.gray'].map((characterId) => ({
        characterId,
        poseId: 'pose.basic',
        clothingIds: ['clothing.mint-shirt'],
      })),
    );
    for (const key of ['foam-roller', 'phone', 'toilet', 'weight'])
      for (const characterId of ['character.cream', 'character.gray'])
        expect(catalog.combinations).toContainEqual({
          characterId,
          poseId: `pose.${key}`,
          clothingIds: [],
        });
    expect(catalog.products.some((value) => /sportswear/.test(value.id))).toBe(
      false,
    );
  });
  it('charges 25 for permanent shared mint-shirt ownership and saves it for both basic characters', async () => {
    await credit(100);
    const bought = await buy('clothing.mint-shirt');
    expect(bought.status).toBe(201);
    expect(bought.body).toMatchObject({
      purchase: { price: 25 },
      currency: { balance: 75 },
    });
    await outfit(1, 'character.cream', 'pose.basic', [
      'clothing.mint-shirt',
    ]).expect(200);
    await outfit(2, 'character.gray', 'pose.basic', [
      'clothing.mint-shirt',
    ]).expect(200);
    expect((await api('get', '/users/me/avatar/outfit')).body).toMatchObject({
      characterId: 'character.gray',
      poseId: 'pose.basic',
      clothingIds: ['clothing.mint-shirt'],
      revision: 3,
    });
    expect((await buy('clothing.mint-shirt')).status).toBe(409);
  });
  it('buys and saves every new pose in cream and gray without auto-equipping', async () => {
    await credit(1000);
    let revision = 1;
    for (const key of ['foam-roller', 'phone', 'toilet', 'weight']) {
      const bought = await buy(`pose.${key}`);
      expect(bought.status).toBe(201);
      expect(bought.body.purchase.price).toBe(key === 'weight' ? 70 : 50);
      for (const characterId of ['character.cream', 'character.gray']) {
        await outfit(revision++, characterId, `pose.${key}`).expect(200);
      }
    }
    expect((await shop.inventory(account.user.id)).currency.balance).toBe(780);
  });
  it('rejects mint-shirt on other poses and fabricated hat/bottom assets without changing the outfit', async () => {
    await credit(100);
    await buy('clothing.mint-shirt');
    await buy('pose.weight');
    await outfit(1, 'character.cream', 'pose.weight', [
      'clothing.mint-shirt',
    ]).expect(422);
    await outfit(1, 'character.cream', 'pose.basic', [
      'clothing.nonexistent-hat',
    ]).expect(400);
    expect((await api('get', '/users/me/avatar/outfit')).body.revision).toBe(1);
  });
  it('blocks provisional prices in the actual purchase API and detects stale catalog revisions', async () => {
    await credit(100);
    const original = await db.avatarProduct.findUniqueOrThrow({
      where: { id: 'pose.curious' },
    });
    try {
      const provisional = await db.avatarProduct.update({
        where: { id: original.id },
        data: { priceProvisional: true },
      });
      const response = await buy(original.id);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('PRICE_NOT_CONFIRMED');
      const confirmed = await db.avatarProduct.update({
        where: { id: original.id },
        data: { priceProvisional: false },
      });
      expect(confirmed.catalogRevision).toBe(provisional.catalogRevision + 1);
      await api('post', '/shop/purchases')
        .set('Idempotency-Key', randomUUID())
        .send({
          productId: original.id,
          catalogRevision: provisional.catalogRevision,
        })
        .expect(409);
      expect((await shop.inventory(account.user.id)).currency.balance).toBe(
        100,
      );
      expect(
        await db.avatarPurchase.count({ where: { userId: account.user.id } }),
      ).toBe(0);
    } finally {
      await db.avatarProduct.update({
        where: { id: original.id },
        data: { priceProvisional: false },
      });
    }
  });
  it('retires a-plus from purchases and roulette while preserving legacy outfit/ownership and basic recovery', async () => {
    expect(
      await db.avatarProduct.findUnique({ where: { id: 'pose.a-plus' } }),
    ).toMatchObject({
      saleStatus: 'retired',
      price: null,
      priceProvisional: false,
      renderKey: 'a-plus',
    });
    await credit(100);
    const response = await buy('pose.a-plus');
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('NOT_FOR_SALE');
    await own('pose', ['pose.a-plus']);
    const issued = await ticket();
    const spun = await api('post', '/users/me/streak-roulette/spins')
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: issued.id })
      .expect(201);
    expect(spun.body.draw).toMatchObject({
      originalResult: 'pose',
      actualReward: { kind: 'seeds', amount: 70, productId: null },
      fallback: { applied: true },
    });
    expect(
      await db.avatarOwnership.findUnique({
        where: {
          userId_productId: {
            userId: account.user.id,
            productId: 'pose.a-plus',
          },
        },
      }),
    ).toBeNull();
    await db.avatarOwnership.create({
      data: {
        userId: account.user.id,
        productId: 'pose.a-plus',
        source: 'purchase',
      },
    });
    await outfit(1, 'character.gray', 'pose.a-plus').expect(200);
    expect((await api('get', '/users/me/avatar/outfit')).body.poseId).toBe(
      'pose.a-plus',
    );
    await outfit(2, 'character.gray', 'pose.basic').expect(200);
    expect(
      (await shop.inventory(account.user.id)).inventory.some(
        (value) => value.productId === 'pose.a-plus',
      ),
    ).toBe(true);
  });
  it('awards a new sale pose with the existing roulette policy and no purchase charge', async () => {
    await own('pose', ['pose.a-plus', 'pose.weight']);
    const issued = await ticket();
    const response = await api('post', '/users/me/streak-roulette/spins')
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: issued.id })
      .expect(201);
    expect(response.body.draw).toMatchObject({
      originalResult: 'pose',
      actualReward: { kind: 'pose', amount: 1, productId: 'pose.weight' },
      fallback: { applied: false },
    });
    expect((await shop.inventory(account.user.id)).currency.balance).toBe(0);
    expect(
      await db.avatarOwnership.findUnique({
        where: {
          userId_productId: {
            userId: account.user.id,
            productId: 'pose.weight',
          },
        },
      }),
    ).toMatchObject({ source: 'streak_roulette' });
  });
  it('awards mint-shirt from the existing clothing pool and preserves its render restrictions', async () => {
    roll = 993;
    await own('clothing', ['clothing.mint-shirt']);
    const issued = await ticket();
    const response = await api('post', '/users/me/streak-roulette/spins')
      .set('Idempotency-Key', randomUUID())
      .send({ ticketId: issued.id })
      .expect(201);
    expect(response.body.draw.actualReward).toMatchObject({
      kind: 'clothing',
      productId: 'clothing.mint-shirt',
      amount: 1,
    });
    await outfit(1, 'character.gray', 'pose.basic', [
      'clothing.mint-shirt',
    ]).expect(200);
    expect((await shop.inventory(account.user.id)).currency.balance).toBe(0);
  });
});
