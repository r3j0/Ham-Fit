import assert from "node:assert/strict";
import { test } from "node:test";
import { birthDateError, ageOnDate } from "../../lib/birth-profile.ts";
test("date-only birth input matches the server calendar contract", () => {
  for (const date of [
    "",
    "0000-01-01",
    "2001-02-29",
    "2026-09-28",
    "2000-01-01T00:00:00Z",
    "2000-2-01",
  ])
    assert.ok(birthDateError(date, "2026-09-27"), date);
  for (const date of ["2000-02-29", "2026-09-27", "1950-01-01", "0001-01-01"])
    assert.equal(birthDateError(date, "2026-09-27"), undefined, date);
});

test("measurement age uses the historical date and birthday boundary", () => {
  assert.equal(ageOnDate("2001-10-01", "2026-09-30"), 24);
  assert.equal(ageOnDate("2001-10-01", "2026-10-01"), 25);
  assert.equal(ageOnDate("2001-10-01", "2025-10-01"), 24);
  assert.equal(ageOnDate("2000-02-29", "2025-02-28"), 24);
  assert.equal(ageOnDate("2000-02-29", "2025-03-01"), 25);
  for (const day of ["", "2026-02-30", "2000-01-01"])
    assert.equal(ageOnDate("2001-10-01", day), null);
  assert.equal(ageOnDate("2001-02-29", "2026-09-30"), null);
});
