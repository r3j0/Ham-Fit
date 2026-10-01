import type { Prescription, WorkoutRoutine } from "./workout-routine.ts";
export function doseRange(
  p: Prescription,
): { min: number; max: number } | null {
  if (
    (p.doseType === "reps" && p.unit !== "회") ||
    (p.doseType === "timed" && p.unit !== "초") ||
    (p.doseType === "hold" && p.unit !== "초 유지")
  )
    return null;
  const match = /^(\d+)(?:\s*[~～–-]\s*(\d+))?$/.exec(p.value.trim());
  if (!match) return null;
  const min = Number(match[1]),
    max = Number(match[2] ?? match[1]);
  return Number.isSafeInteger(min) &&
    min > 0 &&
    Number.isSafeInteger(max) &&
    max >= min &&
    max <= 86400
    ? { min, max }
    : null;
}
export function nextRoutineHref(routine: WorkoutRoutine, itemId?: string) {
  const at = routine.routine.findIndex((i) => i.id === itemId);
  const next =
    routine.routine.slice(at + 1).find((i) => i.status !== "completed") ??
    routine.routine.find((i) => i.status !== "completed");
  return next
    ? `/workout-routines/${routine.id}/items/${next.id}`
    : `/workout-routines/${routine.id}/complete`;
}
export interface PracticeState {
  phase: "ready" | "work" | "rest" | "done";
  set: number;
  reps: number;
  target: number;
  remainingMs: number;
  deadline: number | null;
}
export type PracticeAction =
  | { type: "start" | "pause" | "tick"; now: number }
  | { type: "rep" | "finish" | "skipRest" | "reset" }
  | { type: "target"; value: number };
export function initialPractice(p: Prescription): PracticeState {
  const target = doseRange(p)?.min ?? 0;
  return {
    phase: "ready",
    set: 1,
    reps: 0,
    target,
    remainingMs: target * 1000,
    deadline: null,
  };
}
export function practiceReducer(
  p: Prescription,
  state: PracticeState,
  action: PracticeAction,
): PracticeState {
  const range = doseRange(p),
    timed = !!range && p.doseType !== "reps";
  const nextSet = () => ({
    ...state,
    phase: "ready" as const,
    set: state.set + 1,
    reps: 0,
    remainingMs: state.target * 1000,
    deadline: null,
  });
  const finish = () =>
    state.set >= p.sets
      ? { ...state, phase: "done" as const, deadline: null, remainingMs: 0 }
      : p.restSec > 0
        ? {
            ...state,
            phase: "rest" as const,
            deadline: null,
            remainingMs: p.restSec * 1000,
          }
        : nextSet();
  if (action.type === "reset") return initialPractice(p);
  if (action.type === "target")
    return state.phase === "ready" &&
      range &&
      Number.isInteger(action.value) &&
      action.value >= range.min &&
      action.value <= range.max
      ? { ...state, target: action.value, remainingMs: action.value * 1000 }
      : state;
  if (action.type === "pause")
    return state.deadline === null
      ? state
      : {
          ...state,
          remainingMs: Math.max(0, state.deadline - action.now),
          deadline: null,
        };
  if (action.type === "start") {
    if (state.phase === "done" || state.deadline !== null) return state;
    const phase = state.phase === "ready" ? "work" : state.phase;
    return {
      ...state,
      phase,
      deadline:
        timed || phase === "rest" ? action.now + state.remainingMs : null,
    };
  }
  if (action.type === "tick") {
    if (state.deadline === null) return state;
    const remainingMs = Math.max(0, state.deadline - action.now);
    if (remainingMs > 0) return { ...state, remainingMs };
    return state.phase === "rest" ? nextSet() : finish();
  }
  if (action.type === "skipRest")
    return state.phase === "rest" ? nextSet() : state;
  if (action.type === "rep")
    return state.phase === "work" && p.doseType === "reps" && range
      ? { ...state, reps: Math.min(state.target, state.reps + 1) }
      : state;
  if (
    action.type === "finish" &&
    state.phase === "work" &&
    (!range || (p.doseType === "reps" && state.reps >= state.target))
  )
    return finish();
  return state;
}
