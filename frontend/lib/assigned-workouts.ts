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
