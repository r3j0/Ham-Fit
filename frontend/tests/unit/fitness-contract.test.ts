import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMeasurementEvaluation,
  parsePolygonAxes,
  formatInterval,
} from "../../lib/fitness-contract.ts";
import { gradeLabel, radarGeometry } from "../../lib/fitness-evaluation.ts";
import {
  storedRecordFixture,
  storedCatalogFixture,
  unscoredRecordFixture,
} from "../fixtures/measurement-evaluation.ts";
import { buildInput, metadataFrom } from "../../lib/measurement-form.ts";
const parse = (r = storedRecordFixture()) =>
  parseMeasurementEvaluation(r, storedCatalogFixture)!;

test("real item evaluations and axes are independent of overall certification", () => {
  const record = storedRecordFixture();
  record.axes.reverse();
  const result = parse(record);
  assert.equal(
    record.evaluation && (record.evaluation as { status: string }).status,
    "not_evaluated",
  );
  assert.equal(result.axes[3].grade, 2);
  assert.equal(result.items[0].value, "10.1");
  assert.equal(
    result.items[0].evaluation.nextTarget.adjustments[0].lower?.difference,
    "4.8",
  );
  assert.equal(
    result.items[0].evaluation.criterion?.internalVersion,
    "nfa100-adult-2025-0027-v1",
  );
  assert.deepEqual(
    radarGeometry(result.axes).points.filter((p) => p.x === 180 && p.y === 158)
      .length,
    5,
  );
});
test("legacy raw records remain readable; stored legacy evaluations still form six origin points", () => {
  const record = storedRecordFixture();
  delete (record as { axes?: unknown }).axes;
  delete (record.items[0] as { evaluation?: unknown }).evaluation;
  assert.equal(parseMeasurementEvaluation(record, storedCatalogFixture), null);
  const result = parse(unscoredRecordFixture("not_evaluated"));
  assert.equal(gradeLabel(result.axes[3]), "평가 미존재 · 미평가");
  assert.equal(
    radarGeometry(result.axes).path,
    "M 180 158 L 180 158 L 180 158 L 180 158 L 180 158 L 180 158 Z",
  );
});
test("missing information and unavailable criteria stay distinct without manufactured grades", () => {
  for (const [status, label] of [
    ["insufficient_information", "평가 불가 · 정보 부족"],
    ["criteria_unavailable", "평가 불가 · 기준 없음"],
  ] as const) {
    const result = parse(unscoredRecordFixture(status));
    assert.equal(result.axes[3].grade, null);
    assert.equal(gradeLabel(result.axes[3]), label);
    assert.equal(gradeLabel(result.axes[0]), "평가 미존재 · 미측정");
  }
});
test("stale identity, mismatched provenance, unknown grades and unsafe criteria are rejected", () => {
  const mutations: [string[], unknown][] = [
    [
      ["items", "0", "evaluation", "measurementId"],
      "00000000-0000-4000-8000-000000000009",
    ],
    [["items", "0", "evaluation", "measurementCode"], "cross_sit_up"],
    [["items", "0", "evaluation", "recordRevision"], 2],
    [["axes", "3", "recordRevision"], 2],
    [["axes", "3", "grade"], 0],
    [["axes", "3", "grade"], 6],
    [["axes", "0", "grade"], 1],
    [["axes", "1", "axis"], "flexibility"],
    [["axes", "3", "representativeMeasurementCode"], "missing"],
    [["axes", "3", "measuredMeasurementCodes"], ["missing"]],
    [["items", "0", "evaluation", "grade"], 1],
    [["items", "0", "evaluation", "criterion", "unit"], "bpm"],
    [["items", "0", "evaluation", "criterion", "sex"], "female"],
    [["items", "0", "evaluation", "ageAtMeasurement"], 26],
    [["items", "0", "evaluation", "criterion", "catalogVersions"], ["unknown"]],
    [
      ["items", "0", "evaluation", "criterion", "source", "url"],
      "javascript:alert(1)",
    ],
    [
      [
        "items",
        "0",
        "evaluation",
        "nextTarget",
        "adjustments",
        "0",
        "lower",
        "unit",
      ],
      "bpm",
    ],
    [
      [
        "items",
        "0",
        "evaluation",
        "nextTarget",
        "adjustments",
        "0",
        "lower",
        "difference",
      ],
      "-1",
    ],
    [
      [
        "items",
        "0",
        "evaluation",
        "thresholds",
        "0",
        "intervals",
        "0",
        "lower",
        "value",
      ],
      "NaN",
    ],
  ];
  for (const [path, value] of mutations) {
    const record = storedRecordFixture();
    let object = record as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1))
      object = object[key] as Record<string, unknown>;
    object[path.at(-1)!] = value;
    assert.throws(() => parse(record), path.join("."));
  }
  const absent = storedRecordFixture();
  absent.axes.pop();
  assert.throws(() => parse(absent));
  const duplicate = storedRecordFixture();
  duplicate.items.push(duplicate.items[0]);
  assert.throws(() => parse(duplicate));
});
test("range and alternative intervals retain inclusive/open bounds and server target differences", () => {
  const record = storedRecordFixture(),
    e = record.items[0].evaluation;
  e.criterion!.direction = "range";
  const intervals = [
    {
      lower: { value: "10.1", inclusive: false },
      upper: { value: "20", inclusive: true },
    },
    { lower: null, upper: { value: "-2", inclusive: false } },
  ];
  e.thresholds[0].intervals = intervals;
  e.nextTarget.intervals = structuredClone(intervals);
  e.nextTarget.adjustments = [
    {
      lower: {
        threshold: "10.1",
        inclusive: false,
        difference: "0",
        unit: "cm",
        change: "increase",
        requiresBeyondBoundary: true,
      },
      upper: {
        threshold: "20",
        inclusive: true,
        difference: "0",
        unit: "cm",
        change: "none",
        requiresBeyondBoundary: false,
      },
    },
    {
      lower: null,
      upper: {
        threshold: "-2",
        inclusive: false,
        difference: "12.1",
        unit: "cm",
        change: "decrease",
        requiresBeyondBoundary: true,
      },
    },
  ];
  const target = parse(record).items[0].evaluation.nextTarget;
  assert.equal(
    formatInterval(target.intervals[0], "cm"),
    "10.1 cm 초과 · 20 cm 이하",
  );
  assert.equal(formatInterval(target.intervals[1], "cm"), "-2 cm 미만");
  assert.equal(target.adjustments[0].lower?.requiresBeyondBoundary, true);
  e.thresholds[0].intervals[0].upper!.value = "9";
  assert.throws(() => parse(record));
});
test("empty polygon requires six unmeasured axes with null revisions", () => {
  const axes = storedRecordFixture().axes.map((a) => ({
    ...a,
    status: "not_measured" as const,
    grade: null,
    representativeMeasurementCode: null,
    measuredMeasurementCodes: [],
    recordRevision: null,
  }));
  assert.equal(parsePolygonAxes(axes, null).length, 6);
  axes[0].grade = 1 as never;
  assert.throws(() => parsePolygonAxes(axes, null));
});
test("editing a graded record sends only raw measurement fields", () => {
  const record = storedRecordFixture();
  const result = buildInput(
    metadataFrom(record),
    record.items.map((i) => ({
      code: i.measurementCode,
      value: i.value,
      grade: i.reportedGrade ?? "",
    })),
    storedCatalogFixture,
    "2026-09-24",
  );
  assert.deepEqual(result.errors, {});
  assert.deepEqual(Object.keys(result.input.items[0]).sort(), [
    "measurementCode",
    "reportedGrade",
    "unit",
    "value",
  ]);
  assert.equal("axes" in result.input, false);
});

test("equivalent Decimal boundary spellings are accepted without losing source precision", () => {
  const record = storedRecordFixture();
  record.items[0].evaluation.nextTarget.adjustments[0].lower!.threshold =
    "14.90";
  const parsed = parse(record).items[0].evaluation;
  assert.equal(parsed.thresholds[0].intervals[0].lower!.value, "14.9");
  assert.equal(parsed.nextTarget.adjustments[0].lower!.threshold, "14.90");
  record.items[0].evaluation.nextTarget.adjustments[0].lower!.threshold =
    "14.8";
  assert.throws(() => parse(record));
});
