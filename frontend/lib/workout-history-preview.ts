/** Calendar-only preview data. No measurement, curriculum, or API records. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  // Local noon avoids UTC conversion and daylight-saving midnight boundaries.
  return new Date(year, month - 1, day, 12);
}

export function shiftDay(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function shiftMonth(month: string, months: number): string {
  const date = dateFromKey(`${month}-01`);
  date.setMonth(date.getMonth() + months);
  return localDateKey(date).slice(0, 7);
}

export function calendarWeeks(month: string): (string | null)[][] {
  const first = dateFromKey(`${month}-01`);
  const count = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0,
  ).getDate();
  const cells: (string | null)[] = Array.from(
    { length: first.getDay() },
    () => null,
  );
  for (let day = 0; day < count; day++)
    cells.push(shiftDay(`${month}-01`, day));
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) =>
    cells.slice(week * 7, week * 7 + 7),
  );
}

/** An unfinished today keeps yesterday's streak alive until the day ends. */
export function workoutStreak(
  completed: ReadonlySet<string>,
  today: string,
): number {
  let day = completed.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (completed.has(day)) {
    streak++;
    day = shiftDay(day, -1);
  }
  return streak;
}

export function createPreviewHistory(today: string): Set<string> {
  return new Set(
    [1, 2, 3, 5, 7, 8, 11, 12, 14, 17, 18, 20, 23, 25, 26, 28, 32, 33].map(
      (days) => shiftDay(today, -days),
    ),
  );
}
