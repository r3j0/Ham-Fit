import 'reflect-metadata';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../dist/database/database.service.js';
import { loadCatalog } from '../dist/recommendations/catalog.js';
import { WorkoutCatalogService } from '../dist/recommendations/workout-catalog.service.js';

config({ quiet: true });
if (!process.env.DATABASE_URL)
  throw new Error(
    'DATABASE_URL is required; verify the intended environment before importing.',
  );
const catalog = loadCatalog(process.argv[2]);
const database = new DatabaseService(
  new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
);
try {
  await database.onModuleInit();
  console.log(
    JSON.stringify(await new WorkoutCatalogService(database).activate(catalog)),
  );
} finally {
  await database.onModuleDestroy();
}
