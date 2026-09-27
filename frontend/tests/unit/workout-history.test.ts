import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarWeeks,
  isWorkoutDate,
  completedDate,
  collectWorkoutHistory,
  koreanDateKey,
  localDateKey,
  shiftDay,
  shiftMonth,
  workoutStreak,
} from "../../lib/workout-history.ts";

test("calendar keys use local dates and cross month, year, and leap-day boundaries", () => {
  assert.equal(localDateKey(new Date(2026, 8, 27, 0, 5)), "2026-09-27");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDay("2024-03-01", -1), "2024-02-29");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2026-03-08", 1), "2026-03-09");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2025-12", 1), "2026-01");
});

test("monthly calendars preserve weekday positions with four, five, or six complete rows", () => {
  const february = calendarWeeks("2026-02");
  assert.equal(february.length, 4);
  assert.equal(february[0][0], "2026-02-01");
  const leapFebruary = calendarWeeks("2024-02");
  assert.equal(leapFebruary.flat().filter(Boolean).length, 29);
  assert.equal(leapFebruary[0][4], "2024-02-01");
  const august = calendarWeeks("2026-08");
  assert.equal(august.length, 6);
  assert.equal(august[0][6], "2026-08-01");
  assert.equal(august[5][1], "2026-08-31");
  assert.equal(august.flat().filter(Boolean).length, 31);
  for (const week of [...february, ...leapFebruary, ...august])
    assert.equal(week.length, 7);
});

test("streaks include today or remain active through yesterday, but stop at a missed day", () => {
  const days = new Set(["2025-12-30", "2025-12-31", "2026-01-01"]);
  assert.equal(workoutStreak(days, "2026-01-01"), 3);
  assert.equal(workoutStreak(days, "2026-01-02"), 3);
  assert.equal(workoutStreak(days, "2026-01-03"), 0);
  days.delete("2025-12-31");
  assert.equal(workoutStreak(days, "2026-01-01"), 1);
  assert.equal(workoutStreak(new Set(), "2026-01-01"), 0);
});

test("completion dates follow Korean midnight and ignore unfinished or missing timestamps", () => {
  assert.equal(koreanDateKey(new Date("2026-09-26T14:59:59Z")), "2026-09-26");
  assert.equal(koreanDateKey(new Date("2026-09-26T15:00:00Z")), "2026-09-27");
  assert.equal(
    completedDate({ status: "completed", completedAt: "2026-09-26T15:00:00Z" }),
    "2026-09-27",
  );
  for (const status of [
    "assigned",
    "in_progress",
    "interrupted",
    "not_performed",
  ] as const)
    assert.equal(
      completedDate({ status, completedAt: "2026-09-26T15:00:00Z" }),
      null,
    );
  assert.equal(completedDate({ status: "completed", completedAt: null }), null);
  assert.equal(
    completedDate({ status: "completed", completedAt: "invalid" }),
    null,
  );
});

const row = (id: string, revision = 1) =>
  ({ id, revision }) as import("../../lib/workout-types.ts").Workout;
test("history follows every cursor and keeps the highest revision of overlapping records", async () => {
  const cursors: (string | undefined)[] = [];
  const rows = await collectWorkoutHistory(async (cursor) => {
    cursors.push(cursor);
    return cursor === undefined
      ? { items: [row("a"), row("b", 3)], nextCursor: "b" }
      : cursor === "b"
        ? { items: [row("b", 2), row("c")], nextCursor: "c" }
        : { items: [row("a", 4), row("d")], nextCursor: null };
  });
  assert.deepEqual(cursors, [undefined, "b", "c"]);
  assert.deepEqual(rows, [row("a", 4), row("b", 3), row("c"), row("d")]);
});
test("a failed or looping page never produces a partial successful history", async () => {
  await assert.rejects(
    collectWorkoutHistory(async (cursor) => {
      if (cursor) throw new Error("offline");
      return { items: [row("a")], nextCursor: "a" };
    }),
    /offline/,
  );
  await assert.rejects(
    collectWorkoutHistory(async () => ({ items: [row("a")], nextCursor: "a" })),
    /Repeated/,
  );
});
test("aborting an old user read prevents further page reads and rejects its result", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    collectWorkoutHistory(async () => {
      calls++;
      controller.abort();
      return { items: [row("a")], nextCursor: "a" };
    }, controller.signal),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});

test("history date routes accept real dates and reject normalized or malformed dates", () => {
  for (const value of ["2026-09-27", "2024-02-29", "2025-12-31"])
    assert.equal(isWorkoutDate(value), true);
  for (const value of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-09-00",
    "2026-9-1",
    "2026-09-27T00:00:00Z",
    "",
    "invalid",
  ])
    assert.equal(isWorkoutDate(value), false);
});
