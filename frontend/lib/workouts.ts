import { api } from "./session";
import type { BirthProfile, Workout, WorkoutPage } from "./workout-types";
import { routineIdentity, routineWorkouts } from "./workout-routine";
import {
  getRoutine,
  getRoutineHistory,
  routineItemWorkout,
  sendRoutineEvent,
} from "./workout-routines";
import { collectWorkoutHistory } from "./workout-history";
import { ApiError } from "./http";
import type { WorkoutRoutine } from "./workout-routine";

export const getBirthProfile = (signal?: AbortSignal) =>
  api<BirthProfile>("/users/me/profile", { signal }).then((r) => r.data);
export const saveBirthProfile = (dateOfBirth: string) =>
  api<BirthProfile>("/users/me/profile", {
    method: "PATCH",
    headers: { "X-CSRF-Protection": "1" },
    body: JSON.stringify({ dateOfBirth }),
  }).then((r) => r.data);
export const getCurrentWorkout = (signal?: AbortSignal) =>
  api<Workout | null>("/workouts/current", { signal, allowNull: true }).then(
    (r) => r.data,
  );
export const getWorkout = (id: string, signal?: AbortSignal) => {
  const item = routineIdentity(id);
  if (item)
    return getRoutine(item.routineId, signal).then((row) =>
      routineItemWorkout(row, item.itemId),
    );
  return api<Workout>(`/workouts/${encodeURIComponent(id)}`, { signal }).then(
    (r) => r.data,
  );
};
export const getWorkoutHistory = (cursor?: string, signal?: AbortSignal) =>
  api<WorkoutPage>(
    `/workouts/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    { signal },
  ).then((r) => r.data);
export const requestTodayWorkout = (key: string) =>
  api<Workout>("/workouts/today", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: "{}",
  }).then((r) => r.data);
// The caller persists the exact serialized body before sending it.
export const sendWorkoutEvent = (id: string, key: string, body: string) => {
  const item = routineIdentity(id);
  if (item) return sendRoutineEvent(item.routineId, item.itemId, key, body);
  return api<Workout>(`/workouts/${encodeURIComponent(id)}/events`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body,
  }).then((r) => r.data);
};

export async function getActivityHistory(signal?: AbortSignal) {
  const routineRead = async () => {
    const rows = new Map<string, WorkoutRoutine>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      signal?.throwIfAborted();
      const page = await getRoutineHistory(cursor, signal);
      signal?.throwIfAborted();
      for (const row of page.items) rows.set(row.id, row);
      cursor = page.nextCursor ?? undefined;
      if (cursor && cursors.has(cursor))
        throw new Error("운동 이력의 페이지를 확인할 수 없어요.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...rows.values()];
  };
  const [legacy, current] = await Promise.allSettled([
    collectWorkoutHistory(
      (cursor) => getWorkoutHistory(cursor, signal),
      signal,
    ),
    routineRead(),
  ]);
  signal?.throwIfAborted();
  if (current.status === "rejected") throw current.reason;
  const legacyUnavailable =
    legacy.status === "rejected" &&
    legacy.reason instanceof ApiError &&
    legacy.reason.code === "RECOMMENDATION_NOT_CONNECTED";
  if (legacy.status === "rejected" && !legacyUnavailable) throw legacy.reason;
  return {
    routines: current.value,
    legacyUnavailable,
    workouts: [
      ...(legacy.status === "fulfilled" ? legacy.value : []),
      ...current.value.flatMap(routineWorkouts),
    ].sort(
      (a, b) =>
        b.koreanDate.localeCompare(a.koreanDate) ||
        a.assignedAt.localeCompare(b.assignedAt) ||
        (a.routine?.order ?? 0) - (b.routine?.order ?? 0),
    ),
  };
}
