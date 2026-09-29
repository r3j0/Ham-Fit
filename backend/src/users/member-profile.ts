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

export async function memberProfiles(
  tx: Prisma.TransactionClient,
  userIds: string[],
  now = new Date(),
) {
  const users = await tx.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, nickname: true },
  });
  const completions = await tx.userCurriculumAssignment.findMany({
    where: {
      userId: { in: userIds },
      assignmentDate: { not: null },
      status: 'completed',
      completedAt: { lte: now },
    },
    select: { userId: true, completedAt: true },
  });
  const days = new Map<string, Set<string>>();
  for (const completion of completions) {
    const set = days.get(completion.userId) ?? new Set<string>();
    if (completion.completedAt) set.add(koreanDay(completion.completedAt));
    days.set(completion.userId, set);
  }
  return new Map(
    users.map((user) => [
      user.id,
      {
        userId: user.id,
        nickname: user.nickname,
        // There is no persisted character selection/catalog in the existing backend.
        profileCharacter: null,
        streak: currentStreak(days.get(user.id) ?? new Set(), koreanDay(now)),
      },
    ]),
  );
}
