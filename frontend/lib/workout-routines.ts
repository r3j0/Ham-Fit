import { api } from "./session";
import { invalid } from "./api-contract";
import {
  parseRoutine,
  parseRoutinePage,
  routineWorkouts,
} from "./workout-routine";
import type { WorkoutRoutine } from "./workout-routine";

export const getCurrentRoutine = (signal?: AbortSignal) =>
  api<unknown>("/workout-routines/current", { signal, allowNull: true }).then(
    ({ data }) => (data === null ? null : parseRoutine(data)),
  );
export const getRoutine = (id: string, signal?: AbortSignal) =>
  api<unknown>(`/workout-routines/${encodeURIComponent(id)}`, { signal }).then(
    ({ data }) => {
      const row = parseRoutine(data);
      if (row.id !== id) invalid();
      return row;
    },
  );
export const getRoutineHistory = (cursor?: string, signal?: AbortSignal) =>
  api<unknown>(
    `/workout-routines/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    { signal },
  ).then(({ data }) => parseRoutinePage(data));
export const requestNextRoutine = (key: string) =>
  api<unknown>("/workout-routines/next", {
    method: "POST",
    headers: { "Idempotency-Key": key, "X-CSRF-Protection": "1" },
    body: "{}",
  }).then(({ data }) => parseRoutine(data));
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
  api<unknown>(
    `/workout-routines/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/events`,
    {
      method: "POST",
      headers: { "Idempotency-Key": key, "X-CSRF-Protection": "1" },
      body,
    },
  ).then(({ data }) => {
    const row = parseRoutine(data);
    if (row.id !== id) invalid();
    return routineItemWorkout(row, itemId);
  });
