import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AvatarService } from '../src/avatar/avatar.service.js';
import type { OutfitInput } from '../src/avatar/avatar-input.js';
import { combinationId } from '../src/avatar/avatar-input.js';
import { GroupsService } from '../src/groups/groups.service.js';
import { configureApp } from '../src/setup-app.js';
import { observeClientQueries } from './helpers/pg-queries.js';

type Account = { id: string; token: string; email: string };
const password = 'avatar-test-password-2026';
const defaultOutfit: OutfitInput = {
  characterId: 'character.cream',
  poseId: 'pose.basic',
  clothingIds: [],
};

describe('avatar and shop with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let service: AvatarService;
  const ids: string[] = [];
  let revisions: Map<string, number>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    service = app.get(AvatarService);
  });
  beforeEach(async () => {
    await db.authRateLimit.deleteMany();
    revisions = new Map(
      (await db.avatarProduct.findMany()).map((p) => [p.id, p.catalogRevision]),
    );
  });
  afterAll(async () => {
    await db?.group.deleteMany({ where: { leaderUserId: { in: ids } } });
    await db?.user.deleteMany({ where: { id: { in: ids } } });
    await app?.close();
  });
  async function register(): Promise<Account> {
    const email = `avatar-${randomUUID()}@example.test`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({ email, password })
      .expect(201);
    const body = response.body as {
      user: { id: string };
      access_token: string;
    };
    ids.push(body.user.id);
    return { id: body.user.id, token: body.access_token, email };
  }
  const api = (a: Account, method: 'get' | 'post' | 'put', path: string) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-CSRF-Protection', '1');
  const buy = (
    a: Account,
    productId = 'pose.run',
    key = randomUUID(),
    catalogRevision = revisions.get(productId) ?? 1,
  ) =>
    api(a, 'post', '/shop/purchases')
      .set('Idempotency-Key', key)
      .send({ productId, catalogRevision });
  const save = (a: Account, body = defaultOutfit, revision = 1) =>
    api(a, 'put', '/users/me/avatar/outfit')
      .set('If-Match', `"${revision}"`)
      .send(body);
  const fund = (a: Account, amount = 200) =>
    service.grantCurrency(a.id, `test:${randomUUID()}`, amount);
  const balance = async (a: Account) =>
    (await db.userCurrency.findUniqueOrThrow({ where: { userId: a.id } }))
      .balance;

  it('initializes exactly two characters and basic without rewards; lists verified catalog, prices and excludes legacy sets', async () => {
    const a = await register();
    const inventory = await api(a, 'get', '/users/me/avatar/inventory').expect(
      200,
    );
    expect(inventory.body).toMatchObject({
      currency: { balance: 0 },
      inventory: [
        { productId: 'character.cream', source: 'default' },
        { productId: 'character.gray', source: 'default' },
        { productId: 'pose.basic', source: 'default' },
      ],
    });
    const observed = await observeClientQueries(async () =>
      api(a, 'get', '/users/me/avatar/outfit').expect(200),
    );
    expect(observed.overlaps).toBe(0);
    const outfit = observed.value;
    expect(outfit.body).toMatchObject({
      ...defaultOutfit,
      revision: 1,
      rendering: { variant: 'cream', pose: 'basic', clothing: [] },
    });
    expect(outfit.headers.etag).toBe('"1"');
    const catalog = await api(a, 'get', '/shop/products').expect(200);
    const body = catalog.body as {
      products: Array<{
        id: string;
        price: number | null;
        saleStatus: string;
        priceProvisional: boolean;
      }>;
      combinations: unknown[];
    };
    expect(body.products).toHaveLength(20);
    expect(body.combinations).toHaveLength(36);
    const paid = body.products.filter((p) => p.saleStatus === 'on_sale');
    expect(paid).toHaveLength(16);
    for (const p of paid) {
      expect(p.price).toBeGreaterThanOrEqual(25);
      expect(p.price).toBeLessThanOrEqual(70);
      expect(p.priceProvisional).toBe(false);
    }
    expect(
      body.products.filter((p) => p.id.startsWith('clothing.')),
    ).toHaveLength(1);
    await buy(a, 'pose.basic').expect(409);
    await buy(a, 'clothing.blue-sportswear').expect(404);
    expect(
      await db.currencyTransaction.count({ where: { userId: a.id } }),
    ).toBe(0);
  });

  it('buys permanently, records both ledger and historical price, replays with current balance, never auto-equips', async () => {
    const a = await register();
    await fund(a);
    const before = await service.outfit(a.id);
    const key = randomUUID();
    const first = await buy(a, 'pose.run', key).expect(201);
    expect(first.body).toMatchObject({
      replayed: false,
      purchase: {
        productId: 'pose.run',
        price: 70,
        catalogRevision: revisions.get('pose.run'),
      },
      currency: { balance: 130 },
      inventory: expect.arrayContaining([
        {
          productId: 'pose.run',
          source: 'purchase',
          acquiredAt: expect.any(String),
        },
      ]),
    });
    expect(await service.outfit(a.id)).toEqual(before);
    await buy(a, 'pose.run')
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: 'ALREADY_OWNED' }),
      );
    await service.grantCurrency(a.id, `test:${randomUUID()}`, 10);
    const replay = await buy(a, 'pose.run', key).expect(200);
    expect(replay.body).toMatchObject({
      replayed: true,
      purchase: (first.body as { purchase: unknown }).purchase,
      currency: { balance: 140 },
    });
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await buy(a, 'pose.drink', key).expect(409);
    await buy(a, 'pose.run', key, revisions.get('pose.run')! + 1).expect(409);
    expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(1);
    expect(
      await db.currencyTransaction.findMany({
        where: { userId: a.id, kind: 'purchase' },
      }),
    ).toMatchObject([{ amount: -70, balanceAfter: 130 }]);
  });

  it('rejects insufficient funds and forged prices and keeps failed keys available for a legitimate retry', async () => {
    const a = await register();
    const key = randomUUID();
    await buy(a, 'pose.run', key)
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: 'INSUFFICIENT_FUNDS' }),
      );
    await api(a, 'post', '/shop/purchases')
      .set('Idempotency-Key', key)
      .send({ productId: 'pose.run', catalogRevision: 1, price: 1 })
      .expect(400);
    await buy(a, 'pose.missing').expect(404);
    expect(await balance(a)).toBe(0);
    expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(0);
    await fund(a, 70);
    await buy(a, 'pose.run', key).expect(201);
    expect(await balance(a)).toBe(0);
  });

  it('serializes repeated and competing purchases without duplicate charges or negative balances', async () => {
    const a = await register();
    await fund(a, 70);
    const key = randomUUID();
    const same = await Promise.all(
      Array.from({ length: 5 }, () => buy(a, 'pose.run', key)),
    );
    expect(same.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 200, 200, 200, 201,
    ]);
    expect(await balance(a)).toBe(0);
    const b = await register();
    await fund(b, 70);
    const different = await Promise.all([
      buy(b, 'pose.run'),
      buy(b, 'pose.pushup'),
      buy(b, 'pose.run'),
    ]);
    expect(different.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409, 409,
    ]);
    expect(await balance(b)).toBe(0);
    expect(await db.avatarPurchase.count({ where: { userId: b.id } })).toBe(1);
  });

  it('rolls back debit, ownership and purchase if the final ledger insert fails', async () => {
    const a = await register();
    await fund(a);
    const key = randomUUID();
    // Database fault injection in the dedicated isolated test schema only.
    await db.$executeRawUnsafe(
      `ALTER TABLE ${db.table('users').sql.replace('"users"', '"currency_transactions"')} ADD CONSTRAINT avatar_test_failure CHECK (user_id <> '${a.id}'::uuid OR kind <> 'purchase')`,
    );
    try {
      await expect(
        service.purchase(a.id, key, {
          productId: 'pose.run',
          catalogRevision: revisions.get('pose.run')!,
        }),
      ).rejects.toThrow();
      expect(await balance(a)).toBe(200);
      expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(
        0,
      );
      expect(await db.avatarOwnership.count({ where: { userId: a.id } })).toBe(
        3,
      );
      expect(
        await db.currencyTransaction.count({
          where: { userId: a.id, kind: 'purchase' },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `ALTER TABLE ${db.table('users').sql.replace('"users"', '"currency_transactions"')} DROP CONSTRAINT avatar_test_failure`,
      );
    }
    await buy(a, 'pose.run', key).expect(201);
  });

  it('requires current catalog revision and keeps old successful retries valid after price and sale changes', async () => {
    const a = await register();
    const b = await register();
    await fund(a);
    await fund(b);
    const key = randomUUID();
    await buy(a, 'pose.curious', key).expect(201);
    const original = await db.avatarProduct.findUniqueOrThrow({
      where: { id: 'pose.curious' },
    });
    try {
      const changed = await db.avatarProduct.update({
        where: { id: original.id },
        data: { price: 55 },
      });
      expect(changed.catalogRevision).toBe(original.catalogRevision + 1);
      await buy(b, original.id, randomUUID(), original.catalogRevision)
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject({ code: 'CATALOG_CHANGED' }),
        );
      await buy(b, original.id, randomUUID(), changed.catalogRevision)
        .expect(201)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            purchase: { price: 55 },
            currency: { balance: 145 },
          }),
        );
      await db.avatarProduct.update({
        where: { id: original.id },
        data: { saleStatus: 'retired' },
      });
      await buy(a, original.id, key)
        .expect(200)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            purchase: { price: 50, catalogRevision: original.catalogRevision },
          }),
        );
    } finally {
      await db.avatarProduct.update({
        where: { id: original.id },
        data: { price: original.price, saleStatus: original.saleStatus },
      });
    }
  });

  it('saves owned combinations atomically, shares poses across characters, rejects stale and unowned saves, persists through login and new app instance', async () => {
    const a = await register();
    await save(a, { ...defaultOutfit, poseId: 'pose.run' }).expect(403);
    await fund(a);
    await buy(a).expect(201);
    const input = {
      ...defaultOutfit,
      characterId: 'character.gray',
      poseId: 'pose.run',
    };
    const observed = await observeClientQueries(() =>
      Promise.all([
        save(a, input),
        save(a, { ...defaultOutfit, characterId: 'character.gray' }),
      ]),
    );
    expect(observed.overlaps).toBe(0);
    const responses = observed.value;
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 412,
    ]);
    const saved = responses.find((r) => r.status === 200)!;
    expect(saved.headers.etag).toBe('"2"');
    await save(a, defaultOutfit).expect(412);
    await api(a, 'get', '/shop/products').expect(200);
    await api(a, 'get', '/users/me/avatar/outfit').expect(200, saved.body);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-CSRF-Protection', '1')
      .send({ email: a.email, password })
      .expect(200);
    const next = {
      ...a,
      token: (login.body as { access_token: string }).access_token,
    };
    await api(next, 'get', '/users/me/avatar/outfit').expect(200, saved.body);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const fresh = module.createNestApplication();
    configureApp(fresh);
    await fresh.listen(0, '127.0.0.1');
    try {
      await request(fresh.getHttpServer())
        .get('/api/v1/users/me/avatar/outfit')
        .set('Authorization', `Bearer ${next.token}`)
        .expect(200, saved.body);
    } finally {
      await fresh.close();
    }
    await save(next, input, 2).expect(200);
    await save(next, { ...input, characterId: 'character.cream' }, 3).expect(
      200,
    );
  });

  it('checks item kinds, duplicate slots and full combination compatibility including future separated pieces', async () => {
    const a = await register();
    await save(a, { ...defaultOutfit, poseId: 'character.gray' }).expect(400);
    await save(a, {
      ...defaultOutfit,
      clothingIds: ['clothing.blue-sportswear', 'clothing.blue-sportswear'],
    }).expect(400);
    await save(a, {
      ...defaultOutfit,
      clothingIds: ['clothing.blue-sportswear', 'clothing.green-sportswear'],
    }).expect(400);
    const suffix = randomUUID();
    const top = `clothing.test-top-${suffix}`;
    const top2 = `clothing.test-top2-${suffix}`;
    const hat = `clothing.test-hat-${suffix}`;
    // Synthetic assets exist only in this test DB, never in the production seed.
    await db.avatarProduct.createMany({
      data: [
        {
          id: top,
          kind: 'clothing',
          slot: 'top',
          occupiesSlots: ['top'],
          renderKey: 'test-top',
          ownershipScope: 'shared',
          saleStatus: 'held',
        },
        {
          id: hat,
          kind: 'clothing',
          slot: 'hat',
          occupiesSlots: ['hat'],
          renderKey: 'test-hat',
          ownershipScope: 'shared',
          saleStatus: 'held',
        },
      ],
    });
    await db.avatarOwnership.createMany({
      data: [top, hat].map((productId) => ({
        userId: a.id,
        productId,
        source: 'purchase',
      })),
    });
    await db.avatarProduct.create({
      data: {
        id: top2,
        kind: 'clothing',
        slot: 'top',
        occupiesSlots: ['top'],
        renderKey: 'test-top2',
        ownershipScope: 'shared',
        saleStatus: 'held',
      },
    });
    await save(a, { ...defaultOutfit, clothingIds: [top, top2] })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: 'SLOT_CONFLICT' }),
      );
    const outfit = { ...defaultOutfit, clothingIds: [hat, top] };
    await save(a, outfit).expect(422);
    await db.$transaction((tx) =>
      tx.avatarCombination.create({
        data: {
          id: combinationId(outfit),
          characterId: outfit.characterId,
          poseId: outfit.poseId,
          items: { create: [hat, top].map((productId) => ({ productId })) },
        },
      }),
    );
    await save(a, outfit).expect(200);
    await save(a, { ...outfit, characterId: 'character.gray' }, 2).expect(422);
    expect((await service.outfit(a.id)).clothingIds).toEqual([hat, top].sort());
  });

  it('returns exactly the saved outfit to group members without financial details and denies outsiders', async () => {
    const owner = await register();
    const member = await register();
    const outsider = await register();
    const groups = app.get(GroupsService);
    const group = await groups.create(owner.id, randomUUID(), {
      name: '코디 테스트',
      description: '',
      maxMembers: 3,
    });
    const code = await groups.inviteCode(owner.id, group.id);
    const application = await groups.apply(
      member.id,
      randomUUID(),
      code.inviteCode,
    );
    await groups.decide(owner.id, group.id, application.id, 'approved');
    await fund(owner);
    await buy(owner).expect(201);
    const saved = await save(owner, {
      ...defaultOutfit,
      characterId: 'character.gray',
      poseId: 'pose.run',
    }).expect(200);
    const path = `/groups/${group.id}/members/${owner.id}`;
    const result = await api(member, 'get', path).expect(200);
    expect(result.body).toMatchObject({
      userId: owner.id,
      profileCharacter: saved.body,
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /currency|balance|inventory|purchase|email|password/,
    );
    await api(outsider, 'get', path).expect(403);
    await api(outsider, 'get', `/groups/${group.id}`).expect(403);
    await save(owner, defaultOutfit, 2).expect(200);
    const changed = await api(member, 'get', path).expect(200);
    expect(changed.body).toMatchObject({
      profileCharacter: { ...defaultOutfit, revision: 3 },
    });
  });

  it('deduplicates internal grants, rejects conflicting/overflow grants and exposes no public grant route', async () => {
    const a = await register();
    const event = `test:${randomUUID()}`;
    const results = await Promise.all([
      service.grantCurrency(a.id, event, 100),
      service.grantCurrency(a.id, event, 100),
    ]);
    expect(
      results.map((r) => r.replayed).sort((a, b) => Number(a) - Number(b)),
    ).toEqual([false, true]);
    expect(await balance(a)).toBe(100);
    await expect(service.grantCurrency(a.id, event, 101)).rejects.toMatchObject(
      { status: 409 },
    );
    await expect(
      service.grantCurrency(a.id, `test:${randomUUID()}`, 2147483647),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.grantCurrency(a.id, 'purchase:spoof', 100),
    ).rejects.toMatchObject({ status: 400 });
    await api(a, 'post', '/users/me/avatar/grants')
      .send({ amount: 1000 })
      .expect(404);
    await api(a, 'post', '/shop/grants').send({ amount: 1000 }).expect(404);
    expect(await balance(a)).toBe(100);
  });

  it('requires authentication, CSRF, JSON, strict input and revision headers', async () => {
    const a = await register();
    for (const path of [
      '/shop/products',
      '/users/me/avatar/inventory',
      '/users/me/avatar/outfit',
    ])
      await request(app.getHttpServer()).get(`/api/v1${path}`).expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/shop/purchases')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ productId: 'pose.run', catalogRevision: 1 })
      .expect(403);
    await buy(a).set('Origin', 'https://untrusted.test').expect(403);
    await api(a, 'post', '/shop/purchases')
      .send({ productId: 'pose.run', catalogRevision: 1 })
      .expect(400);
    await api(a, 'put', '/users/me/avatar/outfit')
      .send(defaultOutfit)
      .expect(428);
    await api(a, 'put', '/users/me/avatar/outfit')
      .set('If-Match', '*')
      .send(defaultOutfit)
      .expect(400);
    await api(a, 'put', '/users/me/avatar/outfit')
      .set('If-Match', '"1"')
      .send({ ...defaultOutfit, userId: randomUUID() })
      .expect(400);
    expect(await balance(a)).toBe(0);
  });
  it('purchases future registered clothing at stored slot prices without auto-equipping', async () => {
    const a = await register();
    await fund(a, 100);
    const productId = `clothing.test-sale-${randomUUID()}`;
    const input = { ...defaultOutfit, clothingIds: [productId] };
    await db.$transaction(async (tx) => {
      await tx.avatarProduct.create({
        data: {
          id: productId,
          kind: 'clothing',
          slot: 'top',
          occupiesSlots: ['top'],
          renderKey: 'test-only-separated-top',
          ownershipScope: 'shared',
          saleStatus: 'on_sale',
          price: 25,
        },
      });
      for (const characterId of ['character.cream', 'character.gray']) {
        await tx.avatarCombination.create({
          data: {
            id: combinationId({ ...input, characterId }),
            characterId,
            poseId: input.poseId,
            items: { create: { productId } },
          },
        });
      }
    });
    await save(a, input).expect(403);
    await buy(a, productId)
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          purchase: { price: 25 },
          currency: { balance: 75 },
        }),
      );
    expect(await service.outfit(a.id)).toMatchObject(defaultOutfit);
    await save(a, input).expect(200);
    await save(a, { ...input, characterId: 'character.gray' }, 2).expect(200);
    await buy(a, productId).expect(409);
    expect(await balance(a)).toBe(75);
  });

  it('serializes an in-flight price update before purchase and rejects the stale quote without charging', async () => {
    const a = await register();
    await fund(a);
    const product = await db.avatarProduct.findUniqueOrThrow({
      where: { id: 'pose.stretch' },
    });
    let unlock!: () => void;
    let locked!: () => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const changing = db.$transaction(async (tx) => {
      await tx.avatarProduct.update({
        where: { id: product.id },
        data: { price: 61 },
      });
      locked();
      await release;
    });
    await ready;
    const buying = service
      .purchase(a.id, randomUUID(), {
        productId: product.id,
        catalogRevision: product.catalogRevision,
      })
      .then(
        () => 'unexpected success',
        (error: unknown) => error,
      );
    try {
      await vi.waitFor(
        async () => {
          const waiting = await db.$queryRaw<
            Array<{ count: number }>
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${'%' + db.table('avatar_products').sql + '%'} AND query LIKE '%FOR SHARE%'`;
          expect(waiting[0].count).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );
      unlock();
      await changing;
      expect(await buying).toMatchObject({
        status: 409,
        response: { code: 'CATALOG_CHANGED' },
      });
      expect(await balance(a)).toBe(200);
      expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(
        0,
      );
    } finally {
      unlock();
      await changing;
      await buying;
      await db.avatarProduct.update({
        where: { id: product.id },
        data: { price: product.price },
      });
    }
  });
  const batchItems = () =>
    ['pose.curious', 'pose.run'].map((productId) => ({
      productId,
      catalogRevision: revisions.get(productId)!,
    }));
  const buyBatch = (a: Account, items = batchItems(), key = randomUUID()) =>
    api(a, 'post', '/shop/purchases/batch')
      .set('Idempotency-Key', key)
      .send({ items });

  it('atomically rejects the whole batch when only the first item is affordable', async () => {
    const a = await register();
    await fund(a, 70);
    await buyBatch(a)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('INSUFFICIENT_FUNDS'));
    expect(await balance(a)).toBe(70);
    expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(0);
    expect(
      await db.avatarPurchaseBatch.count({ where: { userId: a.id } }),
    ).toBe(0);
    expect(
      await db.currencyTransaction.count({
        where: { userId: a.id, kind: 'purchase' },
      }),
    ).toBe(0);
    expect(await db.avatarOwnership.count({ where: { userId: a.id } })).toBe(3);
  });

  it('purchases at the exact total, replays reordered concurrent batches once, and keeps the outfit', async () => {
    const a = await register();
    await fund(a, 120);
    const key = randomUUID();
    const result = await Promise.all([
      buyBatch(a, batchItems(), key),
      buyBatch(a, batchItems().reverse(), key),
    ]);
    expect(result.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ]);
    for (const r of result) {
      expect(r.body).toMatchObject({
        totalPrice: 120,
        currency: { balance: 0 },
      });
      expect(r.body.purchases).toHaveLength(2);
      expect(r.headers['idempotency-replayed']).toBe(String(r.body.replayed));
    }
    expect(result[0].body.purchases).toEqual(result[1].body.purchases);
    expect(
      await db.avatarPurchaseBatch.count({ where: { userId: a.id } }),
    ).toBe(1);
    expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(2);
    expect(
      await db.currencyTransaction.count({
        where: { userId: a.id, kind: 'purchase' },
      }),
    ).toBe(2);
    expect(await service.outfit(a.id)).toMatchObject({
      ...defaultOutfit,
      revision: 1,
    });
    const changed = batchItems().map((item, i) => ({
      ...item,
      catalogRevision: item.catalogRevision + i,
    }));
    await buyBatch(a, changed, key)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('IDEMPOTENCY_CONFLICT'));
    await buy(a, 'pose.curious', key)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('IDEMPOTENCY_CONFLICT'));
  });

  it('does not reuse a single purchase key for a batch or purchase already owned products', async () => {
    const a = await register();
    await fund(a);
    const key = randomUUID();
    await buy(a, 'pose.run', key).expect(201);
    await buyBatch(a, batchItems(), key)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('IDEMPOTENCY_CONFLICT'));
    await buyBatch(a)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ALREADY_OWNED'));
    expect(await balance(a)).toBe(130);
    expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(1);
    expect(
      await db.avatarPurchaseBatch.count({ where: { userId: a.id } }),
    ).toBe(0);
  });

  it('rolls back earlier items when a later batch item has a stale revision or is unavailable', async () => {
    const a = await register();
    await fund(a);
    const items = batchItems();
    items[1].catalogRevision++;
    await buyBatch(a, items)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('CATALOG_CHANGED'));
    await buyBatch(a, [
      batchItems()[0],
      { productId: 'pose.basic', catalogRevision: 1 },
    ]).expect(409);
    await buyBatch(a, [
      batchItems()[0],
      { productId: 'pose.zz-missing', catalogRevision: 1 },
    ]).expect(404);
    expect(await balance(a)).toBe(200);
    expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(0);
    expect(
      await db.avatarPurchaseBatch.count({ where: { userId: a.id } }),
    ).toBe(0);
  });

  it('serializes overlapping batch and single purchases without partial batches or double charges', async () => {
    const a = await register();
    await fund(a, 120);
    const results = await Promise.all([buyBatch(a), buy(a, 'pose.run')]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const batchWon = results[0].status === 201;
    expect(await balance(a)).toBe(batchWon ? 0 : 50);
    expect(await db.avatarPurchase.count({ where: { userId: a.id } })).toBe(
      batchWon ? 2 : 1,
    );
    expect(
      await db.avatarPurchaseBatch.count({ where: { userId: a.id } }),
    ).toBe(batchWon ? 1 : 0);
  });

  it('requires batch authentication, CSRF, a request key and 2–4 unique strict items', async () => {
    const a = await register();
    await request(app.getHttpServer())
      .post('/api/v1/shop/purchases/batch')
      .send({ items: batchItems() })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/shop/purchases/batch')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ items: batchItems() })
      .expect(403);
    await buyBatch(a).set('Origin', 'https://untrusted.test').expect(403);
    await api(a, 'post', '/shop/purchases/batch')
      .send({ items: batchItems() })
      .expect(400);
    for (const body of [
      { items: [] },
      { items: [batchItems()[0]] },
      { items: [batchItems()[0], batchItems()[0]] },
      {
        items: Array.from({ length: 5 }, (_, n) => ({
          productId: `pose.test-${n}`,
          catalogRevision: 1,
        })),
      },
      { items: batchItems(), price: 1 },
      { items: batchItems().map((p) => ({ ...p, price: 1 })) },
    ])
      await api(a, 'post', '/shop/purchases/batch')
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(400);
    expect(await balance(a)).toBe(0);
  });
});
