import type {
  ActivityAchievement,
  Prisma,
} from '../generated/prisma/client.js';
import { currentStreak } from '../users/member-profile.js';

export const STREAK_POLICY_VERSION = 'streak-2026-10-01-v1';

// A reward requires an actual success today; yesterday's display grace is not
// a milestone. Calendar arithmetic is UTC, independent of the process timezone.
export function streakMilestone(completed: ReadonlySet<string>, day: string) {
  if (!completed.has(day)) return null;
  const count = currentStreak(completed, day);
  if (count % 5 !== 0) return null;
  const start = new Date(`${day}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - count + 1);
  return {
    segmentStartDate: start.toISOString().slice(0, 10),
    streakDays: count,
  };
}

export async function issueStreakTicket(
  tx: Prisma.TransactionClient,
  achievement: ActivityAchievement,
  completed: ReadonlySet<string>,
) {
  const milestone = streakMilestone(
    completed,
    achievement.koreanDate.toISOString().slice(0, 10),
  );
  if (!milestone) return;
  await tx.streakRouletteTicket.create({
    data: {
      userId: achievement.userId,
      achievementId: achievement.id,
      koreanDate: achievement.koreanDate,
      segmentStartDate: new Date(`${milestone.segmentStartDate}T00:00:00Z`),
      streakDays: milestone.streakDays,
      createdAt: achievement.achievedAt,
      policyVersion: STREAK_POLICY_VERSION,
    },
  });
}
