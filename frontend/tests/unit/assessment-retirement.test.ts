import test from "node:test";
import assert from "node:assert/strict";
import { adultAssessment } from "../../lib/assessment.ts";
import { isRetiredMeasurement } from "../../lib/measurement-form.ts";
import { initialWorkout, isWorkoutState } from "../../lib/workout.ts";
import {
  restoreWorkoutDraft,
  readWorkoutProgress,
  saveWorkoutProgress,
  setWorkoutOwner,
} from "../../lib/workout-progress.ts";

const legacy = () => ({
  setup: {
    age: "25",
    sex: "male",
    height: "170",
    weight: "65",
    waist: "",
    measuredOn: "2026-09-24",
    endurance: "curl",
  },
  stage: "session",
  catalogVersion: "test",
  pending: null,
  state: {
    ...initialWorkout(),
    phase: "review",
    index: 2,
    results: { endurance: "20", cardio: "15", flexibility: "-2" },
  },
});

test("retiring adult self curl-ups keeps official youth curl-ups and the shared runner", () => {
  assert.equal(isRetiredMeasurement("self_curl_up"), true);
  assert.equal(isRetiredMeasurement("curl_up"), false);
  assert.deepEqual(
    adultAssessment().steps.map((s) => s.result.code),
    ["cross_sit_up", "ymca_recovery_heart_rate", "sit_and_reach"],
  );
});

test("legacy review drops only curl-up results instead of relabeling them as cross sit-ups", () => {
  const before = legacy();
  const restored = restoreWorkoutDraft(before)!;
  assert.deepEqual(restored.state.results, { cardio: "15", flexibility: "-2" });
  assert.deepEqual(restored.state.skipped, ["endurance"]);
  assert.equal(restored.setup.weight, "65");
  assert.equal(restored.removedEndurance, true);
  assert.equal(isWorkoutState(restored.state, adultAssessment()), true);
  assert.deepEqual(restoreWorkoutDraft(restored), restored);
  assert.equal(before.state.results.endurance, "20");
});

test("legacy active or unsubmitted curl-ups restart as a fresh cross sit-up step", () => {
  for (const phase of [
    "ready",
    "countdown",
    "active",
    "record",
    "interrupted",
  ] as const) {
    const restored = restoreWorkoutDraft({
      ...legacy(),
      state: {
        ...initialWorkout(),
        phase,
        elapsedMs: 90000,
        draftValue: "20",
        runningSince: ["active", "countdown"].includes(phase) ? 1234 : null,
      },
    })!;
    assert.ok(restored);
    assert.deepEqual(restored.state, initialWorkout());
    assert.equal(isWorkoutState(restored.state, adultAssessment()), true);
  }
});

test("legacy cross sit-up results and progress remain intact", () => {
  const before = legacy();
  before.setup.endurance = "cross";
  const restored = restoreWorkoutDraft(before)!;
  assert.deepEqual(restored.state, before.state);
  assert.equal(restored.removedEndurance, undefined);
  assert.equal(
    restoreWorkoutDraft({
      ...before,
      setup: { ...before.setup, endurance: "unknown" },
    }),
    null,
  );
});

test("legacy pending curl-up saves retain their exact request through migration and expiry", () => {
  const pending = {
    key: "12345678-1234-1234-1234-123456789012",
    body: JSON.stringify({
      catalogVersion: "test",
      entryMethod: "self_assessment",
      reportKind: "simple",
      items: [{ measurementCode: "self_curl_up", value: "20", unit: "회" }],
    }),
  };
  const restored = restoreWorkoutDraft({ ...legacy(), pending })!;
  assert.deepEqual(restored.pending, pending);
  assert.equal(restored.state.results.endurance, undefined);
  const now = Date.now;
  try {
    setWorkoutOwner("migration", true);
    saveWorkoutProgress("migration", restored);
    Date.now = () => now() + 25 * 3600000;
    assert.deepEqual(readWorkoutProgress("migration")?.pending, pending);
  } finally {
    Date.now = now;
    setWorkoutOwner(null, true);
  }
});
