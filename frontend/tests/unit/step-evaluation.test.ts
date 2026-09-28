import test from "node:test";
import assert from "node:assert/strict";
import {
  stepRecordFixture,
  stepCatalogFixture,
} from "../fixtures/step-evaluation.ts";
import {
  parseMeasurementEvaluation,
  type StepConversion,
} from "../../lib/fitness-contract.ts";
import { buildInput, metadataFrom } from "../../lib/measurement-form.ts";

test("step reference results preserve raw bpm, use VO2 criteria and retain same-record provenance", () => {
  const record = stepRecordFixture();
  const parsed = parseMeasurementEvaluation(record, stepCatalogFixture)!;
  assert.equal(parsed.axes[0].grade, 2);
  assert.equal(parsed.items[0].value, "140");
  assert.equal(parsed.items[0].evaluation.conversion?.value, "42.527");
  assert.equal(
    parsed.items[0].evaluation.nextTarget.adjustments[0].lower?.unit,
    "ml/kg/min",
  );
  const payload = buildInput(
    metadataFrom(record),
    record.items.map((i) => ({
      code: i.measurementCode,
      value: i.value,
      grade: "",
    })),
    stepCatalogFixture,
    "2026-09-24",
  );
  assert.deepEqual(payload.errors, {});
  assert.deepEqual(
    payload.input.items.map((i) => [i.measurementCode, i.value, i.unit]),
    [
      ["ymca_recovery_heart_rate", "140", "bpm"],
      ["height", "170", "cm"],
      ["weight", "65", "kg"],
    ],
  );
});

test("step conversion rejects stale metadata, wrong protocols, missing body inputs and unit mismatches", () => {
  type Record = ReturnType<typeof stepRecordFixture>;
  const conversion = (r: Record) =>
    r.items[0].evaluation.conversion as StepConversion;
  const mutations: ((r: Record) => void)[] = [
    (r) => {
      r.items[0].value = "90";
    },
    (r) => {
      r.items[1].value = "180";
    },
    (r) => {
      r.items.pop();
    },
    (r) => {
      r.ageAtMeasurement = 30;
    },
    (r) => {
      r.sexAtMeasurement = "female";
    },
    (r) => {
      conversion(r).assessmentKind = "official" as "reference";
    },
    (r) => {
      conversion(r).protocol = "unknown" as StepConversion["protocol"];
    },
    (r) => {
      conversion(r).formulaVersion =
        "unknown" as StepConversion["formulaVersion"];
    },
    (r) => {
      conversion(r).protocolUrl = "javascript:alert(1)";
    },
    (r) => {
      conversion(r).inputs[1].unit = "m";
    },
    (r) => {
      conversion(r).inputs.push(conversion(r).inputs[0]);
    },
    (r) => {
      conversion(r).value = "0";
    },
    (r) => {
      conversion(r).value = "-10";
    },
    (r) => {
      delete r.items[0].evaluation.conversion;
    },
    (r) => {
      r.items[0].evaluation.criterion!.measurementCode =
        "ymca_recovery_heart_rate";
    },
    (r) => {
      r.items[0].evaluation.nextTarget.adjustments[0].lower!.unit = "bpm";
    },
  ];
  for (const mutate of mutations) {
    const r = stepRecordFixture();
    mutate(r);
    assert.throws(() => parseMeasurementEvaluation(r, stepCatalogFixture));
  }
});

test("old unscored YMCA snapshots remain readable without fabricated conversions", () => {
  const r = stepRecordFixture();
  const e = r.items[0].evaluation;
  delete e.conversion;
  Object.assign(e, {
    grade: null,
    status: "criteria_unavailable",
    reasonCode: "ymca_bpm_criteria_unverified",
    criterion: null,
    ageBand: null,
    thresholds: [],
    nextTarget: {
      status: "unavailable",
      grade: null,
      intervals: [],
      adjustments: [],
      reasonCode: "ymca_bpm_criteria_unverified",
    },
  });
  Object.assign(r.axes[0], { grade: null, status: "unevaluable" });
  const parsed = parseMeasurementEvaluation(r, stepCatalogFixture)!;
  assert.equal(parsed.axes[0].status, "unsupported_rule");
  assert.equal(parsed.items[0].evaluation.conversion, undefined);
});
