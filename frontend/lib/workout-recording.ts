import type { Workout } from "./workout-types.ts";

/** Legacy single-video APIs retain their original rules. Routine deadlines use a monotonic clock. */
export function canRecordWorkout(workout: Workout, now = performance.now()) {
  return (
    !workout.routine ||
    !!(workout.recording?.allowed && now < workout.recording.deadline)
  );
}

export function mergeWorkoutSnapshot(
  current: Workout,
  incoming: Workout,
): Workout {
  const saved = incoming.revision >= current.revision ? incoming : current;
  if (!current.routine && !incoming.routine) return saved;
  // The same item revision can cross midnight; date metadata has its own freshness.
  const recording =
    !current.recording ||
    !incoming.recording ||
    Date.parse(incoming.recording.serverTime) >=
      Date.parse(current.recording.serverTime)
      ? incoming.recording
      : current.recording;
  return {
    ...saved,
    recording,
    serverKoreanDate:
      recording === incoming.recording
        ? incoming.serverKoreanDate
        : current.serverKoreanDate,
  };
}
