import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceWorkout,
  initialWorkout,
  resultError,
  resultValue,
  isWorkoutState,
  interruptedWorkout,
} from "../../lib/workout.ts";
import {
  adultAssessment,
  bmiFrom,
  calculateBodyItems,
  setupErrors,
  assessmentInput,
  type AssessmentSetup,
} from "../../lib/assessment.ts";
import type { Catalog } from "../../lib/types.ts";
const definition = adultAssessment();
test("countdown and 60-second test require full elapsed time, never manual early completion", () => {
  let s = initialWorkout();
  assert.equal(
    advanceWorkout(definition, s, { type: "record", value: "5" }),
    s,
  );
  s = advanceWorkout(definition, s, { type: "start", now: 1000 });
  s = advanceWorkout(definition, s, { type: "tick", now: 3999 });
  assert.equal(s.phase, "countdown");
  s = advanceWorkout(definition, s, { type: "tick", now: 4000 });
  assert.equal(s.phase, "active");
  assert.equal(s.remainingMs, 60000);
  assert.equal(advanceWorkout(definition, s, { type: "finish", now: 5000 }), s);
  s = advanceWorkout(definition, s, { type: "tick", now: 63999 });
  assert.equal(s.phase, "active");
  s = advanceWorkout(definition, s, { type: "tick", now: 64000 });
  assert.equal(s.phase, "record");
  s = advanceWorkout(definition, s, { type: "record", value: "0" });
  assert.equal(s.results.endurance, "0");
  assert.equal(s.index, 1);
});
test("YMCA chains 180 seconds, 60 seconds recovery, 10 seconds pulse without lost callback time", () => {
  let s = advanceWorkout(definition, initialWorkout(), { type: "skip" });
  s = advanceWorkout(definition, s, { type: "start", now: 0 });
  s = advanceWorkout(definition, s, { type: "tick", now: 184250 });
  assert.equal(s.segmentIndex, 1);
  assert.equal(s.remainingMs, 58750);
  s = advanceWorkout(definition, s, { type: "tick", now: 243000 });
  assert.equal(s.segmentIndex, 2);
  assert.equal(s.remainingMs, 10000);
  s = advanceWorkout(definition, s, { type: "tick", now: 253000 });
  assert.equal(s.phase, "record");
  assert.ok(resultError(definition.steps[1], "0"));
  assert.equal(resultValue(definition.steps[1], "15"), "90");
  s = advanceWorkout(definition, s, { type: "record", value: "15" });
  assert.equal(s.results.cardio, "15");
});
test("interruption restarts only current test; skip is distinct from zero; retesting returns to review", () => {
  let s = advanceWorkout(definition, initialWorkout(), { type: "skip" });
  s = advanceWorkout(definition, s, { type: "start", now: 0 });
  s = interruptedWorkout(s);
  assert.equal(s.phase, "interrupted");
  assert.deepEqual(s.skipped, ["endurance"]);
  s = advanceWorkout(definition, s, { type: "start", now: 20000 });
  assert.equal(s.remainingMs, 3000);
  s = advanceWorkout(definition, s, { type: "interrupt" });
  s = advanceWorkout(definition, s, { type: "skip" });
  s = advanceWorkout(definition, s, { type: "start", now: 21000 });
  assert.equal(s.phase, "record");
  s = advanceWorkout(definition, s, { type: "record", value: "-2.5" });
  assert.equal(s.phase, "review");
  assert.deepEqual(s.results, { flexibility: "-2.5" });
  assert.ok(isWorkoutState(s, definition));
  s = advanceWorkout(definition, s, { type: "repeat", index: 0 });
  s = advanceWorkout(definition, s, { type: "skip" });
  assert.equal(s.phase, "review");
  assert.equal(s.results.flexibility, "-2.5");
});
test("the reusable runner supports count-up segments without an assessment-specific test", () => {
  const d = adultAssessment();
  d.steps[0] = {
    ...d.steps[0],
    segments: [
      {
        id: "practice",
        title: "자유 연습",
        durationSeconds: null,
        canFinish: true,
        cadence: { intervalMs: 3000, cues: ["시작", "돌아오기"] },
      },
    ],
  };
  let s = advanceWorkout(d, initialWorkout(), { type: "start", now: 0 });
  s = advanceWorkout(d, s, { type: "tick", now: 9500 });
  assert.equal(s.elapsedMs, 6500);
  assert.equal(d.steps[0].segments[0].cadence?.intervalMs, 3000);
  assert.equal(
    advanceWorkout(d, s, { type: "finish", now: 10000 }).phase,
    "record",
  );
  assert.equal(isWorkoutState({ ...s, segmentIndex: 1 }, d), false);
  assert.equal(isWorkoutState({ ...s, runningSince: null }, d), false);
  for (const raw of ["", "-1", "0.5", "NaN", "1e3"])
    assert.ok(resultError(d.steps[0], raw));
  assert.equal(resultError(d.steps[2], "-2.5"), null);
});
const setup: AssessmentSetup = {
  age: "25",
  sex: "",
  measuredOn: "2026-09-21",
  height: "170",
  weight: "65",
  waist: "",
};
test("adult support, positive body values, and optional BMI", () => {
  assert.deepEqual(setupErrors(setup), {});
  assert.equal(bmiFrom("170", "65"), "22.5");
  assert.equal(bmiFrom("170", ""), null);
  for (const age of ["18", "65", "", "20.5"])
    assert.ok(setupErrors({ ...setup, age }).age);
  for (const age of ["19", "64"])
    assert.equal(setupErrors({ ...setup, age }).age, undefined);
  assert.ok(setupErrors({ ...setup, height: "0" }).height);
});
test("save payload has only measured values and separate pulse units; no fabricated skipped values", () => {
  const codes = [
    ["height", "cm"],
    ["weight", "kg"],
    ["bmi", "kg/m²"],
    ["waist_circumference", "cm"],
    ["cross_sit_up", "회"],
    ["ymca_recovery_heart_rate", "bpm"],
    ["sit_and_reach", "cm"],
  ];
  const catalog: Catalog = {
    version: "test",
    checkedOn: "2026-09-21",
    age: null,
    definitions: codes.map(([code, unit]) => ({
      code,
      unit,
      label: code,
      category: "",
      factor: "",
      valueType: "decimal",
      minAge: 19,
      maxAge: 64,
      minValue: null,
      maxValue: null,
      minInclusive: true,
      sourceUrls: [],
    })),
  };
  const state = {
    ...initialWorkout(),
    phase: "review" as const,
    results: { cardio: "15", flexibility: "-2.5" },
    skipped: ["endurance"],
  };
  const built = assessmentInput(setup, state, catalog, "2026-09-21");
  assert.deepEqual(built.errors, {});
  assert.equal(built.input.entryMethod, "self_assessment");
  assert.equal(built.input.reportKind, "unknown");
  assert.deepEqual(
    built.input.items.map((i) => [i.measurementCode, i.value]),
    [
      ["height", "170"],
      ["weight", "65"],
      ["bmi", "22.5"],
      ["ymca_recovery_heart_rate", "90"],
      ["sit_and_reach", "-2.5"],
    ],
  );
  assert.ok(
    assessmentInput(
      { ...setup, height: "", weight: "" },
      { ...state, results: {} },
      catalog,
      "2026-09-21",
    ).errors.items,
  );
});

test("editing body measurements recalculates BMI and removes it when either source is removed", () => {
  const items = [
    { code: "height", value: "170", grade: "" },
    { code: "weight", value: "65", grade: "" },
    { code: "bmi", value: "100", grade: "" },
  ];
  assert.equal(
    calculateBodyItems(items).find((i) => i.code === "bmi")?.value,
    "22.5",
  );
  assert.equal(
    calculateBodyItems(items.filter((i) => i.code !== "weight")).some(
      (i) => i.code === "bmi",
    ),
    false,
  );
});
