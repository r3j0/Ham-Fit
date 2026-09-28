import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInput,
  compareDecimal,
  emptyMetadata,
  validateMetadata,
} from "../../lib/measurement-form.ts";
import type { Catalog, Definition } from "../../lib/types.ts";
const def = (code: string, extra: Partial<Definition> = {}): Definition => ({
  code,
  label: code,
  category: "physique",
  factor: "body_composition",
  unit: "cm",
  valueType: "decimal",
  minAge: 13,
  maxAge: 64,
  minValue: "0",
  minInclusive: false,
  maxValue: null,
  sourceUrls: [],
  ...extra,
});
const catalog: Catalog = {
  version: "test-only",
  checkedOn: "2026-09-19",
  age: null,
  definitions: [
    def("height"),
    def("flex", { minValue: null }),
    def("count", { valueType: "integer", unit: "회", minInclusive: true }),
    def("fat", { unit: "%", minInclusive: true, maxValue: "100" }),
    def("adult", { minAge: 19 }),
    def("teen", { maxAge: 18 }),
  ],
};
const meta = { ...emptyMetadata, measuredOn: "2026-09-17", age: "25" };
const build = (items: { code: string; value: string; grade: string }[]) =>
  buildInput(meta, items, catalog, "2026-09-19");
test("partial input preserves long decimal exactly and omits missing values", () => {
  const value = "170.123456789012345678901234567890123456789";
  const result = build([
    { code: "height", value, grade: "" },
    { code: "flex", value: "", grade: "" },
  ]);
  assert.deepEqual(result.errors, {});
  assert.equal(result.input.items.length, 1);
  assert.equal(result.input.items[0].value, value);
  assert.equal(result.input.sexAtMeasurement, null);
  assert.equal(result.input.reportedOverallGrade, null);
});
test("actual zero and negative flexibility remain actual values", () => {
  const result = build([
    { code: "count", value: "0", grade: "참가" },
    { code: "flex", value: "-3.25", grade: "" },
  ]);
  assert.deepEqual(result.errors, {});
  assert.equal(result.input.items[0].value, "0");
  assert.equal(result.input.items[1].value, "-3.25");
});
test("all empty input cannot save", () =>
  assert.ok(build([{ code: "height", value: "", grade: "" }]).errors.items));
test("grade alone is not saved as a measurement", () =>
  assert.ok(
    build([{ code: "height", value: "", grade: "2등급" }]).errors[
      "item.height"
    ],
  ));
for (const value of [
  "1e3",
  " 1",
  "1 ",
  "NaN",
  "Infinity",
  "+1",
  "01",
  ".2",
  "1.",
])
  test(`invalid decimal ${JSON.stringify(value)} is rejected`, () =>
    assert.ok(
      build([{ code: "height", value, grade: "" }]).errors["item.height"],
    ));
test("decimal limit uses all digits, not rounded floats", () => {
  assert.equal(compareDecimal("100.00000000000000000000000000001", "100"), 1);
  assert.ok(
    build([
      { code: "fat", value: "100.00000000000000000000000000001", grade: "" },
    ]).errors["item.fat"],
  );
  assert.equal(compareDecimal("-0.000", "0"), 0);
  assert.equal(compareDecimal("-0.00000000000000000000000000001", "0"), -1);
  assert.equal(
    compareDecimal("999999999999999999999", "1000000000000000000000"),
    -1,
  );
});
test("fractional count rejected but mathematically integer decimal accepted", () => {
  assert.ok(
    build([{ code: "count", value: "1.1", grade: "" }]).errors["item.count"],
  );
  assert.deepEqual(
    build([{ code: "count", value: "1.0", grade: "" }]).errors,
    {},
  );
});
test("18/19 boundary is enforced while retaining the invalid item for correction", () => {
  const items = [{ code: "teen", value: "1", grade: "" }];
  assert.deepEqual(
    buildInput({ ...meta, age: "18" }, items, catalog, "2026-09-19").errors,
    {},
  );
  const result = buildInput(
    { ...meta, age: "19" },
    items,
    catalog,
    "2026-09-19",
  );
  assert.ok(result.errors["item.teen"]);
  assert.equal(result.input.items[0].value, "1");
});
test("duplicate item codes rejected", () =>
  assert.ok(
    build([
      { code: "height", value: "1", grade: "" },
      { code: "height", value: "2", grade: "" },
    ]).errors["item.height"],
  ));
test("metadata validation rejects impossible/future dates and unsupported ages", () => {
  for (const measuredOn of ["2026-02-30", "0000-01-01", "2026-09-20"])
    assert.ok(
      validateMetadata({ ...meta, measuredOn }, "2026-09-19").measuredOn,
    );
  for (const age of ["12", "65", "13.5", "-1"])
    assert.ok(
      validateMetadata({ ...meta, age }, "2026-09-19").ageAtMeasurement,
    );
});
test("optional original strings trimmed, blank fields become null", () => {
  const result = buildInput(
    { ...meta, center: "  서울  ", grade: "  6등급  " },
    [{ code: "height", value: "170", grade: "  참가  " }],
    catalog,
    "2026-09-19",
  );
  assert.equal(result.input.centerName, "서울");
  assert.equal(result.input.reportedOverallGrade, "6등급");
  assert.equal(result.input.items[0].reportedGrade, "참가");
});

test("manual-entry sex is required for both metadata and final payload validation", () => {
  const items = [{ code: "height", value: "170", grade: "" }];
  for (const sex of ["", "unknown"]) {
    assert.equal(
      validateMetadata({ ...meta, sex }, "2026-09-19", { requireSex: true })
        .sexAtMeasurement,
      "성별을 선택해 주세요.",
    );
    assert.equal(
      buildInput({ ...meta, sex }, items, catalog, "2026-09-19", {
        requireSex: true,
      }).errors.sexAtMeasurement,
      "성별을 선택해 주세요.",
    );
  }
  for (const sex of ["male", "female"]) {
    const result = buildInput({ ...meta, sex }, items, catalog, "2026-09-19", {
      requireSex: true,
    });
    assert.deepEqual(result.errors, {});
    assert.equal(result.input.sexAtMeasurement, sex);
  }
  assert.deepEqual(buildInput(meta, items, catalog, "2026-09-19").errors, {});
});
