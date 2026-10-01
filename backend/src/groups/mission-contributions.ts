import { ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { koreanDay, workoutDays } from '../users/member-profile.js';
import { issueStreakTicket } from '../streak-roulette/streak-ticket.js';
import { ticketCount } from './mission-policy.js';

// Only called before the FIRST valid completion transition is saved, under
// the existing owner lock, inside the original workout transaction.
export async function recordActivityAchievement(
  database: DatabaseService,
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  sourceKind: 'routine' | 'daily_assignment',
  sourceId: string,
) {
  const day = koreanDay(now);
  const koreanDate = new Date(`${day}T00:00:00Z`);
  if (
    await tx.activityAchievement.findUnique({
      where: { userId_koreanDate: { userId, koreanDate } },
    })
  )
    return;
  const completed =
    (await workoutDays(tx, [userId], now)).get(userId) ?? new Set<string>();
  // The source is about to be saved. Existing success today consumes the day,
  // but this first valid transition must be included in the reward calculation.
  if (completed.has(day)) return;
  const achievement = await tx.activityAchievement.create({
    data: { userId, koreanDate, achievedAt: now, sourceKind, sourceId },
  });
  completed.add(day);
  await issueStreakTicket(tx, achievement, completed);
  // Stable UUID order across all eligible groups; deletion/start/admission and
  // departure use the same parent locks. Recheck eligibility after waiting.
  const groups = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT g.id FROM ${database.table('groups')} g
    JOIN ${database.table('group_memberships')} m ON m.group_id = g.id
    WHERE m.user_id = ${userId}::uuid ORDER BY g.id FOR UPDATE OF g
  `;
  const options: WaterOption[] = [];
  for (const group of groups) {
    const round = await tx.groupMissionRound.findFirst({
      where: { groupId: group.id, completedAt: null, startedAt: { lte: now } },
    });
    if (!round) continue;
    const participant = await tx.groupMissionParticipant.findFirst({
      where: { roundId: round.id, userId, invalidatedAt: null },
    });
    if (
      !participant ||
      !(await tx.groupMembership.findUnique({
        where: { groupId_userId: { groupId: group.id, userId } },
      }))
    )
      continue;
    const row = await tx.group.findUniqueOrThrow({ where: { id: group.id } });
    options.push({
      groupId: group.id,
      groupName: row.name,
      roundId: round.id,
      participantId: participant.id,
    });
  }
  await tx.groupMissionWaterChoice.create({
    data: {
      achievementId: achievement.id,
      options: options as unknown as Prisma.InputJsonValue,
    },
  });
  if (options.length === 1)
    await contributeMissionWater(tx, userId, achievement.id, options[0], now);
}

export interface WaterOption {
  groupId: string;
  groupName: string;
  roundId: string;
  participantId: string;
}

// The caller holds the owner and original group locks. Completion (one option)
// and explicit selection (multiple options) share the exact same finalization.
export async function contributeMissionWater(
  tx: Prisma.TransactionClient,
  userId: string,
  achievementId: string,
  option: WaterOption,
  now: Date,
  requestKey?: string,
) {
  const round = await tx.groupMissionRound.findFirst({
    where: { id: option.roundId, groupId: option.groupId, completedAt: null },
  });
  const participant = await tx.groupMissionParticipant.findFirst({
    where: {
      id: option.participantId,
      roundId: option.roundId,
      userId,
      invalidatedAt: null,
    },
  });
  if (
    !round ||
    !participant ||
    !(await tx.groupMembership.findUnique({
      where: { groupId_userId: { groupId: option.groupId, userId } },
    }))
  )
    throw new ConflictException({
      statusCode: 409,
      code: 'WATER_OPTION_UNAVAILABLE',
      message:
        '이 미션에는 더 이상 물을 줄 수 없습니다. 다른 그룹을 확인해 주세요.',
    });
  const selection = {
    groupId: option.groupId,
    groupName: option.groupName,
    roundId: option.roundId,
    amount: 1,
  };
  await tx.groupMissionWaterChoice.update({
    where: { achievementId },
    data: { selection, selectedAt: now, requestKey: requestKey ?? null },
  });
  await tx.groupMissionContribution.create({
    data: {
      groupId: option.groupId,
      roundId: round.id,
      participantId: participant.id,
      achievementId,
      waterChoiceId: achievementId,
      contributedAt: now,
    },
  });
  await tx.groupMissionParticipant.update({
    where: { id: participant.id },
    data: { waterCount: { increment: 1 } },
  });
  const complete = round.waterCount + 1 === round.totalTarget;
  await tx.groupMissionRound.update({
    where: { id: round.id },
    data: {
      waterCount: { increment: 1 },
      ...(complete ? { completedAt: now } : {}),
    },
  });
  if (complete) {
    const recipients = await tx.groupMissionParticipant.findMany({
      where: {
        roundId: round.id,
        userId: { not: null },
        invalidatedAt: null,
      },
      orderBy: { id: 'asc' },
    });
    const tickets = recipients.flatMap((recipient) =>
      Array.from({ length: ticketCount(recipient.waterCount) }, (_, i) => ({
        roundId: round.id,
        participantId: recipient.id,
        ordinal: i + 1,
        createdAt: now,
      })),
    );
    if (tickets.length)
      await tx.groupRouletteTicket.createMany({ data: tickets });
  }
  return selection;
}
