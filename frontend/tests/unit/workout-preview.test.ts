import assert from "node:assert/strict";
import test from "node:test";
import {
  workoutPreviewLengthSeconds,
  workoutPreviewSegment,
} from "../../lib/workout-preview.ts";

test("preview starts at the midpoint and lasts ten seconds when space remains", () => {
  assert.deepEqual(workoutPreviewSegment(60), { start: 30, end: 40 });
  assert.equal(workoutPreviewLengthSeconds, 10);
});

test("preview stays within short videos and rejects invalid durations", () => {
  assert.deepEqual(workoutPreviewSegment(12), { start: 2, end: 12 });
  assert.deepEqual(workoutPreviewSegment(8), { start: 0, end: 8 });
  assert.deepEqual(workoutPreviewSegment(Number.NaN), { start: 0, end: 0 });
});
