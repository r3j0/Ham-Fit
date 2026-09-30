import {
  invalid,
  object,
  uuid,
  text,
  timestamp,
  number,
  integer,
  pageOf,
} from "./api-contract.ts";
import { isWorkoutDate } from "./workout-history.ts";
import type {
  Workout,
  WorkoutStatus,
  WorkoutResult,
  PlaybackInterval,
} from "./workout-types.ts";

export interface Prescription {
  doseType: "reps" | "hold" | "timed";
  value: string;
  unit: string;
  sets: number;
  restSec: number;
  text: string;
}
export interface RoutineItem {
  id: string;
  order: number;
  videoId: string;
  title: string;
  videoUrl: string;
  slot:
    "flexibility_group" | "agility_power_group" | "strength_group" | "cooldown";
  prescription: Prescription;
  status: WorkoutStatus;
  resultStatus: WorkoutResult | null;
  performedAt: string | null;
  completedAt: string | null;
  revision: number;
  playbackUrl: string | null;
  playbackStatus: "verified" | "unavailable" | "duration_mismatch";
  verifiedDurationSeconds: number | null;
  progress: {
    durationSeconds: number;
    watchedSeconds: number;
    positionSeconds: number;
    intervals: PlaybackInterval[];
  };
}
export interface WorkoutRoutine {
  id: string;
  koreanDate: string;
  referenceDate: string;
  serverKoreanDate: string;
  serverTime: string;
  recordingAllowed: boolean;
  recordingExpiresAt: string;
  /** Client-only monotonic deadline, conservatively reduced by the request duration. */
  recordingDeadline?: number;
  cardioRecommendation: { activity: "걷기" | "뛰기"; minutes: number } | null;
  createdAt: string;
  status: WorkoutStatus;
  estimatedMinutes: number;
  progress: { completedItems: number; totalItems: number };
  algorithmVersion: string;
  dataVersion: string;
  inputSnapshot: unknown;
  weightAdjustment: unknown;
  routine: RoutineItem[];
}
const statuses = [
  "assigned",
  "in_progress",
  "not_performed",
  "interrupted",
  "completed",
];
const httpUrl = (value: unknown) =>
  typeof value === "string" && /^https?:\/\//.test(value);
function parseItem(value: unknown): RoutineItem {
  const item = object(value),
    p = object(item.prescription),
    progress = object(item.progress);
  if (
    !uuid(item.id) ||
    !integer(item.order, 1) ||
    !text(item.videoId) ||
    !text(item.title) ||
    !httpUrl(item.videoUrl) ||
    ![
      "flexibility_group",
      "agility_power_group",
      "strength_group",
      "cooldown",
    ].includes(String(item.slot)) ||
    !statuses.includes(String(item.status)) ||
    ![null, "not_performed", "interrupted", "completed"].includes(
      item.resultStatus as null | string,
    ) ||
    !integer(item.revision, 1) ||
    !(item.performedAt === null || timestamp(item.performedAt)) ||
    !(item.completedAt === null || timestamp(item.completedAt)) ||
    (item.status === "completed" &&
      (!timestamp(item.completedAt) || item.resultStatus !== "completed")) ||
    (item.status !== "completed" && item.completedAt !== null) ||
    !["reps", "hold", "timed"].includes(String(p.doseType)) ||
    !text(p.value) ||
    !text(p.unit) ||
    !text(p.text) ||
    !integer(p.sets, 1) ||
    !number(p.restSec) ||
    !number(progress.durationSeconds, Number.MIN_VALUE) ||
    !number(progress.watchedSeconds) ||
    !number(progress.positionSeconds) ||
    progress.watchedSeconds > progress.durationSeconds ||
    progress.positionSeconds > progress.durationSeconds ||
    !Array.isArray(progress.intervals) ||
    !["verified", "unavailable", "duration_mismatch"].includes(
      String(item.playbackStatus),
    ) ||
    !(
      item.playbackUrl === null ||
      (typeof item.playbackUrl === "string" &&
        item.playbackUrl.startsWith("https://"))
    ) ||
    !(
      item.verifiedDurationSeconds === null ||
      number(item.verifiedDurationSeconds, Number.MIN_VALUE)
    ) ||
    (item.playbackStatus === "verified" &&
      (!item.playbackUrl || !item.verifiedDurationSeconds)) ||
    (item.playbackStatus !== "verified" && item.playbackUrl !== null)
  )
    invalid();
  let end = -1,
    watched = 0;
  for (const value of progress.intervals) {
    const interval = object(value);
    if (
      !number(interval.start) ||
      !number(interval.end) ||
      interval.end <= interval.start ||
      interval.start < end ||
      interval.end > progress.durationSeconds
    )
      invalid();
    end = interval.end;
    watched += interval.end - interval.start;
  }
  if (Math.abs(watched - progress.watchedSeconds) > 0.00001) invalid();
  return item as unknown as RoutineItem;
}
export function parseRoutine(value: unknown, roundTripMs = 0): WorkoutRoutine {
  const row = object(value),
    progress = object(row.progress);
  if (
    !uuid(row.id) ||
    ![row.koreanDate, row.referenceDate, row.serverKoreanDate].every(
      (day) => typeof day === "string" && isWorkoutDate(day),
    ) ||
    !timestamp(row.createdAt) ||
    !timestamp(row.serverTime) ||
    !timestamp(row.recordingExpiresAt) ||
    typeof row.recordingAllowed !== "boolean" ||
    row.recordingAllowed !== (row.koreanDate === row.serverKoreanDate) ||
    !statuses.includes(String(row.status)) ||
    !number(row.estimatedMinutes, Number.MIN_VALUE) ||
    !text(row.algorithmVersion) ||
    !text(row.dataVersion) ||
    !integer(progress.completedItems) ||
    !integer(progress.totalItems, 1) ||
    !Array.isArray(row.routine) ||
    !row.routine.length
  )
    invalid();
  const expires = Date.parse(`${row.koreanDate}T00:00:00+09:00`) + 86400000;
  if (
    Date.parse(row.recordingExpiresAt as string) !== expires ||
    new Date(Date.parse(row.serverTime as string) + 9 * 3600000)
      .toISOString()
      .slice(0, 10) !== row.serverKoreanDate
  )
    invalid();
  if (row.cardioRecommendation !== null) {
    const cardio = object(row.cardioRecommendation);
    if (
      !["걷기", "뛰기"].includes(String(cardio.activity)) ||
      !integer(cardio.minutes, 1) ||
      Object.keys(cardio).some((key) => !["activity", "minutes"].includes(key))
    )
      invalid();
  }
  const items = row.routine.map(parseItem);
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    new Set(items.map((item) => item.videoId)).size !== items.length ||
    items.some((item, index) => item.order !== index + 1) ||
    progress.totalItems !== items.length ||
    progress.completedItems !==
      items.filter((item) => item.status === "completed").length ||
    (row.status === "completed") !== (progress.completedItems === items.length)
  )
    invalid();
  return {
    ...row,
    routine: items,
    recordingDeadline:
      performance.now() +
      Math.max(
        0,
        expires -
          Date.parse(row.serverTime as string) -
          Math.max(0, roundTripMs),
      ),
  } as unknown as WorkoutRoutine;
}
export const parseRoutinePage = (value: unknown, roundTripMs = 0) =>
  pageOf(value, (row) => parseRoutine(row, roundTripMs));

