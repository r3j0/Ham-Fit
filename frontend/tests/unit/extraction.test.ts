import test from "node:test";
import assert from "node:assert/strict";
import {
  extractionSeed,
  parseExtraction,
  canReviewExtraction,
} from "../../lib/extraction.ts";
const draft = {
  catalogVersion: "v1",
  status: "partial",
  metadata: {
    measuredOn: null,
    ageAtMeasurement: 25,
    sexAtMeasurement: null,
    centerName: null,
    reportedOverallGrade: null,
  },
  items: [
    {
      measurementCode: "sit_and_reach",
      value: "-3.12345678901234567890",
      unit: "cm",
      reportedGrade: null,
      evidence: {
        label: "유연성",
        value: "-3.12345678901234567890",
        unit: "cm",
      },
    },
  ],
  reviewItems: [
    {
      measurementCode: null,
      value: "32",
      unit: "kg",
      reportedGrade: null,
      evidence: { label: "악력", value: "32", unit: "kg" },
      reasons: ["UNKNOWN_TEST"],
    },
  ],
  issues: [],
  notDetectedMeasurementCodes: [],
};
test("OCR seeds only reviewed candidates, retains exact decimals and missing metadata", () => {
  const seed = extractionSeed(parseExtraction(draft));
  assert.equal(seed.items[0].value, draft.items[0].value);
  assert.equal(seed.meta.measuredOn, "");
  assert.equal(seed.meta.sex, "");
  assert.equal(seed.items.length, 1);
  assert.match(seed.extractionNotes[0], /악력: 32 kg/);
  assert.equal(seed.meta.kind, "unknown");
});
test("mixed or unsupported documents cannot seed a measurement", () => {
  for (const status of [
    "not_target",
    "unreadable",
    "multiple_people",
    "mixed_sessions",
    "unsupported_age",
  ]) {
    const result = parseExtraction({ ...draft, status });
    assert.equal(canReviewExtraction(result), false);
    assert.throws(() => extractionSeed(result));
  }
});
test("unknown statuses, numeric measurement values and duplicate codes fail closed", () => {
  assert.throws(() => parseExtraction({ ...draft, status: "success" }));
  assert.throws(() =>
    parseExtraction({ ...draft, items: [{ ...draft.items[0], value: 3 }] }),
  );
  assert.throws(() =>
    parseExtraction({ ...draft, items: [draft.items[0], draft.items[0]] }),
  );
});
