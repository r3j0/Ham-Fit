import { advanceWorkoutTimer, type WorkoutSegment } from "./workout-timing.ts";
export { workoutClock } from "./workout-timing.ts";
export type { WorkoutSegment } from "./workout-timing.ts";

export type WorkoutStep = {
  id: string;
  title: string;
  factor: string;
  instructions: string[];
  equipment: string[];
  videoUrl: string;
  segments: WorkoutSegment[];
  result: {
    code: string;
    label: string;
    unit: string;
    storedUnit: string;
    kind: "integer" | "decimal";
    minimum?: number;
    multiplier?: number;
    hint: string;
  };
};
export type WorkoutDefinition = {
  id: string;
  version: number;
  title: string;
  description: string;
  sourceUrl: string;
  steps: WorkoutStep[];
};
export type WorkoutState = {
  phase: "ready" | "countdown" | "active" | "record" | "interrupted" | "review";
  index: number;
  segmentIndex: number;
  remainingMs: number;
  elapsedMs: number;
  runningSince: number | null;
  results: Record<string, string>;
  skipped: string[];
  draftValue: string;
  reviewing: boolean;
};
export type WorkoutAction =
  | { type: "start" | "tick" | "finish"; now: number }
  | { type: "interrupt" | "restart" | "skip" }
  | { type: "input" | "record"; value: string }
  | { type: "repeat"; index: number };

