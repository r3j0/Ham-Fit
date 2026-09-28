import {
  storedRecordFixture,
  unscoredRecordFixture,
  storedCatalogFixture,
} from "./measurement-evaluation.ts";
import type { Catalog } from "../../lib/types.ts";

/** Contract fixture only; production grading always comes from the API. */
export function gripRecordFixture() {
  const record = storedRecordFixture();
  record.catalogVersion = "nfa100-2026-09-24-grip-v1";
  const item = record.items[0],
    e = item.evaluation;
  item.measurementCode = e.measurementCode = "absolute_grip_strength";
  item.value = "30";
  item.unit = "kg";
  e.conversion = {
    formulaVersion: "nfa100-relative-grip-v1",
    measurementCode: "relative_grip_strength",
    value: "60",
    unit: "%",
    inputs: [
      { measurementCode: "absolute_grip_strength", value: "30", unit: "kg" },
      { measurementCode: "weight", value: "50", unit: "kg" },
    ],
    sourceUrl: "https://nfa.kspo.or.kr/community/faq/selectFaqList.kspo",
  };
  Object.assign(e.criterion!, {
    measurementCode: "relative_grip_strength",
    protocol: "nfa100_relative_grip_strength",
    unit: "%",
    catalogVersions: [record.catalogVersion],
  });
  e.thresholds = ["62.4", "57", "51.6"].map((value, i) => ({
    grade: (i + 1) as 1 | 2 | 3,
    intervals: [{ lower: { value, inclusive: true }, upper: null }],
  }));
  e.nextTarget.intervals = structuredClone(e.thresholds[0].intervals);
  Object.assign(e.nextTarget.adjustments[0].lower!, {
    threshold: "62.4",
    difference: "2.4",
    unit: "%",
  });
  const weight = unscoredRecordFixture().items[0];
  weight.measurementCode = weight.evaluation.measurementCode = "weight";
  weight.value = "50";
  weight.unit = "kg";
  record.items.push(weight);
  const original = record.axes[3];
  Object.assign(record.axes[1], {
    ...original,
    axis: "strength",
    label: "근력",
    representativeMeasurementCode: "absolute_grip_strength",
    measuredMeasurementCodes: ["absolute_grip_strength"],
  });
  Object.assign(original, {
    status: "not_measured",
    grade: null,
    representativeMeasurementCode: null,
    measuredMeasurementCodes: [],
    reasonCode: "no_measurements",
  });
  return record;
}
export const gripCatalogFixture: Catalog = {
  ...storedCatalogFixture,
  version: "nfa100-2026-09-24-grip-v1",
  definitions: [
    {
      ...storedCatalogFixture.definitions[0],
      code: "absolute_grip_strength",
      label: "절대악력",
      factor: "strength",
      unit: "kg",
      minValue: "0",
    },
    {
      ...storedCatalogFixture.definitions[0],
      code: "weight",
      label: "체중",
      category: "physique",
      factor: "body_composition",
      unit: "kg",
      minValue: "0",
      minInclusive: false,
    },
  ],
};
