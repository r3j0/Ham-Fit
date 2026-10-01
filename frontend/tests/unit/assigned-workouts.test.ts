import test from "node:test";
import assert from "node:assert/strict";
import {
  assignedWorkoutsForDay,
  currentWorkoutStep,
} from "../../lib/assigned-workouts.ts";
import { routineFixture } from "../fixtures/routine.ts";
import { routineWorkouts } from "../../lib/workout-routine.ts";
import type { Workout } from "../../lib/workout-types.ts";
const row = (
  id: string,
  day: string,
  revision = 1,
  assignedAt = `${day}T00:00:00Z`,
) => ({ id, koreanDate: day, revision, assignedAt }) as Workout;

test("today advances through the ordered first unfinished item without changing history", () => {
  const routine = routineFixture();
  const rows = routineWorkouts(routine);
  const input = [rows[2], rows[0], rows[1]];
  const ordered = assignedWorkoutsForDay(input, routine.koreanDate);
  assert.deepEqual(
    ordered.map((item) => item.id),
    rows.map((item) => item.id),
  );
  assert.deepEqual(currentWorkoutStep(ordered), {
    workout: rows[0],
    started: false,
  });
  rows[0].status = "completed";
  rows[2].status = "completed";
  assert.deepEqual(currentWorkoutStep(ordered), {
    workout: rows[1],
    started: true,
  });
  rows[1].status = "completed";
  assert.deepEqual(currentWorkoutStep(ordered), {
    workout: null,
    started: true,
  });
  assert.deepEqual(currentWorkoutStep([]), { workout: null, started: false });
  assert.deepEqual(
    input.map((item) => item.id),
    [rows[2].id, rows[0].id, rows[1].id],
  );
});

test("started or interrupted workouts resume even before the first item is completed", () => {
  for (const status of [
    "in_progress",
    "interrupted",
    "not_performed",
  ] as const) {
    const rows = routineWorkouts(routineFixture());
    rows[0].status = status;
    assert.deepEqual(currentWorkoutStep(rows), {
      workout: rows[0],
      started: true,
    });
  }
  for (const evidence of [
    "performedAt",
    "watchedSeconds",
    "positionSeconds",
  ] as const) {
    const rows = routineWorkouts(routineFixture());
    if (evidence === "performedAt")
      rows[0].performedAt = "2026-09-29T03:00:00Z";
    else rows[0].progress[evidence] = 1;
    assert.equal(currentWorkoutStep(rows).started, true);
    assert.equal(currentWorkoutStep(rows).workout, rows[0]);
  }
});

test("daily lists keep every same-day assignment in assignment order and exclude older/future days", () => {
  const a = row("a", "2026-09-27", 1, "2026-09-27T01:00:00Z");
  const b = row("b", "2026-09-27", 1, "2026-09-27T00:00:00Z");
  const result = assignedWorkoutsForDay(
    [a, row("old", "2026-09-26"), row("future", "2026-09-28"), b],
    "2026-09-27",
  );
  assert.deepEqual(result, [b, a]);
  assert.deepEqual(assignedWorkoutsForDay([a, b], "2026-09-28"), []);
});
test("current/history overlap keeps the newest revision without duplicating or losing other assignments", () => {
  const current = {
    ...row("a", "2026-09-27", 2),
    status: "completed",
  } as Workout;
  const second = row("b", "2026-09-27");
  assert.deepEqual(
    assignedWorkoutsForDay(
      [current, second, row("a", "2026-09-27")],
      "2026-09-27",
    ),
    [current, second],
  );
});
