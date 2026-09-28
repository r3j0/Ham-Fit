import {
  storedRecordFixture,
  unscoredRecordFixture,
  storedCatalogFixture,
} from "./measurement-evaluation.ts";
import type { Catalog } from "../../lib/types.ts";
/** API contract fixtures only; these values never grade production data. */
export function stepRecordFixture() {
  const record = storedRecordFixture();
  record.catalogVersion = "nfa100-2026-09-24-grip-v1";
  record.entryMethod = "self_assessment";
  const item = record.items[0],
    e = item.evaluation;
  item.measurementCode = e.measurementCode = "ymca_recovery_heart_rate";
  item.value = "140";
  item.unit = "bpm";
  e.reasonCode = "step_reference_grade_applied";
  e.message =
    "자가측정으로 추정한 최대산소섭취량은 심폐지구력 참고 2등급에 해당합니다. 공식 인증이 아닙니다.";
  e.conversion = {
    formulaVersion: "nfa100-adult-step-vo2max-v1",
    measurementCode: "step_test_vo2max",
    value: "42.527",
    unit: "ml/kg/min",
    ageAtMeasurement: 25,
    sexAtMeasurement: "male",
    assessmentKind: "reference",
    protocol: "nfa100-self-step-30cm-96bpm-180s-rest60s-pulse10s-v1",
    sourceUrl:
      "https://nfa.kspo.or.kr/community/faq/selectFaqView.kspo?contSn=36786",
    protocolUrl:
      "https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo",
    inputs: [
      { measurementCode: item.measurementCode, value: "140", unit: "bpm" },
      { measurementCode: "height", value: "170", unit: "cm" },
      { measurementCode: "weight", value: "65", unit: "kg" },
    ],
  };
  Object.assign(e.criterion!, {
    measurementCode: "step_test_vo2max",
    unit: "ml/kg/min",
    protocol: "nfa100_step_test_vo2max",
    internalVersion: "nfa100-adult-2025-0027-v1-step-reference-v1",
    catalogVersions: [record.catalogVersion],
  });
  e.thresholds = ["44.8", "42.2", "39.6"].map((value, i) => ({
    grade: (i + 1) as 1 | 2 | 3,
    intervals: [{ lower: { value, inclusive: true }, upper: null }],
  }));
  e.nextTarget.intervals = structuredClone(e.thresholds[0].intervals);
  Object.assign(e.nextTarget.adjustments[0].lower!, {
    threshold: "44.8",
    difference: "2.273",
    unit: "ml/kg/min",
  });
  for (const [measurementCode, value, unit] of [
    ["height", "170", "cm"],
    ["weight", "65", "kg"],
  ]) {
    const body = unscoredRecordFixture().items[0];
    body.measurementCode = body.evaluation.measurementCode = measurementCode;
    body.value = value;
    body.unit = unit;
    record.items.push(body);
  }
  const original = record.axes[3];
  Object.assign(record.axes[0], {
    ...original,
    axis: "cardiorespiratory_endurance",
    label: "심폐지구력",
    representativeMeasurementCode: item.measurementCode,
    measuredMeasurementCodes: [item.measurementCode],
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
export const stepCatalogFixture: Catalog = {
  ...storedCatalogFixture,
  version: "nfa100-2026-09-24-grip-v1",
  definitions: [
    ["ymca_recovery_heart_rate", "YMCA 회복 심박수", "bpm"],
    ["height", "신장", "cm"],
    ["weight", "체중", "kg"],
  ].map(([code, label, unit]) => ({
    ...storedCatalogFixture.definitions[0],
    code,
    label,
    unit,
    factor:
      code === "ymca_recovery_heart_rate"
        ? "cardiorespiratory_endurance"
        : "body_composition",
    category:
      code === "ymca_recovery_heart_rate" ? "health_fitness" : "physique",
    minValue: "0",
    minInclusive: false,
  })),
};
