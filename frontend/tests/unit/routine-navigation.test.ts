import test from "node:test";
import assert from "node:assert/strict";
import { afterRoutineItemHref } from "../../lib/workout-practice.ts";
import { routineFixture } from "../fixtures/routine.ts";

test("an incomplete video advances in order and only all completed videos reach routine completion", () => {
  const row = routineFixture();
  row.routine[0].status = "interrupted";
  assert.equal(
    afterRoutineItemHref(row, row.routine[0].id),
    `/workout-routines/${row.id}/items/${row.routine[1].id}`,
  );
  row.routine[1].status = row.routine[2].status = "completed";
  assert.equal(afterRoutineItemHref(row, row.routine[2].id), "/workout");
  assert.equal(afterRoutineItemHref(row, row.routine[0].id), "/workout");
  row.routine[0].status = "completed";
  assert.equal(
    afterRoutineItemHref(row, row.routine[2].id),
    `/workout-routines/${row.id}/complete`,
  );
});
