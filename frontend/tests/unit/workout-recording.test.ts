import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canRecordWorkout,
  mergeWorkoutSnapshot,
} from "../../lib/workout-recording.ts";
import { parseRoutine, routineWorkouts } from "../../lib/workout-routine.ts";
import { routineFixture } from "../fixtures/routine.ts";

test("server time and request latency determine recording without the device calendar", () => {
  const row = routineFixture();
  row.serverTime = "2026-09-29T14:59:59.000Z";
  const before = performance.now();
  const [workout] = routineWorkouts(parseRoutine(row, 250));
  assert.ok(workout.recording!.deadline >= before + 750);
  assert.ok(workout.recording!.deadline < before + 850);
  assert.equal(
    canRecordWorkout(workout, workout.recording!.deadline - 0.001),
    true,
  );
  assert.equal(canRecordWorkout(workout, workout.recording!.deadline), false);
});
test("unchanged item revisions still accept midnight metadata, while delayed progress cannot revert it", () => {
  const [current] = routineWorkouts(parseRoutine(routineFixture()));
  const expired = {
    ...current,
    serverKoreanDate: "2026-09-30",
    recording: {
      ...current.recording!,
      allowed: false,
      serverTime: "2026-09-29T15:00:00.000Z",
    },
  };
  assert.equal(canRecordWorkout(mergeWorkoutSnapshot(current, expired)), false);
  const late = { ...current, revision: 3, status: "in_progress" as const };
  const merged = mergeWorkoutSnapshot(expired, late);
  assert.equal(merged.revision, 3);
  assert.equal(merged.serverKoreanDate, "2026-09-30");
  assert.equal(canRecordWorkout(merged), false);
});
