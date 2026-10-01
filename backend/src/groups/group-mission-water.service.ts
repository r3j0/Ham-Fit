import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service.js';
import { retryTransaction } from '../database/transaction-retry.js';
import { Prisma } from '../generated/prisma/client.js';
import type { GroupMissionWaterChoice } from '../generated/prisma/client.js';
import { koreanDay } from '../users/member-profile.js';
import { MISSION_CLOCK } from './group-missions.service.js';
import { contributeMissionWater } from './mission-contributions.js';
import { missionStage } from './mission-policy.js';

export type WaterSource = {
  sourceKind: 'routine' | 'daily_assignment';
  sourceId: string;
};
const optionsSchema = z.array(
  z.strictObject({
    groupId: z.uuid(),
    groupName: z.string().min(1),
    roundId: z.uuid(),
    participantId: z.uuid(),
  }),
);

@Injectable()
export class GroupMissionWaterService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(MISSION_CLOCK) private readonly clock?: () => Date,
  ) {}
  private transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    read = false,
  ) {
    return retryTransaction(() =>
      this.database.$transaction(work, {
        isolationLevel: read
          ? Prisma.TransactionIsolationLevel.RepeatableRead
          : Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15_000,
      }),
    );
  }
  private async now(tx: Prisma.TransactionClient) {
    if (this.clock) return this.clock();
    const [row] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    return row.now;
  }
  private async source(
    tx: Prisma.TransactionClient,
    userId: string,
    source: WaterSource,
  ) {
    if (source.sourceKind === 'routine') {
      const routine = await tx.workoutRoutine.findFirst({
        where: { id: source.sourceId, userId },
        include: { items: true },
      });
      if (!routine)
        throw new NotFoundException('본인의 운동 루틴을 찾을 수 없습니다.');
      if (
        !routine.items.length ||
        routine.items.some((i) => i.status !== 'completed' || !i.completedAt)
      )
        throw new ConflictException(
          '운동 루틴을 모두 마친 후 물을 줄 수 있습니다.',
        );
      return routine.assignmentDate;
    }
    const assignment = await tx.userCurriculumAssignment.findFirst({
      where: { id: source.sourceId, userId, assignmentDate: { not: null } },
    });
    if (!assignment)
      throw new NotFoundException('본인의 일별 운동을 찾을 수 없습니다.');
    if (assignment.status !== 'completed' || !assignment.completedAt)
      throw new ConflictException('운동을 마친 후 물을 줄 수 있습니다.');
    return assignment.assignmentDate!;
  }
  private async view(
    tx: Prisma.TransactionClient,
    userId: string,
    source: WaterSource,
    date: Date,
    choice: GroupMissionWaterChoice | null,
    now: Date,
  ) {
    const base = { ...source, koreanDate: date.toISOString().slice(0, 10) };
    const unavailable = (reason: string) => ({
      ...base,
      status: 'unavailable' as const,
      reason,
      options: [],
      contribution: null,
    });
    if (!choice) return unavailable('not_first_completion');
    if (choice.selection)
      return {
        ...base,
        status: 'contributed' as const,
        reason: null,
        options: [],
        contribution: choice.selection,
      };
    const frozen = optionsSchema.parse(choice.options);
    if (!frozen.length) return unavailable('no_eligible_missions');
    if (koreanDay(now) !== base.koreanDate) return unavailable('expired');
    const options = [];
    for (const option of frozen) {
      const participant = await tx.groupMissionParticipant.findFirst({
        where: {
          id: option.participantId,
          roundId: option.roundId,
          userId,
          invalidatedAt: null,
        },
      });
      if (
        !participant ||
        !(await tx.groupMembership.findUnique({
          where: { groupId_userId: { groupId: option.groupId, userId } },
        }))
      )
        continue;
      const round = await tx.groupMissionRound.findFirst({
        where: {
          id: option.roundId,
          groupId: option.groupId,
          completedAt: null,
        },
      });
      if (round)
        options.push({
          groupId: option.groupId,
          groupName: option.groupName,
          roundId: option.roundId,
          waterCount: round.waterCount,
          totalTarget: round.totalTarget,
          stage: missionStage(round.waterCount, round.memberCount),
        });
    }
    return options.length
      ? {
          ...base,
          status: 'pending' as const,
          reason: null,
          options,
          contribution: null,
        }
      : unavailable('missions_ended');
  }
  async get(userId: string, source: WaterSource) {
    return this.transaction(async (tx) => {
      const date = await this.source(tx, userId, source);
      const achievement = await tx.activityAchievement.findFirst({
        where: { userId, ...source },
      });
      const choice = achievement
        ? await tx.groupMissionWaterChoice.findUnique({
            where: { achievementId: achievement.id },
          })
        : null;
      return this.view(
        tx,
        userId,
        source,
        achievement?.koreanDate ?? date,
        choice,
        await this.now(tx),
      );
    }, true);
  }
  async select(
    userId: string,
    source: WaterSource,
    groupId: string,
    key: string,
  ) {
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
      await this.source(tx, userId, source);
      const achievement = await tx.activityAchievement.findFirst({
        where: { userId, ...source },
      });
      const choice = achievement
        ? await tx.groupMissionWaterChoice.findUnique({
            where: { achievementId: achievement.id },
          })
        : null;
      if (!achievement || !choice)
        throw new ConflictException('이 운동으로 물을 줄 수 없습니다.');
      const previous = await tx.groupMissionWaterChoice.findFirst({
        where: { requestKey: key, achievement: { userId } },
      });
      if (previous && previous.achievementId !== choice.achievementId)
        throw new ConflictException(
          '같은 요청 키에 다른 운동을 사용할 수 없습니다.',
        );
      const now = await this.now(tx);
      if (choice.selection) {
        const selection = choice.selection as { groupId: string };
        if (selection.groupId !== groupId)
          throw new ConflictException({
            statusCode: 409,
            code: 'WATER_ALREADY_CONTRIBUTED',
            message: '오늘의 물은 이미 다른 그룹에 반영되었습니다.',
          });
        return {
          water: await this.view(
            tx,
            userId,
            source,
            achievement.koreanDate,
            choice,
            now,
          ),
          replayed: true,
        };
      }
      if (koreanDay(now) !== achievement.koreanDate.toISOString().slice(0, 10))
        throw new ConflictException({
          statusCode: 409,
          code: 'WATER_EXPIRED',
          message: '물 주기는 운동을 완료한 날에만 가능합니다.',
        });
      const option = optionsSchema
        .parse(choice.options)
        .find((o) => o.groupId === groupId);
      if (!option)
        throw new ConflictException(
          '운동 완료 당시 참여 중이던 미션을 선택해 주세요.',
        );
      await tx.$queryRaw`SELECT id FROM ${this.database.table('groups')} WHERE id = ${groupId}::uuid FOR UPDATE`;
      // A lock wait crossing KST midnight cannot spend yesterday's water.
      const selectedAt = await this.now(tx);
      if (koreanDay(selectedAt) !== koreanDay(achievement.achievedAt))
        throw new ConflictException({
          statusCode: 409,
          code: 'WATER_EXPIRED',
          message: '물 주기는 운동을 완료한 날에만 가능합니다.',
        });
      await contributeMissionWater(
        tx,
        userId,
        achievement.id,
        option,
        selectedAt,
        key,
      );
      const saved = await tx.groupMissionWaterChoice.findUniqueOrThrow({
        where: { achievementId: achievement.id },
      });
      return {
        water: await this.view(
          tx,
          userId,
          source,
          achievement.koreanDate,
          saved,
          selectedAt,
        ),
        replayed: false,
      };
    });
  }
}
