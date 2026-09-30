import { api } from "./session";
import type { ApiRequestOptions } from "./http";
import { invalid } from "./api-contract";
import {
  parseRoutine,
  parseRoutinePage,
  routineWorkouts,
} from "./workout-routine";
import type { WorkoutRoutine } from "./workout-routine";

async function routineApi(path: string, options: ApiRequestOptions = {}) {
  const started = performance.now();
  const response = await api<unknown>(path, { ...options, apiVersion: "v2" });
  return { ...response, roundTripMs: performance.now() - started };
}
export const getCurrentRoutine = (signal?: AbortSignal) =>
  routineApi("/workout-routines/current", { signal, allowNull: true }).then(
    ({ data, roundTripMs }) =>
      data === null ? null : parseRoutine(data, roundTripMs),
  );
export const getRoutine = (id: string, signal?: AbortSignal) =>
  routineApi(`/workout-routines/${encodeURIComponent(id)}`, { signal }).then(
    ({ data, roundTripMs }) => {
      const row = parseRoutine(data, roundTripMs);
      if (row.id !== id) invalid();
      return row;
    },
  );
export const getRoutineHistory = (cursor?: string, signal?: AbortSignal) =>
  routineApi(
    `/workout-routines/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    { signal },
  ).then(({ data, roundTripMs }) => parseRoutinePage(data, roundTripMs));
export const requestTodayRoutine = (key: string) =>
  routineApi("/workout-routines/today", {
    method: "POST",
    headers: { "Idempotency-Key": key, "X-CSRF-Protection": "1" },
    body: "{}",
  }).then(({ data, roundTripMs }) => parseRoutine(data, roundTripMs));
export function routineItemWorkout(row: WorkoutRoutine, itemId: string) {
  const workout = routineWorkouts(row).find(
    (item) => item.routine?.itemId === itemId,
  );
  if (!workout) invalid();
  return workout;
}
export const sendRoutineEvent = (
  id: string,
  itemId: string,
  key: string,
  body: string,
) =>
  routineApi(
    `/workout-routines/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/events`,
    {
      method: "POST",
      headers: { "Idempotency-Key": key, "X-CSRF-Protection": "1" },
      body,
    },
  ).then(({ data, roundTripMs }) => {
    const row = parseRoutine(data, roundTripMs);
    if (row.id !== id) invalid();
    return routineItemWorkout(row, itemId);
  });
