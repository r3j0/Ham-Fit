import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
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
import type {
  AxisEvaluation,
  ItemEvaluation,
} from '../src/measurements/evaluation/evaluation-types.js';
import { configureApp } from '../src/setup-app.js';

type Account = { user: { id: string }; access_token: string };
type Item = {
  measurementCode: string;
  value: string;
  unit: string;
  reportedGrade?: string | null;
  evaluation: ItemEvaluation;
};
type RecordBody = {
  id: string;
  measuredOn: string;
  revision: number;
  ageAtMeasurement: number;
  sexAtMeasurement: string | null;
  reportKind: string;
  centerName: string | null;
  reportedOverallGrade: string | null;
  createdAt: string;
  updatedAt: string;
  sourceProgram: string;
  entryMethod: string;
  items: Item[];
  catalogVersion: string;
  missingMeasurementCodes: string[];
  evaluation: { status: string; reason: string };
  axes: AxisEvaluation[];
};
type Catalog = {
  version: string;
  checkedOn: string;
  definitions: Array<{
    code: string;
    factor: string;
    unit: string;
    sourceUrls: string[];
    availableForNewMeasurements: boolean;
    unavailabilityReason: string | null;
  }>;
};
type ListBody = {
  items: Array<{ id: string; itemCount: number }>;
  nextCursor: string | null;
};

