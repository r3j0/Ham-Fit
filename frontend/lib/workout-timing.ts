export type WorkoutSegment = {
  shortLabel?: string;
  id: string;
  title: string;
  durationSeconds: number | null;
  cadence?: { intervalMs: number; cues: string[] };
  canFinish?: boolean;
};
export type WorkoutClock = {
  remainingMs: number;
  elapsedMs: number;
  runningSince: number | null;
};
export type WorkoutTimerState = WorkoutClock & {
  phase: "countdown" | "active" | "finished";
  segmentIndex: number;
};

export function workoutClock(state: WorkoutClock, now: number) {
  const delta =
    state.runningSince === null ? 0 : Math.max(0, now - state.runningSince);
  return {
    remainingMs: Math.max(0, state.remainingMs - delta),
    elapsedMs: state.elapsedMs + delta,
  };
}
/** One wall-clock engine for assessment stages, workout sets and rest. */
export function advanceWorkoutTimer(
  segments: WorkoutSegment[],
  state: WorkoutTimerState,
  now: number,
): WorkoutTimerState {
  if (state.runningSince === null || state.phase === "finished") return state;
  let next = { ...state };
  let delta = Math.max(0, now - state.runningSince);
  for (;;) {
    const segment = segments[next.segmentIndex];
    if (next.phase === "active" && segment.durationSeconds === null)
      return { ...next, elapsedMs: next.elapsedMs + delta, runningSince: now };
    if (delta < next.remainingMs)
      return {
        ...next,
        remainingMs: next.remainingMs - delta,
        elapsedMs: next.elapsedMs + delta,
        runningSince: now,
      };
    delta -= next.remainingMs;
    if (next.phase === "countdown") {
      next = { ...next, phase: "active", segmentIndex: 0 };
    } else if (next.segmentIndex + 1 < segments.length) {
      next = { ...next, segmentIndex: next.segmentIndex + 1 };
    } else {
      return {
        ...next,
        phase: "finished",
        remainingMs: 0,
        elapsedMs: 0,
        runningSince: null,
      };
    }
    next = {
      ...next,
      remainingMs: (segments[next.segmentIndex].durationSeconds ?? 0) * 1000,
      elapsedMs: 0,
    };
  }
}
