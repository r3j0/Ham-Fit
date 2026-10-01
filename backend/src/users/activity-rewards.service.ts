import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AvatarService } from '../avatar/avatar.service.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { koreanDay } from '../users/member-profile.js';

async function completionEvidence(
  tx: Prisma.TransactionClient,
  userId: string,
  routineId: string,
) {
  const achievement = await tx.activityAchievement.findFirst({
    where: { userId, sourceKind: 'routine', sourceId: routineId },
    select: {
      contributions: {
        select: {
          groupId: true,
          roundId: true,
          round: { select: { group: { select: { name: true } } } },
        },
        orderBy: { groupId: 'asc' },
      },
      streakTickets: { select: { id: true }, orderBy: { id: 'asc' } },
    },
  });
  return {
    waters:
      achievement?.contributions.map((row) => ({
        groupId: row.groupId,
        groupName: row.round.group.name,
        roundId: row.roundId,
        amount: 1,
      })) ?? [],
    personalTicketIds:
      achievement?.streakTickets.map((ticket) => ticket.id) ?? [],
  };
}

// Called after the first whole-routine completion is saved, within its existing
// owner-locked transaction. The stateless shop core supplies the same bounded,
// idempotent currency grant used by both roulettes.
export async function recordRoutineReward(
  database: DatabaseService,
  tx: Prisma.TransactionClient,
  userId: string,
  routineId: string,
  now: Date,
) {
  const koreanDate = new Date(`${koreanDay(now)}T00:00:00Z`);
  if (await tx.routineActivityReward.findUnique({ where: { routineId } }))
    return;
  const granted = await tx.routineActivityReward.findFirst({
    where: { userId, koreanDate, seedStatus: 'granted' },
  });
  let seedStatus = granted ? 'already_granted' : 'granted';
  let transactionId: string | null = null;
  if (!granted) {
    const start = new Date(`${koreanDay(now)}T00:00:00+09:00`);
    // A same-day completion from before this feature consumes the day without
    // a backfill. Legacy daily assignments consume group eligibility only.
    const previous = await tx.workoutRoutine.findFirst({
      where: {
        userId,
        id: { not: routineId },
        items: {
          some: { completedAt: { gte: start, lte: now } },
          every: { status: 'completed', completedAt: { not: null, lte: now } },
        },
      },
      select: { id: true },
    });
    if (previous) seedStatus = 'not_eligible';
    else {
      const result = await new AvatarService(
        database,
      ).grantCurrencyInTransaction(
        tx,
        userId,
        `daily-activity:${koreanDay(now)}`,
        1,
      );
      transactionId = result.transaction.id;
    }
  }
  const evidence = await completionEvidence(tx, userId, routineId);
  await tx.routineActivityReward.create({
    data: {
      routineId,
      userId,
      koreanDate,
      completedAt: now,
      seedStatus,
      transactionId,
      waters: evidence.waters,
      personalTicketIds: evidence.personalTicketIds,
    },
  });
}

@Injectable()
export class ActivityRewardsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  receipt(userId: string, routineId: string) {
    return this.database.$transaction(
      async (tx) => {
        const routine = await tx.workoutRoutine.findFirst({
          where: { id: routineId, userId },
          select: { id: true },
        });
        if (!routine)
          throw new NotFoundException('본인의 운동 루틴을 찾을 수 없습니다.');
        const receipt = await tx.routineActivityReward.findUnique({
          where: { routineId },
        });
        if (!receipt)
          throw new ConflictException({
            statusCode: 409,
            code: 'ACTIVITY_REWARD_NOT_RECORDED',
            message:
              '완료 보상 영수증이 없습니다. 완료 전이거나 도입 전 기록입니다.',
          });
        return {
          routineId,
          koreanDate: receipt.koreanDate.toISOString().slice(0, 10),
          seed: {
            status: receipt.seedStatus,
            amount: receipt.seedStatus === 'granted' ? 1 : 0,
            transactionId: receipt.transactionId,
          },
          waters: receipt.waters,
          personalTicketIds: receipt.personalTicketIds,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