export const initialWorkout = (): WorkoutState => ({
  phase: "ready",
  index: 0,
  segmentIndex: 0,
  remainingMs: 0,
  elapsedMs: 0,
  runningSince: null,
  results: {},
  skipped: [],
  draftValue: "",
  reviewing: false,
});
export function resultError(step: WorkoutStep, raw: string) {
  const value = raw.trim().replace(/^\+/, "");
  if (!value)
    return "측정한 값을 입력해 주세요. 측정하지 않았다면 건너뛰기를 선택해 주세요.";
  if (value.length > 16 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    return "숫자로 입력해 주세요.";
  if (step.result.kind === "integer" && !/^-?\d+$/.test(value))
    return "정수로 입력해 주세요.";
  if (step.result.minimum !== undefined && Number(value) < step.result.minimum)
    return `${step.result.minimum} 이상으로 입력해 주세요.`;
  return null;
}
export function resultValue(step: WorkoutStep, raw: string) {
  const value = raw.trim().replace(/^\+/, "");
  return step.result.multiplier
    ? String(BigInt(value) * BigInt(step.result.multiplier))
    : value;
}
export function interruptedWorkout(state: WorkoutState): WorkoutState {
  return state.phase === "active" || state.phase === "countdown"
    ? {
        ...state,
        phase: "interrupted",
        runningSince: null,
        remainingMs: 0,
        elapsedMs: 0,
        segmentIndex: 0,
      }
    : state;
}
function nextStep(
  definition: WorkoutDefinition,
  state: WorkoutState,
): WorkoutState {
  if (state.reviewing || state.index === definition.steps.length - 1)
    return {
      ...state,
      phase: "review",
      runningSince: null,
      draftValue: "",
      reviewing: false,
    };
  return {
    ...state,
    phase: "ready",
    index: state.index + 1,
    segmentIndex: 0,
    remainingMs: 0,
    elapsedMs: 0,
    runningSince: null,
    draftValue: "",
  };
}
export function advanceWorkout(
  definition: WorkoutDefinition,
  state: WorkoutState,
  action: WorkoutAction,
): WorkoutState {
  const step = definition.steps[state.index];
  if (!step) return state;
  switch (action.type) {
    case "start":
      if (state.phase !== "ready" && state.phase !== "interrupted")
        return state;
      return {
        ...state,
        phase: step.segments.length ? "countdown" : "record",
        segmentIndex: 0,
        remainingMs: step.segments.length ? 3000 : 0,
        elapsedMs: 0,
        runningSince: step.segments.length ? action.now : null,
        draftValue: "",
      };
    case "tick": {
      if (state.phase !== "countdown" && state.phase !== "active") return state;
      const timer = advanceWorkoutTimer(
        step.segments,
        { ...state, phase: state.phase },
        action.now,
      );
      return {
        ...state,
        ...timer,
        phase: timer.phase === "finished" ? "record" : timer.phase,
      };
    }
    case "interrupt":
      return interruptedWorkout(state);
    case "restart":
      return state.phase === "interrupted" || state.phase === "record"
        ? {
            ...state,
            phase: "ready",
            segmentIndex: 0,
            remainingMs: 0,
            elapsedMs: 0,
            runningSince: null,
            draftValue: "",
          }
        : state;
    case "finish":
      return state.phase === "active" &&
        step.segments[state.segmentIndex]?.canFinish
        ? { ...state, phase: "record", runningSince: null, remainingMs: 0 }
        : state;
    case "input":
      return state.phase === "record"
        ? { ...state, draftValue: action.value }
        : state;
    case "record": {
      if (state.phase !== "record" || resultError(step, action.value))
        return state;
      return nextStep(definition, {
        ...state,
        results: {
          ...state.results,
          [step.id]: action.value.trim().replace(/^\+/, ""),
        },
        skipped: state.skipped.filter((id) => id !== step.id),
      });
    }
    case "skip": {
      if (!["ready", "record", "interrupted"].includes(state.phase))
        return state;
      const results = { ...state.results };
      delete results[step.id];
      return nextStep(definition, {
        ...state,
        results,
        skipped: Array.from(new Set([...state.skipped, step.id])),
      });
    }
    case "repeat":
      return state.phase === "review" && definition.steps[action.index]
        ? {
            ...state,
            phase: "ready",
            index: action.index,
            segmentIndex: 0,
            runningSince: null,
            remainingMs: 0,
            elapsedMs: 0,
            draftValue: "",
            reviewing: true,
          }
        : state;
  }
}
export function isWorkoutState(
  value: unknown,
  definition: WorkoutDefinition,
): value is WorkoutState {
  if (!value || typeof value !== "object") return false;
  const state = value as WorkoutState;
  if (
    !definition.steps[state.index] ||
    !Number.isInteger(state.index) ||
    ![
      "ready",
      "countdown",
      "active",
      "record",
      "interrupted",
      "review",
    ].includes(state.phase) ||
    !Number.isInteger(state.segmentIndex) ||
    state.segmentIndex < 0 ||
    state.segmentIndex >
      Math.max(0, definition.steps[state.index].segments.length - 1) ||
    typeof state.draftValue !== "string" ||
    state.draftValue.length > 16 ||
    typeof state.reviewing !== "boolean" ||
    !state.results ||
    typeof state.results !== "object" ||
    Array.isArray(state.results) ||
    !Array.isArray(state.skipped)
  )
    return false;
  if (
    ![state.remainingMs, state.elapsedMs].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) ||
    (state.runningSince !== null && !Number.isFinite(state.runningSince))
  )
    return false;
  if (
    Object.entries(state.results).some(([id, v]) => {
      const step = definition.steps.find((s) => s.id === id);
      return !step || typeof v !== "string" || !!resultError(step, v);
    })
  )
    return false;
  if (
    state.skipped.some(
      (id) =>
        typeof id !== "string" ||
        !definition.steps.some((s) => s.id === id) ||
        id in state.results,
    ) ||
    new Set(state.skipped).size !== state.skipped.length
  )
    return false;
  const timed = state.phase === "active" || state.phase === "countdown";
  const segment = definition.steps[state.index].segments[state.segmentIndex];
  if (timed && (!segment || state.runningSince === null)) return false;
  if (!timed && state.runningSince !== null) return false;
  if (
    state.phase === "countdown" &&
    (state.segmentIndex !== 0 || state.remainingMs > 3000)
  )
    return false;
  if (
    state.phase === "active" &&
    segment.durationSeconds !== null &&
    state.remainingMs > segment.durationSeconds * 1000
  )
    return false;
  if (
    !state.reviewing &&
    state.phase !== "review" &&
    definition.steps
      .slice(state.index)
      .some(
        (step) => step.id in state.results || state.skipped.includes(step.id),
      )
  )
    return false;
  const required =
    state.phase === "review"
      ? definition.steps
      : definition.steps.slice(0, state.index);
  return required.every(
    (step) => step.id in state.results || state.skipped.includes(step.id),
  );
}