/** Identity includes the routine and item, and cannot collide with a legacy UUID. */
export const routineWorkoutId = (routineId: string, itemId: string) =>
  `routine:${routineId}:${itemId}`;
export function routineIdentity(id: string) {
  if (!id.startsWith("routine:")) return null;
  const parts = id.split(":");
  if (parts.length !== 3 || !uuid(parts[1]) || !uuid(parts[2])) invalid();
  return { routineId: parts[1], itemId: parts[2] };
}
/** Adapt saved server fields to the existing player/calendar without inventing prescriptions. */
export function routineWorkouts(row: WorkoutRoutine): Workout[] {
  return row.routine.map((item) => ({
    id: routineWorkoutId(row.id, item.id),
    recording: {
      allowed: row.recordingAllowed,
      serverTime: row.serverTime,
      expiresAt: row.recordingExpiresAt,
      deadline:
        row.recordingDeadline ??
        performance.now() +
          Math.max(
            0,
            Date.parse(row.recordingExpiresAt) - Date.parse(row.serverTime),
          ),
    },
    routine: {
      id: row.id,
      itemId: item.id,
      order: item.order,
      totalItems: row.routine.length,
      prescription: item.prescription,
    },
    koreanDate: row.koreanDate,
    serverKoreanDate: row.serverKoreanDate,
    status: item.status,
    resultStatus: item.resultStatus,
    revision: item.revision,
    assignedAt: row.createdAt,
    performedAt: item.performedAt,
    completedAt: item.completedAt,
    video: {
      id: item.videoId,
      title: item.title,
      originalUrl: item.videoUrl,
      durationSeconds: item.progress.durationSeconds,
      equipment: [],
      catalogVersion: row.dataVersion,
      ageGroup: "",
      fitnessWeights: {},
      playbackUrl: item.playbackUrl,
      playbackStatus: item.playbackStatus,
      verifiedDurationSeconds: item.verifiedDurationSeconds,
    },
    progress: {
      ...item.progress,
      ratio: item.progress.watchedSeconds / item.progress.durationSeconds,
    },
    algorithmVersion: row.algorithmVersion,
    inputSnapshot: row.inputSnapshot,
    weightAdjustment: row.weightAdjustment,
  }));
}
export function workoutHref(workout: Workout, replay = false, profile = false) {
  if (workout.routine)
    return `${profile ? "/account" : ""}/workout-routines/${workout.routine.id}/items/${workout.routine.itemId}${replay ? "/replay" : ""}`;
  return `${profile && replay ? "/account" : ""}/workouts/${workout.id}${replay ? "/replay" : ""}`;
}
