import test from "node:test";
import assert from "node:assert/strict";
import {
  gripRecordFixture,
  gripCatalogFixture,
} from "../fixtures/grip-evaluation.ts";
import { parseMeasurementEvaluation } from "../../lib/fitness-contract.ts";
import { displayConvertedValue } from "../../lib/conversion-display.ts";
import { buildInput, metadataFrom } from "../../lib/measurement-form.ts";

test("absolute grip keeps kg while its criterion and next target use server-converted percent", () => {
  const record = gripRecordFixture();
  const result = parseMeasurementEvaluation(record, gripCatalogFixture)!;
  assert.equal(result.items[0].value, "30");
  assert.equal(result.items[0].unit, "kg");
  assert.equal(result.items[0].evaluation.conversion?.value, "60");
  assert.equal(result.items[0].evaluation.criterion?.unit, "%");
  assert.equal(result.axes[1].grade, 2);
  const payload = buildInput(
    metadataFrom(record),
    record.items.map((i) => ({
      code: i.measurementCode,
      value: i.value,
      grade: "",
    })),
    gripCatalogFixture,
    "2026-09-24",
  );
  assert.deepEqual(payload.errors, {});
  assert.deepEqual(
    payload.input.items.map((i) => [i.measurementCode, i.value, i.unit]),
    [
      ["absolute_grip_strength", "30", "kg"],
      ["weight", "50", "kg"],
    ],
  );
});

test("conversion metadata is bound to the same record inputs and cannot bypass criterion provenance checks", () => {
  const mutations = [
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items[1].value = "60";
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items.pop();
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      delete r.items[0].evaluation.conversion;
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items[0].evaluation.conversion!.inputs[1].unit = "%" as "kg";
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items[0].evaluation.conversion!.inputs[1] =
        r.items[0].evaluation.conversion!.inputs[0];
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items[0].evaluation.conversion!.value = "NaN";
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items[0].evaluation.conversion!.value = "-1";
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items[0].evaluation.conversion!.sourceUrl = "javascript:alert(1)";
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items[0].evaluation.criterion!.measurementCode = "cross_sit_up";
    },
    (r: ReturnType<typeof gripRecordFixture>) => {
      r.items[0].evaluation.nextTarget.adjustments[0].lower!.unit = "kg";
    },
  ];
  for (const mutate of mutations) {
    const record = gripRecordFixture();
    mutate(record);
    assert.throws(() => parseMeasurementEvaluation(record, gripCatalogFixture));
  }
});

test("long derived decimals remain readable without shortening the server's stored evaluation", () => {
  const record = gripRecordFixture(),
    evaluation = record.items[0].evaluation;
  const value = `60.${"3".repeat(298)}`;
  evaluation.conversion!.value = value;
  evaluation.nextTarget.adjustments[0].lower!.difference = `2.${"6".repeat(298)}`;
  const result = parseMeasurementEvaluation(record, gripCatalogFixture)!;
  assert.equal(result.items[0].evaluation.conversion?.value, value);
  assert.equal(displayConvertedValue(value), "약 60.333333");
  assert.equal(displayConvertedValue("0.00000000001"), "0.000001 미만");
  assert.equal(displayConvertedValue("60"), "60");
});
