import test from "node:test";
import assert from "node:assert/strict";
import { resolveWorkoutMode } from "../../lib/workout-mode.ts";
test("normal workout never implicitly starts an assessment", () => {
  assert.equal(resolveWorkoutMode(), "workout");
  assert.equal(resolveWorkoutMode("assessment"), "assessment");
  assert.equal(
    resolveWorkoutMode(undefined, "adult-self-assessment-v1"),
    "assessment",
  );
  assert.equal(
    resolveWorkoutMode(undefined, "assigned-curriculum"),
    "unsupported",
  );
  assert.equal(resolveWorkoutMode(["assessment", "other"]), "unsupported");
  assert.equal(
    resolveWorkoutMode("assessment", "assigned-curriculum"),
    "unsupported",
  );
});
