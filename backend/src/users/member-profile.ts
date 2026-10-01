import { outfitInclude, outfitView } from '../avatar/avatar-view.js';
import type { Prisma } from '../generated/prisma/client.js';

export function koreanDay(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
function previousDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
// Same completion-date/KST rule as the existing personal workout history.
// Today may be unfinished; yesterday's streak remains active until KST midnight.
export function currentStreak(completed: ReadonlySet<string>, today: string) {
  let day = completed.has(today) ? today : previousDay(today);
  let streak = 0;
  while (completed.has(day)) {
    streak++;
    day = previousDay(day);
  }
  return streak;
}

export function activityStats(completed: ReadonlySet<string>, today: string) {
  const days = [...completed].filter((day) => day <= today).sort();
  let longestStreak = 0;
  let run = 0;
  let previous: string | undefined;
  for (const day of days) {
    run = previous === previousDay(day) ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = day;
  }
  return {
    streak: currentStreak(completed, today),
    longestStreak,
    totalWorkoutDays: days.length,
  };
}

export async function memberProfiles(
  tx: Prisma.TransactionClient,
  userIds: string[],
  now = new Date(),
) {
  const users = await tx.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      nickname: true,
      avatarOutfit: { include: outfitInclude },
    },
  });
  const days = await workoutDays(tx, userIds, now);
  return new Map(
    users.map((user) => [
      user.id,
      {
        userId: user.id,
        nickname: user.nickname,
        profileCharacter: outfitView(user.avatarOutfit),
        ...activityStats(days.get(user.id) ?? new Set(), koreanDay(now)),
      },
    ]),
  );
}

// Shared source eligibility/date set, without profile or avatar reads.
export async function workoutDays(
  tx: Prisma.TransactionClient,
  userIds: string[],
  now: Date,
) {
  // Preserve the legacy daily-assignment eligibility rule. Routine items never
  // enter this table/path and must pass the whole-routine check below.
  const completions = await tx.userCurriculumAssignment.findMany({
    where: {
      userId: { in: userIds },
      assignmentDate: { not: null },
      status: 'completed',
      completedAt: { lte: now },
    },
    select: { userId: true, completedAt: true },
  });
  const routines = await tx.workoutRoutine.findMany({
    where: {
      userId: { in: userIds },
      items: {
        some: {}, // `every` alone also matches an empty routine.
        every: {
          status: 'completed',
          completedAt: { not: null, lte: now },
        },
      },
    },
    select: {
      userId: true,
      items: {
        // Only after checking ALL items, take the last actual completion.
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { completedAt: true },
      },
    },
  });
  const days = new Map<string, Set<string>>();
  for (const completion of [
    ...completions,
    ...routines.map((routine) => ({
      userId: routine.userId,
      completedAt: routine.items[0]?.completedAt,
    })),
  ]) {
    const set = days.get(completion.userId) ?? new Set<string>();
    if (completion.completedAt) set.add(koreanDay(completion.completedAt));
    days.set(completion.userId, set);
  }
  return days;
}
