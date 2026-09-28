export const workoutPreviewLengthSeconds = 10;

export function workoutPreviewSegment(durationSeconds: number) {
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 0;
  const start = Math.max(
    0,
    Math.min(duration / 2, duration - workoutPreviewLengthSeconds),
  );
  return {
    start,
    end: Math.min(duration, start + workoutPreviewLengthSeconds),
  };
}
