// Browser integration fixture only: no production database or shared schema.
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../dist/database/database.service.js';
const url = new URL(process.env.DATABASE_URL ?? 'file:invalid');
const userId = process.argv[2];
if (
  process.env.NODE_ENV !== 'test' ||
  !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '') ||
  !/^postgres(ql)?:$/.test(url.protocol) ||
  !/^[a-f0-9-]{36}$/.test(userId ?? '')
)
  throw new Error(
    'An isolated test database schema and fixture user are required',
  );
const db = new DatabaseService(
  new ConfigService({ DATABASE_URL: url.toString() }),
);
try {
  await db.onModuleInit();
  const [clock] = await db.$queryRaw`SELECT clock_timestamp() AS now`;
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(clock.now);
  const row = await db.workoutRoutine.create({
    data: {
      userId,
      assignmentDate: new Date(day),
      referenceDate: new Date(day),
      algorithmVersion: 'test-only',
      dataVersion: 'test-only',
      estimatedMinutes: 1,
      inputSnapshot: {},
      items: {
        create: {
          order: 1,
          videoId: 'test-only-water',
          title: '[TEST ONLY] water selection',
          videoUrl: 'https://example.test/fixture.mp4',
          durationSeconds: 100,
          slot: 'strength_group',
          prescription: {
            doseType: 'reps',
            value: '10',
            unit: '회',
            sets: 1,
            restSec: 0,
            text: '10회',
          },
        },
      },
    },
    include: { items: true },
  });
  process.stdout.write(
    JSON.stringify({ routineId: row.id, itemId: row.items[0].id }),
  );
} finally {
  await db.onModuleDestroy();
}
