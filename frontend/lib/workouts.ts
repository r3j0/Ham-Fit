import { api } from "./session";
import type { BirthProfile, Workout, WorkoutPage } from "./workout-types";

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
export const getWorkout = (id: string, signal?: AbortSignal) =>
  api<Workout>(`/workouts/${encodeURIComponent(id)}`, { signal }).then(
    (r) => r.data,
  );
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
export const sendWorkoutEvent = (id: string, key: string, body: string) =>
  api<Workout>(`/workouts/${encodeURIComponent(id)}/events`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body,
  }).then((r) => r.data);
