import assert from "node:assert/strict";
import { test } from "node:test";
import { birthDateError } from "../../lib/birth-profile.ts";
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
