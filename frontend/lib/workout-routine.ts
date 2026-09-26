import {
  advanceWorkoutTimer,
  workoutClock,
  type WorkoutClock,
  type WorkoutSegment,
} from "./workout-timing.ts";

/** Routine data is independent of measurement results and API assignment IDs. */
export type RoutineExercise = {
  id: string;
  title: string;
  focus: string;
  equipment: string[];
  instructions: string[];
  target: { kind: "reps"; count: number } | { kind: "time"; seconds: number };
  sets: number;
  restSeconds: number;
};
export type WorkoutRoutine = {
  id: string;
  title: string;
  exercises: RoutineExercise[];
};
export type RoutineState = WorkoutClock & {
  phase: "ready" | "countdown" | "active" | "rest" | "paused" | "complete";
  pausedPhase: "countdown" | "active" | "rest" | null;
  index: number;
  completedSets: number[];
  skipped: string[];
  exerciseMs: number;
};
export type RoutineAction = {
  type:
    | "start"
    | "tick"
    | "interrupt"
    | "resume"
    | "finish-set"
    | "skip-rest"
    | "skip-exercise"
    | "end";
  now: number;
};
const stoppedClock = { remainingMs: 0, elapsedMs: 0, runningSince: null };
export function initialRoutine(routine: WorkoutRoutine): RoutineState {
  return {
    ...stoppedClock,
    phase: "ready",
    pausedPhase: null,
    index: 0,
    completedSets: routine.exercises.map(() => 0),
    skipped: [],
    exerciseMs: 0,
  };
}
export function exerciseTarget(exercise: RoutineExercise) {
  return exercise.target.kind === "reps"
    ? `${exercise.target.count}회`
    : `${exercise.target.seconds}초`;
}
export function exerciseSegment(exercise: RoutineExercise): WorkoutSegment {
  return {
    id: exercise.id,
    title: exercise.title,
    durationSeconds:
      exercise.target.kind === "time" ? exercise.target.seconds : null,
  };
}
export function restSegment(seconds: number): WorkoutSegment {
  return { id: "rest", title: "휴식", durationSeconds: seconds };
}
function finishSet(
  routine: WorkoutRoutine,
  state: RoutineState,
  now: number,
  elapsedMs: number,
): RoutineState {
  const exercise = routine.exercises[state.index];
  const completedSets = state.completedSets.map((count, index) =>
    index === state.index ? count + 1 : count,
  );
  const done = completedSets[state.index] === exercise.sets;
  const complete = done && state.index === routine.exercises.length - 1;
  return {
    ...state,
    ...stoppedClock,
    completedSets,
    exerciseMs: state.exerciseMs + elapsedMs,
    index: done && !complete ? state.index + 1 : state.index,
    phase: complete ? "complete" : exercise.restSeconds > 0 ? "rest" : "ready",
    remainingMs: complete ? 0 : exercise.restSeconds * 1000,
    runningSince: !complete && exercise.restSeconds > 0 ? now : null,
  };
}
/** Reps are confirmed by the user; only timed targets may finish on a tick. */
export function advanceRoutine(
  routine: WorkoutRoutine,
  state: RoutineState,
  action: RoutineAction,
): RoutineState {
  const exercise = routine.exercises[state.index];
  if (!exercise || state.phase === "complete") return state;
  switch (action.type) {
    case "start":
      return state.phase === "ready"
        ? {
            ...state,
            ...stoppedClock,
            phase: "countdown",
            remainingMs: 3000,
            runningSince: action.now,
          }
        : state;
    case "tick": {
      if (state.phase === "rest") {
        const clock = workoutClock(state, action.now);
        return clock.remainingMs === 0
          ? { ...state, ...stoppedClock, phase: "ready" }
          : { ...state, ...clock, runningSince: action.now };
      }
      if (state.phase !== "countdown" && state.phase !== "active") return state;
      const timer = advanceWorkoutTimer(
        [exerciseSegment(exercise)],
        { ...state, phase: state.phase, segmentIndex: 0 },
        action.now,
      );
      if (timer.phase === "finished") {
        return finishSet(
          routine,
          state,
          action.now,
          exercise.target.kind === "time" ? exercise.target.seconds * 1000 : 0,
        );
      }
      return {
        ...state,
        phase: timer.phase,
        elapsedMs: timer.elapsedMs,
        remainingMs: timer.remainingMs,
        runningSince: timer.runningSince,
      };
    }
    case "interrupt": {
      if (
        state.phase !== "countdown" &&
        state.phase !== "active" &&
        state.phase !== "rest"
      )
        return state;
      const next = advanceRoutine(routine, state, {
        type: "tick",
        now: action.now,
      });
      if (
        next.phase !== "countdown" &&
        next.phase !== "active" &&
        next.phase !== "rest"
      )
        return next;
      return {
        ...next,
        phase: "paused",
        pausedPhase: next.phase,
        runningSince: null,
      };
    }
    case "resume":
      return state.phase === "paused" && state.pausedPhase
        ? {
            ...state,
            phase: state.pausedPhase,
            pausedPhase: null,
            runningSince: action.now,
          }
        : state;
    case "finish-set":
      return state.phase === "active" && exercise.target.kind === "reps"
        ? finishSet(
            routine,
            state,
            action.now,
            workoutClock(state, action.now).elapsedMs,
          )
        : state;
    case "skip-rest":
      return state.phase === "rest" ||
        (state.phase === "paused" && state.pausedPhase === "rest")
        ? { ...state, ...stoppedClock, phase: "ready", pausedPhase: null }
        : state;
    case "skip-exercise": {
      // Stop first so a stray click cannot skip an active set.
      if (state.phase !== "ready" && state.phase !== "paused") return state;
      return {
        ...state,
        ...stoppedClock,
        phase:
          state.index === routine.exercises.length - 1 ? "complete" : "ready",
        index: Math.min(state.index + 1, routine.exercises.length - 1),
        pausedPhase: null,
        skipped: [...state.skipped, exercise.id],
      };
    }
    case "end":
      return {
        ...state,
        ...stoppedClock,
        phase: "complete",
        pausedPhase: null,
        skipped: routine.exercises
          .filter((item, index) => state.completedSets[index] < item.sets)
          .map((item) => item.id),
      };
  }
}

/** Explicit preview only. Never use this as a fallback for an API assignment. */
export const previewRoutine: WorkoutRoutine = {
  id: "squat-push-up-preview-v1",
  title: "스쿼트와 푸시업",
  exercises: [
    {
      id: "squat",
      title: "스쿼트",
      focus: "하체",
      target: { kind: "reps", count: 10 },
      sets: 2,
      restSeconds: 30,
      equipment: ["맨몸"],
      instructions: [
        "발을 어깨너비로 벌리고 편하게 서요.",
        "엉덩이를 뒤로 보내며 무릎을 굽혔다가 천천히 일어나요.",
        "편안하게 움직일 수 있는 범위에서 진행해요.",
      ],
    },
    {
      id: "push-up",
      title: "푸시업",
      focus: "상체",
      target: { kind: "reps", count: 10 },
      sets: 2,
      restSeconds: 30,
      equipment: ["매트"],
      instructions: [
        "손을 어깨보다 조금 넓게 두고 몸을 길게 유지해요.",
        "팔꿈치를 굽혀 몸을 내렸다가 바닥을 밀어 올려요.",
        "어렵다면 무릎을 바닥에 대고 진행해도 좋아요.",
      ],
    },
  ],
};