describe('Authenticated measurement CRUD against PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let owner: Account;
  let other: Account;
  let version: string;
  const userIds: string[] = [];
  let afterMeasurementRead:
    { id: string; latest?: boolean; run: () => Promise<unknown> } | undefined;
  // The spy below explicitly supplies the original factory as this via call().
  // oxlint-disable-next-line typescript/unbound-method
  const connect = PrismaPg.prototype.connect;
  const connectionSpy = vi.spyOn(PrismaPg.prototype, 'connect');

  beforeAll(async () => {
    connectionSpy.mockImplementation(async function (this: PrismaPg) {
      const adapter = await connect.call(this);
      const intercept = (queryable: Pick<typeof adapter, 'queryRaw'>) => {
        const queryRaw = queryable.queryRaw.bind(queryable);
        queryable.queryRaw = async (query) => {
          const result = await queryRaw(query);
          if (
            afterMeasurementRead &&
            query.sql.trimStart().startsWith('SELECT') &&
            /FROM "[^"]+"\."measurements"/.test(query.sql) &&
            (query.args.includes(afterMeasurementRead.id) ||
              (afterMeasurementRead.latest &&
                query.args.includes(owner.user.id)))
          ) {
            // The real parent SELECT has finished. Commit another HTTP write
            // before Prisma can issue the related item/catalog SELECTs.
            const { run } = afterMeasurementRead;
            afterMeasurementRead = undefined;
            await run();
          }
          return result;
        };
      };
      intercept(adapter);
      const startTransaction = adapter.startTransaction.bind(adapter);
      adapter.startTransaction = async (...args) => {
        const transaction = await startTransaction(...args);
        intercept(transaction);
        return transaction;
      };
      return adapter;
    });
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
    owner = await register();
    other = await register();
    const catalog = await request(app.getHttpServer())
      .get('/api/v1/measurement-catalog')
      .expect(200);
    version = (catalog.body as Catalog).version;
  });

  beforeEach(async () => {
    afterMeasurementRead = undefined;
    await database.measurementCreateRequest.deleteMany({
      where: { userId: { in: userIds } },
    });
    await database.measurement.deleteMany({
      where: { userId: { in: userIds } },
    });
  });

  afterAll(async () => {
    try {
      await database?.user.deleteMany({ where: { id: { in: userIds } } });
      await app?.close();
    } finally {
      connectionSpy.mockRestore();
    }
  });

  async function register() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `crud-${randomUUID()}@example.test`,
        password: 'measurement integration password',
      })
      .expect(201);
    const account = response.body as Account;
    userIds.push(account.user.id);
    return account;
  }

  function payload(extra: Record<string, unknown> = {}) {
    return {
      catalogVersion: version,
      measuredOn: '2026-09-17',
      ageAtMeasurement: 25,
      items: [{ measurementCode: 'sit_and_reach', value: '-3.25', unit: 'cm' }],
      ...extra,
    };
  }
  function create(body = payload(), key = randomUUID(), account = owner) {
    return request(app.getHttpServer())
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('Idempotency-Key', key)
      .send(body);
  }
  function get(id: string, account = owner) {
    return request(app.getHttpServer())
      .get(`/api/v1/measurements/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`);
  }
  function patch(
    id: string,
    body: Record<string, unknown>,
    revision = 1,
    account = owner,
  ) {
    return request(app.getHttpServer())
      .patch(`/api/v1/measurements/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('If-Match', `"${revision}"`)
      .send(body);
  }
  function remove(id: string, revision = 1, account = owner) {
    return request(app.getHttpServer())
      .delete(`/api/v1/measurements/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('If-Match', `"${revision}"`);
  }
  function list(query: Record<string, string | number> = {}, account = owner) {
    return request(app.getHttpServer())
      .get('/api/v1/measurements')
      .query(query)
      .set('Authorization', `Bearer ${account.access_token}`);
  }

  it('serves the actual versioned catalog and all supported age boundaries', async () => {
    for (const [age, factorCount] of [
      [13, 8],
      [18, 8],
      [19, 7],
      [64, 7],
    ]) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/measurement-catalog')
        .query({ age, version })
        .expect(200);
      const catalog = response.body as Catalog;
      expect(catalog.version).toBe(version);
      expect(catalog.definitions).toHaveLength(age >= 19 ? 17 : 16);
      expect(new Set(catalog.definitions.map((def) => def.factor)).size).toBe(
        factorCount,
      );
      expect(
        catalog.definitions.every((def) => def.sourceUrls.length > 0),
      ).toBe(true);
      expect(
        catalog.definitions.some((def) => def.code === 'repeated_jump'),
      ).toBe(age <= 18);
    }
    const all = await request(app.getHttpServer())
      .get('/api/v1/measurement-catalog')
      .expect(200);
    const latestCatalog = all.body as Catalog;
    expect(latestCatalog.version).toBe('nfa100-2026-09-24-grip-v1');
    expect(latestCatalog.definitions).toHaveLength(21);
    expect(
      latestCatalog.definitions.map((definition) => definition.code),
    ).not.toContain('self_curl_up');
    expect(latestCatalog.definitions).toContainEqual(
      expect.objectContaining({ code: 'curl_up' }),
    );
    expect(
      latestCatalog.definitions.every(
        (definition) =>
          definition.availableForNewMeasurements &&
          definition.unavailabilityReason === null,
      ),
    ).toBe(true);
    const retired = await request(app.getHttpServer())
      .get('/api/v1/measurement-catalog?version=nfa100-2026-09-23')
      .expect(200);
    const retiredCatalog = retired.body as Catalog;
    expect(retiredCatalog.definitions).toHaveLength(21);
    expect(retiredCatalog.definitions).toContainEqual(
      expect.objectContaining({
        code: 'self_curl_up',
        availableForNewMeasurements: false,
        unavailabilityReason: 'official_criteria_unverified',
      }),
    );
    expect(
      retiredCatalog.definitions
        .filter((definition) => definition.code !== 'self_curl_up')
        .every(
          (definition) =>
            definition.availableForNewMeasurements &&
            definition.unavailabilityReason === null,
        ),
    ).toBe(true);
    const previous = await request(app.getHttpServer())
      .get('/api/v1/measurement-catalog?version=nfa100-2026-09-19')
      .expect(200);
    expect((previous.body as Catalog).definitions).toHaveLength(19);
    expect(
      (previous.body as Catalog).definitions.some((definition) =>
        ['self_curl_up', 'ymca_recovery_heart_rate'].includes(definition.code),
      ),
    ).toBe(false);
    await request(app.getHttpServer())
      .get('/api/v1/measurement-catalog?age=65')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/measurement-catalog?version=unknown')
      .expect(404);
  });

  it('persists a partial record and returns only actual values and applicable missing items', async () => {
    const created = await create().expect(201);
    const record = created.body as RecordBody;
    expect(created.headers.etag).toBe('"1"');
    expect(created.headers.location).toBe(`/api/v1/measurements/${record.id}`);
    expect(created.headers['cache-control']).toBe('no-store, no-transform');
    expect(record.items).toEqual([
      {
        measurementCode: 'sit_and_reach',
        value: '-3.25',
        unit: 'cm',
        reportedGrade: null,
        evaluation: expect.objectContaining({
          measurementId: record.id,
          measurementCode: 'sit_and_reach',
          status: 'insufficient_information',
          reasonCode: 'sex_at_measurement_missing',
          grade: null,
          recordRevision: 1,
        }),
      },
    ]);
    expect(record.missingMeasurementCodes).toHaveLength(16);
    expect(record.missingMeasurementCodes).not.toContain('self_curl_up');
    expect(record.missingMeasurementCodes).toContain('height');
    expect(record.missingMeasurementCodes).not.toContain('t_wall_coordination');
    expect(record.sexAtMeasurement).toBeNull();
    expect(record.reportedOverallGrade).toBeNull();
    expect(record.sourceProgram).toBe('nfa100');
    expect(record.entryMethod).toBe('manual');
    expect(record.evaluation.status).toBe('not_evaluated');
    expect(record).not.toHaveProperty('score');
    const stored = await database.measurement.findUniqueOrThrow({
      where: { id: record.id },
      include: { items: true },
    });
    expect(stored.userId).toBe(owner.user.id);
    expect(stored.items[0].value.toFixed()).toBe('-3.25');
    await get(record.id).expect(200, record);
  });

  it('preserves zero, long decimal strings, independent alternatives, and original grades', async () => {
    const response = await create(
      payload({
        reportedOverallGrade: '결과표 원문',
        items: [
          { measurementCode: 'cross_sit_up', value: '0', unit: '회' },
          {
            measurementCode: 'reaction_time',
            value: '0.301234567890123456789',
            unit: '초',
          },
          {
            measurementCode: 'relative_grip_strength',
            value: '105.25',
            unit: '%',
            reportedGrade: '원문 등급',
          },
          { measurementCode: 'shuttle_run_20m', value: '42', unit: '회' },
          {
            measurementCode: 'treadmill_vo2max',
            value: '37.1',
            unit: 'ml/kg/min',
          },
          {
            measurementCode: 'step_test_vo2max',
            value: '36.4',
            unit: 'ml/kg/min',
          },
        ],
      }),
    ).expect(201);
    const record = response.body as RecordBody;
    const values = Object.fromEntries(
      record.items.map((item) => [item.measurementCode, item.value]),
    );
    expect(values).toMatchObject({
      cross_sit_up: '0',
      reaction_time: '0.301234567890123456789',
      relative_grip_strength: '105.25',
    });
    expect(record.items).toHaveLength(6);
    expect(record.reportedOverallGrade).toBe('결과표 원문');
    expect(
      record.items.find(
        (item) => item.measurementCode === 'relative_grip_strength',
      )?.reportedGrade,
    ).toBe('원문 등급');
  });

  it.each([
    { measuredOn: '2025-02-29' },
    { measuredOn: '2999-01-01' },
    { ageAtMeasurement: 12 },
    { ageAtMeasurement: 65 },
    { ageAtMeasurement: '25' },
    { sexAtMeasurement: 'guessed' },
    { items: [] },
    { catalogVersion: 'unknown' },
    { userId: 'untrusted-owner' },
    { sourceProgram: 'self_test' },
    { revision: 100 },
    { entryMethod: 'ocr' },
    { centerName: '' },
  ])(
    'rejects invalid input without storing partial data: %j',
    async (extra) => {
      await create(payload(extra)).expect(400);
      expect(
        await database.measurement.count({ where: { userId: owner.user.id } }),
      ).toBe(0);
      expect(
        await database.measurementCreateRequest.count({
          where: { userId: owner.user.id },
        }),
      ).toBe(0);
    },
  );

  it.each(['', ' ', 'NaN', 'Infinity', '1e-3', null, false, 0, 0.1])(
    'never coerces an invalid decimal into a saved value: %j',
    async (value) => {
      await create(
        payload({ items: [{ measurementCode: 'height', value, unit: 'cm' }] }),
      ).expect(400);
    },
  );

  it.each([
    ['relative_grip_strength', '32', 'kg', 'unit'],
    ['repeated_jump', '20', '회', 'measurementCode'],
    ['cross_sit_up', '1.5', '회', 'value'],
    ['cross_sit_up', '-1', '회', 'value'],
    ['body_fat_percentage', '101', '%', 'value'],
    ['reaction_time', '0', '초', 'value'],
    ['unknown_measurement', '1', '회', 'measurementCode'],
  ])(
    'returns field-level errors for %s',
    async (measurementCode, value, unit, field) => {
      const response = await create(
        payload({ items: [{ measurementCode, value, unit }] }),
      ).expect(400);
      expect(
        (response.body as { errors: Array<{ field: string }> }).errors.some(
          (error) => error.field === `items.0.${field}`,
        ),
      ).toBe(true);
    },
  );

  it('rejects duplicate codes and collects invalid item fields without partial saving', async () => {
    const item = { measurementCode: 'height', value: '165', unit: 'cm' };
    await create(payload({ items: [item, item] })).expect(400);
    const invalid = await create(
      payload({
        items: [item, { measurementCode: 'height', value: '-1', unit: 'kg' }],
      }),
    ).expect(400);
    expect(
      (invalid.body as { errors: unknown[] }).errors.length,
    ).toBeGreaterThan(0);
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
  });

  it('requires authentication for every private route and rejects spoofed owners', async () => {
    const id = randomUUID();
    await request(app.getHttpServer()).get('/api/v1/measurements').expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/measurements/${id}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/measurements')
      .send(payload())
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/measurements/${id}`)
      .send({ centerName: 'test' })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/measurements/${id}`)
      .expect(401);
    await create(payload({ userId: other.user.id })).expect(400);
    await list({ userId: other.user.id }).expect(400);
  });

  it('hides other users records on read, update, and delete', async () => {
    const record = (await create().expect(201)).body as RecordBody;
    const missing = await get(randomUUID(), other).expect(404);
    const denied = await get(record.id, other).expect(404);
    expect(denied.body).toEqual(missing.body);
    await patch(record.id, { centerName: 'changed' }, 1, other).expect(404);
    await remove(record.id, 1, other).expect(404);
    await get(record.id).expect(200, record);
    await list({}, other).expect(200, { items: [], nextCursor: null });
  });

  it('deduplicates retries and normalized item order but not distinct requests on the same date', async () => {
    const key = randomUUID();
    const body = payload({
      items: [
        { measurementCode: 'height', value: '165.00', unit: 'cm' },
        { measurementCode: 'weight', value: '60', unit: 'kg' },
      ],
    });
    const first = await create(body, key).expect(201);
    const replay = await create(
      payload({
        items: [
          { measurementCode: 'weight', value: '60.0', unit: 'kg' },
          { measurementCode: 'height', value: '165', unit: 'cm' },
        ],
      }),
      key,
    ).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await create(body).expect(201);
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(2);
  });

  it('requires a request key and rejects reuse for different inputs', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .send(payload())
      .expect(400);
    const key = randomUUID();
    const first = await create(payload(), key).expect(201);
    await create(payload({ centerName: 'different' }), key).expect(409);
    await get((first.body as RecordBody).id).expect(200, first.body);
  });

  it('isolates request keys by user and handles simultaneous retries', async () => {
    const key = randomUUID();
    const responses = await Promise.all([
      create(payload(), key),
      create(payload(), key),
    ]);
    expect(
      responses.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 201]);
    expect((responses[0].body as RecordBody).id).toBe(
      (responses[1].body as RecordBody).id,
    );
    const another = await create(payload(), key, other).expect(201);
    expect((another.body as RecordBody).id).not.toBe(
      (responses[0].body as RecordBody).id,
    );
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(1);
  });

  it('rolls back a reserved key on validation failure, allowing a corrected retry', async () => {
    const key = randomUUID();
    await create(payload({ catalogVersion: 'unknown' }), key).expect(400);
    expect(
      await database.measurementCreateRequest.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
    await create(payload(), key).expect(201);
  });

  it('updates supplied fields, replaces items atomically, and increments revision', async () => {
    const key = randomUUID();
    const original = (
      await create(
        payload({ centerName: 'original', sexAtMeasurement: 'female' }),
        key,
      )
    ).body as RecordBody;
    const changed = await patch(original.id, {
      centerName: null,
      items: [{ measurementCode: 'weight', value: '61.25', unit: 'kg' }],
    }).expect(200);
    const record = changed.body as RecordBody;
    expect(record.revision).toBe(2);
    expect(changed.headers.etag).toBe('"2"');
    expect(record.centerName).toBeNull();
    expect(record.sexAtMeasurement).toBe('female');
    expect(record.createdAt).toBe(original.createdAt);
    expect(record.items).toEqual([
      {
        measurementCode: 'weight',
        value: '61.25',
        unit: 'kg',
        reportedGrade: null,
        evaluation: expect.objectContaining({
          measurementId: record.id,
          measurementCode: 'weight',
          status: 'criteria_unavailable',
          grade: null,
          recordRevision: 2,
        }),
      },
    ]);
    expect(record.missingMeasurementCodes).toContain('sit_and_reach');
    expect(new Date(record.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(original.updatedAt).getTime(),
    );
    const retry = await create(
      payload({ centerName: 'original', sexAtMeasurement: 'female' }),
      key,
    ).expect(200);
    expect(retry.body).toEqual(record);
    await patch(record.id, { items: [] }, 2).expect(400);
    await get(record.id).expect(200, record);
  });

  it('revalidates existing items after age changes and accepts a valid replacement', async () => {
    const original = (
      await create(
        payload({
          ageAtMeasurement: 18,
          items: [
            { measurementCode: 'repeated_jump', value: '20', unit: '회' },
          ],
        }),
      ).expect(201)
    ).body as RecordBody;
    await patch(original.id, { ageAtMeasurement: 19 }).expect(400);
    await get(original.id).expect(200, original);
    const changed = await patch(original.id, {
      ageAtMeasurement: 19,
      items: [{ measurementCode: 'cross_sit_up', value: '21', unit: '회' }],
    }).expect(200);
    expect((changed.body as RecordBody).revision).toBe(2);
  });

  it.each([
    ['GET', 'PATCH'],
    ['GET', 'DELETE'],
    ['GET latest', 'PATCH'],
    ['GET latest', 'DELETE'],
    ['POST replay', 'PATCH'],
    ['POST replay', 'DELETE'],
  ] as const)(
    'returns one snapshot when %s overlaps a committed %s',
    async (read, write) => {
      const key = randomUUID();
      const body = payload({
        ageAtMeasurement: 18,
        items: [{ measurementCode: 'repeated_jump', value: '20', unit: '회' }],
      });
      const original = (await create(body, key).expect(201)).body as RecordBody;
      const change = vi.fn(async () => {
        if (write === 'DELETE') return remove(original.id).expect(204);
        return patch(original.id, {
          ageAtMeasurement: 19,
          items: [{ measurementCode: 'cross_sit_up', value: '21', unit: '회' }],
        }).expect(200);
      });
      afterMeasurementRead = {
        id: original.id,
        latest: read === 'GET latest',
        run: change,
      };
      try {
        const response = await (
          read === 'GET'
            ? get(original.id)
            : read === 'GET latest'
              ? get('latest-polygon')
              : create(body, key)
        ).expect(200);
        expect(change).toHaveBeenCalledTimes(1);
        if (read === 'GET latest') {
          expect(response.body).toEqual({
            measurementId: original.id,
            measuredOn: original.measuredOn,
            revision: original.revision,
            axes: original.axes,
          });
        } else {
          expect(response.headers.etag).toBe('"1"');
          expect(response.body).toEqual(original);
        }
        if (read === 'POST replay') {
          expect(response.headers['idempotency-replayed']).toBe('true');
        }
        // A later request must observe the committed write, not a cached record.
        if (write === 'DELETE') {
          await get(original.id).expect(404);
          await create(body, key).expect(410);
        } else {
          const updated = await get(original.id).expect(200);
          expect(updated.headers.etag).toBe('"2"');
          expect(updated.body).toMatchObject({
            ageAtMeasurement: 19,
            revision: 2,
            items: [
              { measurementCode: 'cross_sit_up', value: '21', unit: '회' },
            ],
          });
          await create(body, key).expect(200, updated.body);
        }
      } finally {
        afterMeasurementRead = undefined;
      }
    },
  );

  it('requires write preconditions and rejects stale or empty changes', async () => {
    const original = (await create().expect(201)).body as RecordBody;
    const path = `/api/v1/measurements/${original.id}`;
    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${owner.access_token}`)
      .send({ centerName: 'test' })
      .expect(428);
    await request(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${owner.access_token}`)
      .expect(428);
    await patch(original.id, {}).expect(400);
    await patch(original.id, { catalogVersion: version }).expect(400);
    await patch(original.id, { userId: other.user.id }).expect(400);
    await patch(original.id, { centerName: 'updated' }).expect(200);
    await patch(original.id, { centerName: 'stale' }).expect(412);
    await remove(original.id).expect(412);
    expect(((await get(original.id)).body as RecordBody).centerName).toBe(
      'updated',
    );
  });

  it('allows only one concurrent update of the same revision', async () => {
    const original = (await create().expect(201)).body as RecordBody;
    const responses = await Promise.all([
      patch(original.id, {
        items: [{ measurementCode: 'height', value: '165', unit: 'cm' }],
      }),
      patch(original.id, {
        items: [{ measurementCode: 'weight', value: '62', unit: 'kg' }],
      }),
    ]);
    expect(
      responses.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 412]);
    const success = responses.find((result) => result.status === 200)!;
    await get(original.id).expect(200, success.body);
    expect((success.body as RecordBody).revision).toBe(2);
  });

  it('returns 412 instead of item validation errors when another PATCH changes the age and items', async () => {
    const original = (
      await create(
        payload({
          ageAtMeasurement: 18,
          items: [
            { measurementCode: 'repeated_jump', value: '20', unit: '회' },
          ],
        }),
      ).expect(201)
    ).body as RecordBody;
    let winner: RecordBody | undefined;
    const change = vi.fn(async () => {
      winner = (
        await patch(original.id, {
          ageAtMeasurement: 19,
          items: [{ measurementCode: 'cross_sit_up', value: '21', unit: '회' }],
        }).expect(200)
      ).body as RecordBody;
    });
    afterMeasurementRead = { id: original.id, run: change };
    try {
      await patch(original.id, { centerName: 'stale center' }).expect(412);
      expect(change).toHaveBeenCalledTimes(1);
      expect(winner?.revision).toBe(2);
      const latest = await get(original.id).expect(200);
      expect(latest.body).toEqual(winner);
      expect((latest.body as RecordBody).centerName).toBeNull();

      const retried = await patch(
        original.id,
        { centerName: 'updated center' },
        2,
      ).expect(200);
      expect(retried.headers.etag).toBe('"3"');
      expect(retried.body).toEqual({
        ...winner,
        centerName: 'updated center',
        revision: 3,
        updatedAt: (retried.body as RecordBody).updatedAt,
        items: winner!.items.map((item) => ({
          ...item,
          evaluation: {
            ...item.evaluation,
            recordRevision: 3,
            evaluatedAt: expect.any(String),
          },
        })),
        axes: winner!.axes.map((axis) => ({ ...axis, recordRevision: 3 })),
      });
    } finally {
      afterMeasurementRead = undefined;
    }
  });

  it('rolls back metadata and revision and releases the row lock when PATCH item validation fails', async () => {
    const original = (await create().expect(201)).body as RecordBody;
    await patch(original.id, {
      centerName: 'must not persist',
      measuredOn: '2026-09-16',
      items: [{ measurementCode: 'cross_sit_up', value: '1.5', unit: '회' }],
    }).expect(400);
    await get(original.id).expect(200, original);

    const updated = await patch(original.id, {
      centerName: 'valid retry',
    }).expect(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(updated.body).toEqual({
      ...original,
      centerName: 'valid retry',
      revision: 2,
      updatedAt: (updated.body as RecordBody).updatedAt,
      items: original.items.map((item) => ({
        ...item,
        evaluation: {
          ...item.evaluation,
          recordRevision: 2,
          evaluatedAt: expect.any(String),
        },
      })),
      axes: original.axes.map((axis) => ({ ...axis, recordRevision: 2 })),
    });
  });

  it('deletes the record and items while preventing a retried create from resurrecting it', async () => {
    const key = randomUUID();
    const original = (await create(payload(), key).expect(201))
      .body as RecordBody;
    await remove(original.id).expect(204);
    await get(original.id).expect(404);
    await remove(original.id).expect(404);
    expect(
      await database.measurementItem.count({
        where: { measurementId: original.id },
      }),
    ).toBe(0);
    await create(payload(), key).expect(410);
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
    const tombstone = await database.measurementCreateRequest.findUniqueOrThrow(
      { where: { userId_key: { userId: owner.user.id, key } } },
    );
    expect(tombstone.measurementId).toBeNull();
  });

  it('serializes concurrent deletion and update without reviving a deleted record', async () => {
    const original = (await create().expect(201)).body as RecordBody;
    const [updated, deleted] = await Promise.all([
      patch(original.id, { centerName: 'changed' }),
      remove(original.id),
    ]);
    if (deleted.status === 204) {
      expect(updated.status).toBe(404);
      await get(original.id).expect(404);
    } else {
      expect(deleted.status).toBe(412);
      expect(updated.status).toBe(200);
      await get(original.id).expect(200, updated.body);
    }
  });

  it('paginates by measurement date, creation time and ID without exposing another user records', async () => {
    const records: RecordBody[] = [];
    for (const measuredOn of [
      '2026-09-15',
      '2026-09-17',
      '2026-09-17',
      '2026-09-16',
      '2026-09-17',
    ]) {
      records.push(
        (await create(payload({ measuredOn })).expect(201)).body as RecordBody,
      );
    }
    await create(
      payload({ measuredOn: '2026-09-18' }),
      randomUUID(),
      other,
    ).expect(201);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await list({
        limit: 2,
        ...(cursor ? { cursor } : {}),
      }).expect(200);
      const page = response.body as {
        items: Array<{ id: string; itemCount: number }>;
        nextCursor: string | null;
      };
      expect(page.items.every((item) => item.itemCount === 1)).toBe(true);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      expect(seen.length).toBeLessThanOrEqual(records.length);
    } while (cursor);
    expect(seen).toEqual(
      records
        .sort(
          (a, b) =>
            b.measuredOn.localeCompare(a.measuredOn) ||
            b.createdAt.localeCompare(a.createdAt) ||
            a.id.localeCompare(b.id),
        )
        .map((record) => record.id),
    );
    const filtered = await list({
      from: '2026-09-16',
      to: '2026-09-16',
    }).expect(200);
    expect((filtered.body as { items: unknown[] }).items).toHaveLength(1);
    await list({ limit: 0 }).expect(400);
    await list({ limit: 51 }).expect(400);
    await list({ cursor: 'invalid' }).expect(400);
    await list({ from: '2026-09-17', to: '2026-09-16' }).expect(400);
    await get('not-a-uuid').expect(400);
  });

  async function sameDayRecords() {
    const records: RecordBody[] = [];
    for (let index = 0; index < 4; index++) {
      records.push((await create().expect(201)).body as RecordBody);
    }
    records.sort((a, b) => a.id.localeCompare(b.id));
    // Creation order deliberately disagrees with ID order. The last three
    // timestamps share one JS millisecond and the last two tie exactly.
    const times = [
      '2026-09-20T00:00:00.100000Z',
      '2026-09-20T00:00:00.200123Z',
      '2026-09-20T00:00:00.200456Z',
      '2026-09-20T00:00:00.200456Z',
    ];
    for (const [index, record] of records.entries()) {
      await database.$executeRaw`
        UPDATE ${database.table('measurements')}
        SET created_at = ${times[index]}::timestamptz
        WHERE id = ${record.id}::uuid
      `;
    }
    return records;
  }

  it.each([1, 2, 50])(
    'matches the latest polygon and preserves sub-millisecond ties with page size %i',
    async (limit) => {
      const records = await sameDayRecords();
      const olderDay = (
        await create(payload({ measuredOn: '2026-09-16' })).expect(201)
      ).body as RecordBody;
      await create(payload(), randomUUID(), other).expect(201);
      const expected = [
        records[2],
        records[3],
        records[1],
        records[0],
        olderDay,
      ].map(({ id }) => id);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await list({
          limit,
          ...(cursor ? { cursor } : {}),
        }).expect(200);
        const page = response.body as ListBody;
        seen.push(...page.items.map(({ id }) => id));
        cursor = page.nextCursor;
        expect(seen.length).toBeLessThanOrEqual(expected.length);
      } while (cursor);
      expect(seen).toEqual(expected);
      const latest = await request(app.getHttpServer())
        .get('/api/v1/measurements/latest-polygon')
        .set('Authorization', `Bearer ${owner.access_token}`)
        .expect(200);
      expect((latest.body as { measurementId: string }).measurementId).toBe(
        seen[0],
      );
      const filtered = (
        await list({ from: '2026-09-17', to: '2026-09-17' }).expect(200)
      ).body as ListBody;
      expect(filtered.items.map(({ id }) => id)).toEqual(expected.slice(0, 4));
    },
  );

  it('continues after a deleted cursor row and excludes newly inserted rows above its boundary', async () => {
    const records = await sameDayRecords();
    const first = (await list({ limit: 1 }).expect(200)).body as ListBody;
    expect(first.items[0].id).toBe(records[2].id);
    expect(
      JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString()),
    ).toMatchObject({
      v: 2,
      createdAt: '2026-09-20T00:00:00.200456Z',
    });
    await remove(records[2].id).expect(204);
    await create().expect(201);
    const rest = (
      await list({ cursor: first.nextCursor!, limit: 50 }).expect(200)
    ).body as ListBody;
    expect(rest.items.map(({ id }) => id)).toEqual(
      [records[3], records[1], records[0]].map(({ id }) => id),
    );
    expect(rest.nextCursor).toBeNull();
  });

  it('keeps page boundaries and summaries consistent during concurrent deletion', async () => {
    const records = await sameDayRecords();
    afterMeasurementRead = {
      id: records[2].id,
      latest: true,
      run: () => remove(records[2].id).expect(204),
    };
    const first = (await list({ limit: 1 }).expect(200)).body as ListBody;
    expect(afterMeasurementRead).toBeUndefined();
    expect(first.items).toEqual([
      expect.objectContaining({ id: records[2].id, itemCount: 1 }),
    ]);
    await get(records[2].id).expect(404);
    const next = (await list({ cursor: first.nextCursor! }).expect(200))
      .body as ListBody;
    expect(next.items.map(({ id }) => id)).toEqual(
      [records[3], records[1], records[0]].map(({ id }) => id),
    );
  });

  it('does not promote an old record when only its values change', async () => {
    const records = await sameDayRecords();
    const first = (await list({ limit: 2 }).expect(200)).body as ListBody;
    await patch(records[0].id, {
      items: [{ measurementCode: 'sit_and_reach', value: '20', unit: 'cm' }],
    }).expect(200);
    const next = (
      await list({ cursor: first.nextCursor!, limit: 2 }).expect(200)
    ).body as ListBody;
    expect(next.items.map(({ id }) => id)).toEqual([
      records[1].id,
      records[0].id,
    ]);
    const refreshed = (await list({ limit: 2 }).expect(200)).body as ListBody;
    expect(refreshed.items.map(({ id }) => id)).toEqual(
      first.items.map(({ id }) => id),
    );
  });

  it('finishes legacy cursor chains in date/ID order while fresh requests use creation time', async () => {
    const records = await sameDayRecords();
    const originalCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        measuredOn: records[0].measuredOn,
        id: records[0].id,
      }),
    ).toString('base64url');
    await remove(records[0].id).expect(204);
    const next = (await list({ limit: 1, cursor: originalCursor }).expect(200))
      .body as ListBody;
    expect(next.items[0].id).toBe(records[1].id);
    expect(
      JSON.parse(Buffer.from(next.nextCursor!, 'base64url').toString()),
    ).toMatchObject({ v: 1 });
    const rest = (await list({ cursor: next.nextCursor! }).expect(200))
      .body as ListBody;
    expect(rest.items.map(({ id }) => id)).toEqual([
      records[2].id,
      records[3].id,
    ]);
    expect(rest.nextCursor).toBeNull();
    const refreshed = (await list().expect(200)).body as ListBody;
    expect(refreshed.items.map(({ id }) => id)).toEqual([
      records[2].id,
      records[3].id,
      records[1].id,
    ]);
  });

  it('exposes revision and retry headers to the web frontend', async () => {
    const response = await create()
      .set('Origin', 'http://localhost:3000')
      .expect(201);
    expect(response.headers['access-control-expose-headers']).toContain('ETag');
    expect(response.headers['access-control-expose-headers']).toContain(
      'Idempotency-Replayed',
    );
    const preflight = await request(app.getHttpServer())
      .options('/api/v1/measurements')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'Authorization,Content-Type,Idempotency-Key',
      )
      .expect(204);
    expect(preflight.headers['access-control-allow-headers']).toContain(
      'Idempotency-Key',
    );
    expect(preflight.headers['access-control-allow-headers']).toContain(
      'If-Match',
    );
  });

  it('protects strong revision ETags from intermediary transformation on create, replay, read and update', async () => {
    const key = randomUUID();
    const body = payload();
    const created = await create(body, key)
      .set('Origin', 'http://localhost:3000')
      .set('Accept-Encoding', 'gzip, br')
      .expect(201);
    const id = (created.body as RecordBody).id;
    const replay = await create(body, key)
      .set('Origin', 'http://localhost:3000')
      .set('Accept-Encoding', 'gzip, br')
      .expect(200);
    const fetched = await get(id)
      .set('Origin', 'http://localhost:3000')
      .set('Accept-Encoding', 'gzip, br')
      .expect(200);
    const updated = await patch(id, { centerName: 'Updated center' })
      .set('Origin', 'http://localhost:3000')
      .set('Accept-Encoding', 'gzip, br')
      .expect(200);
    for (const [response, revision] of [
      [created, 1],
      [replay, 1],
      [fetched, 1],
      [updated, 2],
    ] as const) {
      expect(response.headers.etag).toBe(`"${revision}"`);
      expect((response.body as RecordBody).revision).toBe(revision);
      expect(response.headers['cache-control']).toBe('no-store, no-transform');
      expect(response.headers['content-encoding']).toBe('identity');
      expect(response.headers['access-control-expose-headers']).toContain(
        'ETag',
      );
    }
    await patch(id, { centerName: 'Stale update' }, 1).expect(412);
    await patch(id, { centerName: 'Weak validator' })
      .set('If-Match', 'W/"2"')
      .expect(400);
  });

  it('uses live authentication state instead of accepting a revoked Bearer token', async () => {
    const account = await register();
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Protection', '1')
      .set('Authorization', `Bearer ${account.access_token}`)
      .expect(204);
    await list({}, account).expect(401);
    await create(payload(), randomUUID(), account).expect(401);
  });
});
