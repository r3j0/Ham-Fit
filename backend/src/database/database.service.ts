import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { databaseOptions } from './database-options.js';
import { readinessSchema } from './readiness-schema.js';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly dbSchema: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const { schema, ...pool } = databaseOptions(
      config.getOrThrow<string>('DATABASE_URL'),
    );
    super({ adapter: new PrismaPg(pool, { schema }) });
    this.dbSchema = schema;
  }

  // Raw queries must use the same schema as generated Prisma queries.
  table(
    name:
      | 'users'
      | 'avatar_products'
      | 'avatar_ownerships'
      | 'groups'
      | 'group_memberships'
      | 'user_curriculum_assignments'
      | 'measurements'
      | 'user_preferences',
  ) {
    return Prisma.raw(`"${this.dbSchema.replaceAll('"', '""')}"."${name}"`);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      // The pg adapter initializes a lazy pool; only a query verifies access.
      await this.$queryRaw`SELECT 1`;
    } catch {
      await this.$disconnect();
      throw new Error(
        'Database connection failed. Check DATABASE_URL and PostgreSQL availability.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isReady(): Promise<boolean> {
    try {
      // PostgreSQL resolves every CTE's table/columns during parsing, including
      // unused CTEs. The planner discards these checks, so no account/history
      // rows are read. Only the catalog EXISTS executes, in one round trip.
      const checks = readinessSchema.map(
        ({ table, columns }, index) =>
          Prisma.sql`${Prisma.raw(`schema_check_${index}`)} AS (
          SELECT ${Prisma.join(columns.map((column) => Prisma.raw(`"${column}"`)))}
          FROM ${Prisma.raw(`"${this.dbSchema.replaceAll('"', '""')}"."${table}"`)}
          LIMIT 0
        )`,
      );
      const [row] = await this.$queryRaw<Array<{ ready: boolean }>>`
        WITH ${Prisma.join(checks)}
        SELECT EXISTS(SELECT 1 FROM ${Prisma.raw(`"${this.dbSchema.replaceAll('"', '""')}"."measurement_definitions"`)} LIMIT 1) AS ready
      `;
      return row?.ready === true;
    } catch {
      return false;
    }
  }
}
