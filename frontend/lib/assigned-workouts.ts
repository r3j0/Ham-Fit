import type { Workout } from "./workout-types.ts";

/** Only today's real assignments belong on the home/workout list. */
export function assignedWorkoutsForDay(
  rows: readonly Workout[],
  day: string,
): Workout[] {
  const latest = new Map<string, Workout>();
  for (const workout of rows) {
    const previous = latest.get(workout.id);
    if (!previous || workout.revision > previous.revision)
      latest.set(workout.id, workout);
  }
  return [...latest.values()]
    .filter((workout) => workout.koreanDate === day)
    .sort(
      (a, b) =>
        a.assignedAt.localeCompare(b.assignedAt) ||
        (a.routine && b.routine && a.routine.id === b.routine.id
          ? a.routine.order - b.routine.order
          : a.id.localeCompare(b.id)),
    );
}

/** Input is the deduplicated assignment/order sequence for one day. */
export function currentWorkoutStep(rows: readonly Workout[]) {
  return {
    workout: rows.find((row) => row.status !== "completed") ?? null,
    started: rows.some(
      (row) =>
        row.status !== "assigned" ||
        row.performedAt != null ||
        row.progress.watchedSeconds > 0 ||
        row.progress.positionSeconds > 0,
    ),
  };
}
