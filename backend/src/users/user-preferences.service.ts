import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma, UserPreference } from '../generated/prisma/client.js';
import type { UserPreferencesInput } from './user-preferences-input.js';

function serializePreference(row: UserPreference) {
  return {
    exerciseVolume: row.exerciseVolume,
    exerciseGoal: row.exerciseGoal,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function missingPreference(
  database: Pick<Prisma.TransactionClient, 'user'>,
  userId: string,
): Promise<never> {
  // Withdrawal can commit after authentication and cascade-delete preferences.
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user)
    throw new UnauthorizedException(
      '로그인이 필요하거나 세션이 만료되었습니다.',
    );
  throw new ServiceUnavailableException(
    '사용자 운동 설정이 누락되었습니다. 관리자 확인이 필요합니다.',
  );
}

@Injectable()
export class UserPreferencesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async get(userId: string) {
    const row = await this.database.userPreference.findUnique({
      where: { userId },
    });
    if (!row) return missingPreference(this.database, userId);
    return serializePreference(row);
  }

  async update(userId: string, input: UserPreferencesInput) {
    return this.database.$transaction(async (tx) => {
      // Compare only after acquiring the row lock. A waiting request sees the
      // previous writer's committed values, including its updatedAt.
      const rows = await tx.$queryRaw<Array<{ user_id: string }>>`
        SELECT user_id FROM ${this.database.table('user_preferences')}
        WHERE user_id = ${userId}::uuid FOR UPDATE
      `;
      if (!rows.length) return missingPreference(tx, userId);
      const current = await tx.userPreference.findUniqueOrThrow({
        where: { userId },
      });
      const data: Prisma.UserPreferenceUpdateInput = {};
      if (
        input.exerciseVolume !== undefined &&
        input.exerciseVolume !== current.exerciseVolume
      )
        data.exerciseVolume = input.exerciseVolume;
      if (
        input.exerciseGoal !== undefined &&
        input.exerciseGoal !== current.exerciseGoal
      )
        data.exerciseGoal = input.exerciseGoal;
      if (!Object.keys(data).length) return serializePreference(current);

      // Sample the DB clock after the lock. Keep changes distinguishable at
      // the API's millisecond precision, even within the same millisecond.
      const [clock] = await tx.$queryRaw<Array<{ updatedAt: Date }>>`
        SELECT GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') AS "updatedAt"
        FROM ${this.database.table('user_preferences')} WHERE user_id = ${userId}::uuid
      `;
      data.updatedAt = clock.updatedAt;
      return serializePreference(
        await tx.userPreference.update({ where: { userId }, data }),
      );
    });
  }
}
