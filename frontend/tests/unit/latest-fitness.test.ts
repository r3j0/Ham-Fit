import test from "node:test";
import assert from "node:assert/strict";
import { parseLatestFitness } from "../../lib/latest-fitness.ts";
import {
  storedRecordFixture,
  recordIdentity,
} from "../fixtures/measurement-evaluation.ts";
const profile = () => ({
  measurementId: recordIdentity.id,
  measuredOn: recordIdentity.measuredOn,
  revision: 1,
  axes: storedRecordFixture().axes,
});
function empty() {
  return {
    measurementId: null,
    measuredOn: null,
    revision: null,
    axes: storedRecordFixture().axes.map((a) => ({
      ...a,
      status: "not_measured",
      grade: null,
      representativeMeasurementCode: null,
      measuredMeasurementCodes: [],
      recordRevision: null,
    })),
  };
}
test("latest polygon needs no item details and retains the server-selected record", () => {
  const raw = profile();
  raw.axes.reverse();
  const result = parseLatestFitness(raw)!;
  assert.deepEqual(result.measurement, recordIdentity);
  assert.equal(result.axes.length, 6);
  assert.equal(result.axes[3].grade, 2);
});
test("only an explicit empty identity and six empty axes mean no record", () => {
  assert.equal(parseLatestFitness(empty()), null);
  for (const value of [
    null,
    {},
    { ...empty(), axes: [] },
    { ...empty(), revision: 1 },
    { ...empty(), axes: profile().axes },
  ])
    assert.throws(() => parseLatestFitness(value));
});
test("old proposed contracts, invalid dates, malformed identity and stale revisions are rejected", () => {
  for (const value of [
    { measurement: recordIdentity, evaluation: null },
    { ...profile(), revision: 2 },
    { ...profile(), measurementId: "../other" },
    { ...profile(), measuredOn: "2026-02-30" },
    { ...profile(), measuredOn: "0000-01-01" },
    { ...profile(), revision: 0 },
  ])
    assert.throws(() => parseLatestFitness(value));
});
test("unavailable evaluation on a measured axis stays distinct from no measurements", () => {
  const raw = profile();
  Object.assign(raw.axes[3], {
    grade: null,
    status: "unevaluable",
    reasonCode: "all_measurements_unevaluable",
  });
  const result = parseLatestFitness(raw)!;
  assert.equal(result.axes[3].status, "unevaluable");
  assert.equal(result.axes[0].status, "not_measured");
});
test("partial records never gain grades from other records", () => {
  const result = parseLatestFitness(profile())!;
  assert.equal(
    result.axes.filter((a) => a.status === "not_measured").length,
    5,
  );
  assert.deepEqual(
    result.axes.map((a) => a.grade),
    [null, null, null, 2, null, null],
  );
});
