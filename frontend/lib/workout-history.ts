import type { Workout, WorkoutPage } from "./workout-types.ts";
import type { WorkoutRoutine } from "./workout-routine.ts";

/** Completion dates use Korea time, independently of the viewer's timezone. */
export function koreanDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function completedDate(
  workout: Pick<Workout, "status" | "completedAt">,
): string | null {
  if (workout.status !== "completed" || !workout.completedAt) return null;
  const date = new Date(workout.completedAt);
  return Number.isFinite(date.getTime()) ? koreanDateKey(date) : null;
}

/** A sunflower represents all videos in a routine, dated by its last KST completion. */
export function completedRoutineDate(
  routine: Pick<WorkoutRoutine, "status" | "routine">,
): string | null {
  if (routine.status !== "completed" || !routine.routine.length) return null;
  const days = routine.routine.map(completedDate);
  if (days.some((day) => day === null)) return null;
  return (days as string[]).sort().at(-1)!;
}

/** Assignment order is not completion order. Read all pages before deriving calendar/streak totals. */
export async function collectWorkoutHistory(
  read: (cursor?: string) => Promise<WorkoutPage>,
  signal?: AbortSignal,
): Promise<Workout[]> {
  const workouts = new Map<string, Workout>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const page = await read(cursor);
    signal?.throwIfAborted();
    for (const workout of page.items) {
      const previous = workouts.get(workout.id);
      if (!previous || workout.revision > previous.revision)
        workouts.set(workout.id, workout);
    }
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (cursors.has(cursor))
        throw new Error("Repeated workout history cursor");
      cursors.add(cursor);
    }
  } while (cursor);
  return [...workouts.values()];
}

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

/** Return the Sunday-to-Saturday week containing the supplied date key. */
export function calendarWeek(day: string): string[] {
  const start = dateFromKey(day);
  start.setDate(start.getDate() - start.getDay());
  const startKey = localDateKey(start);
  return Array.from({ length: 7 }, (_, offset) => shiftDay(startKey, offset));
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

/** Validate date route parameters without normalizing impossible calendar days. */
export function isWorkoutDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    localDateKey(dateFromKey(value)) === value
  );
}
