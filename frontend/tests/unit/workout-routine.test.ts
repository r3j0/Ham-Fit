import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRoutine,
  parseRoutinePage,
  routineWorkouts,
  routineIdentity,
  workoutHref,
} from "../../lib/workout-routine.ts";
import { routineFixture } from "../fixtures/routine.ts";
import { completedDate } from "../../lib/workout-history.ts";

test("routine adapter preserves individual prescriptions, revisions and actual playback progress", () => {
  const row = routineFixture();
  row.routine[0] = {
    ...row.routine[0],
    status: "completed",
    resultStatus: "completed",
    completedAt: "2026-09-28T15:01:00Z",
    revision: 4,
    progress: {
      durationSeconds: 60,
      watchedSeconds: 15,
      positionSeconds: 15,
      intervals: [{ start: 0, end: 15 }],
    },
  };
  row.progress.completedItems = 1;
  row.status = "interrupted";
  const workouts = routineWorkouts(parseRoutine(row));
  assert.equal(workouts.length, 3);
  assert.equal(workouts[0].progress.ratio, 0.25);
  assert.equal(workouts[0].revision, 4);
  assert.equal(workouts[1].status, "assigned");
  assert.equal(workouts[0].routine?.prescription.text, "10회 반복");
  assert.equal(completedDate(workouts[0]), "2026-09-29");
  assert.deepEqual(routineIdentity(workouts[0].id), {
    routineId: row.id,
    itemId: row.routine[0].id,
  });
  assert.equal(
    workoutHref(workouts[0], true, true),
    `/account/workout-routines/${row.id}/items/${row.routine[0].id}/replay`,
  );
});
test("rejects incomplete, conflicting and unsafe API responses instead of synthesizing a routine", () => {
  const mutations: ((row: ReturnType<typeof routineFixture>) => void)[] = [
    (row) => {
      row.routine = [];
    },
    (row) => {
      row.progress.totalItems = 7;
    },
    (row) => {
      row.routine[1].id = row.routine[0].id;
    },
    (row) => {
      row.routine[0].order = 2;
    },
    (row) => {
      row.routine[0].progress.watchedSeconds = 40;
    },
    (row) => {
      row.routine[0].progress.intervals = [{ start: 0, end: 70 }];
    },
    (row) => {
      row.status = "completed";
    },
    (row) => {
      row.routine[0].status = "completed";
    },
    (row) => {
      row.koreanDate = "2026-02-30";
    },
    (row) => {
      row.routine[0].playbackUrl = "javascript:alert(1)";
    },
    (row) => {
      row.routine[0].playbackStatus = "verified";
    },
    (row) => {
      row.routine[0].prescription.sets = 0;
    },
  ];
  for (const mutate of mutations) {
    const row = routineFixture();
    mutate(row);
    assert.throws(() => parseRoutine(row));
  }
  assert.throws(() => parseRoutinePage({ items: [], nextCursor: "bad" }));
  assert.throws(() => routineIdentity("routine:wrong:wrong"));
});
test("future allocations preserve their date and incomplete items do not create completion days", () => {
  const row = routineFixture();
  row.koreanDate = "2026-09-30";
  row.referenceDate = "2026-09-29";
  const [workout] = routineWorkouts(parseRoutine(row));
  assert.equal(workout.koreanDate, "2026-09-30");
  assert.equal(completedDate(workout), null);
  assert.equal(routineIdentity("00000000-0000-4000-8000-000000000001"), null);
});
