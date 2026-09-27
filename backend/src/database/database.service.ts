import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { databaseOptions } from './database-options.js';

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
      // Both account columns and the catalog must exist, not just the connection.
      const [, definitions] = await this.$transaction([
        this.user.findFirst({
          select: {
            id: true,
            email: true,
            updatedAt: true,
          },
        }),
        this.measurementDefinition.count(),
        this.authSession.findFirst({ select: { id: true } }),
        this.authRefreshToken.findFirst({ select: { createdAt: true } }),
        this.authRateLimit.findFirst({ select: { attempts: true } }),
        this.measurementCreateRequest.findFirst({ select: { key: true } }),
        this.userCurrency.findFirst({ select: { balance: true } }),
        this.userPreference.findFirst({
          select: { exerciseVolume: true, exerciseGoal: true, updatedAt: true },
        }),
        this.workoutCurriculum.findFirst({ select: { id: true } }),
        this.userCurriculumAssignment.findFirst({ select: { id: true } }),
      ]);
      return definitions > 0;
    } catch {
      return false;
    }
  }
}
