import test from "node:test";
import assert from "node:assert/strict";
import { assignedWorkoutsForDay } from "../../lib/assigned-workouts.ts";
import type { Workout } from "../../lib/workout-types.ts";
const row = (
  id: string,
  day: string,
  revision = 1,
  assignedAt = `${day}T00:00:00Z`,
) => ({ id, koreanDate: day, revision, assignedAt }) as Workout;

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
