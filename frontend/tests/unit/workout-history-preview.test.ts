import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarWeeks,
  createPreviewHistory,
  localDateKey,
  shiftDay,
  shiftMonth,
  workoutStreak,
} from "../../lib/workout-history-preview.ts";

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

test("preview starts with a three-day streak and never invents a completed today or future day", () => {
  const today = "2026-09-27";
  const completed = createPreviewHistory(today);
  assert.equal(workoutStreak(completed, today), 3);
  assert.equal(completed.has(today), false);
  assert.ok([...completed].every((day) => day < today));
  completed.add(today);
  assert.equal(workoutStreak(completed, today), 4);
  assert.equal(createPreviewHistory(today).has(today), false);
});
