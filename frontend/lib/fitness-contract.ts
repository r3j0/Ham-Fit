/** Stored item evaluation and polygon contract from backend PR #6.
 * This boundary validates provenance and structure; the server owns grading.
 */
import { compareDecimal } from "./measurement-form.ts";
import {
  fitnessFactors,
  safeSourceUrl,
  type FitnessAxis,
  type FitnessFactor,
  type GradeResult,
  type TestGrade,
} from "./fitness-evaluation.ts";
import type { Catalog, Measurement } from "./types.ts";

export type Boundary = { value: string; inclusive: boolean };
export type CriterionInterval = {
  lower: Boundary | null;
  upper: Boundary | null;
};
export type GradeThreshold = {
  grade: TestGrade;
  intervals: CriterionInterval[];
};
export interface Criterion {
  id: string;
  internalVersion: string;
  officialVersion: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  rounding: "none";
  measurementCode: string;
  protocol: string;
  unit: string;
  direction: "higher" | "lower" | "range";
  minAge: number;
  maxAge: number;
  sex: "male" | "female";
  entryMethods: string[];
  catalogVersions: string[];
  source: {
    url: string;
    supportingUrls: string[];
    protocolUrl: string;
    documentTitle: string;
    checkedOn: string;
    revision: string | null;
  };
}
export interface BoundaryAdjustment {
  threshold: string;
  inclusive: boolean;
  difference: string;
  unit: string;
  change: "increase" | "decrease" | "none";
  requiresBeyondBoundary: boolean;
}
export interface NextTarget {
  status: "available" | "highest_grade" | "unavailable";
  grade: TestGrade | null;
  intervals: CriterionInterval[];
  adjustments: {
    lower: BoundaryAdjustment | null;
    upper: BoundaryAdjustment | null;
  }[];
  reasonCode: string | null;
}
export interface GripConversion {
  formulaVersion: "nfa100-relative-grip-v1";
  measurementCode: "relative_grip_strength";
  value: string;
  unit: "%";
  inputs: { measurementCode: string; value: string; unit: "kg" }[];
  sourceUrl: string;
}
export interface StepConversion {
  formulaVersion: "nfa100-adult-step-vo2max-v1";
  measurementCode: "step_test_vo2max";
  value: string;
  unit: "ml/kg/min";
  inputs: { measurementCode: string; value: string; unit: string }[];
  ageAtMeasurement: number;
  sexAtMeasurement: "male" | "female";
  assessmentKind: "reference";
  protocol: "nfa100-self-step-30cm-96bpm-180s-rest60s-pulse10s-v1";
  sourceUrl: string;
  protocolUrl: string;
}
export type MeasurementConversion = GripConversion | StepConversion;
export interface StoredItemEvaluation {
  conversion?: MeasurementConversion;
  measurementId: string;
  measurementCode: string;
  grade: TestGrade | null;
  status:
    | "graded"
    | "below_standard"
    | "insufficient_information"
    | "criteria_unavailable"
    | "not_evaluated";
  reasonCode: string;
  message: string;
  ageAtMeasurement: number | null;
  ageBand: { minAge: number; maxAge: number } | null;
  sex: "male" | "female" | null;
  criterion: Criterion | null;
  thresholds: GradeThreshold[];
  nextTarget: NextTarget;
  evaluatedAt: string | null;
  recordRevision: number;
}
export interface PolygonAxis {
  axis: FitnessFactor;
  label: string;
  grade: TestGrade | null;
  status: "graded" | "below_standard" | "unevaluable" | "not_measured";
  representativeMeasurementCode: string | null;
  measuredMeasurementCodes: string[];
  reasonCode: string;
  recordRevision: number | null;
}
export interface ReportItem {
  measurementCode: string;
  value: string;
  unit: string;
  factor: FitnessFactor | null;
  evaluation: StoredItemEvaluation;
}
export interface MeasurementEvaluation {
  axes: FitnessAxis[];
  items: ReportItem[];
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 5000;
const nullableText = (v: unknown) => v === null || text(v);
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) > 0;
const grade = (v: unknown): v is TestGrade => v === 1 || v === 2 || v === 3;
const decimal = (v: unknown, maxLength = 128): v is string =>
  typeof v === "string" &&
  v.length <= maxLength &&
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v);
export const fitnessRecordId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function fitnessDate(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !v.startsWith("0000") &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
export function invalidFitness(): never {
  throw new Error(
    "평가 응답을 확인하지 못했어요. 저장한 측정값은 기록에서 확인할 수 있어요.",
  );
}
function unique<T>(values: T[], key: (v: T) => unknown) {
  return new Set(values.map(key)).size === values.length;
}
function strings(v: unknown): v is string[] {
  return (
    Array.isArray(v) && v.length <= 100 && v.every(text) && unique(v, (x) => x)
  );
}
function boundary(v: unknown): v is Boundary {
  return object(v) && decimal(v.value) && typeof v.inclusive === "boolean";
}
function interval(v: unknown): v is CriterionInterval {
  if (
    !object(v) ||
    !(v.lower === null || boundary(v.lower)) ||
    !(v.upper === null || boundary(v.upper)) ||
    (!v.lower && !v.upper)
  )
    return false;
  if (!v.lower || !v.upper) return true;
  const order = compareDecimal(v.lower.value, v.upper.value);
  return order < 0 || (order === 0 && v.lower.inclusive && v.upper.inclusive);
}
function intervals(v: unknown): v is CriterionInterval[] {
  return Array.isArray(v) && v.length <= 100 && v.every(interval);
}
function sameIntervals(left: CriterionInterval[], right: CriterionInterval[]) {
  return (
    left.length === right.length &&
    left.every((item, index) =>
      (["lower", "upper"] as const).every((side) => {
        const a = item[side],
          b = right[index][side];
        return a === null
          ? b === null
          : b !== null &&
              compareDecimal(a.value, b.value) === 0 &&
              a.inclusive === b.inclusive;
      }),
    )
  );
}
function adjustment(
  v: unknown,
  bound: Boundary | null,
  unit: string,
  derived: boolean,
): boolean {
  if (bound === null) return v === null;
  return (
    object(v) &&
    decimal(v.threshold) &&
    compareDecimal(v.threshold, bound.value) === 0 &&
    v.inclusive === bound.inclusive &&
    v.unit === unit &&
    decimal(v.difference, derived ? 512 : 128) &&
    compareDecimal(v.difference, "0") >= 0 &&
    ["increase", "decrease", "none"].includes(v.change as string) &&
    typeof v.requiresBeyondBoundary === "boolean" &&
    !(v.requiresBeyondBoundary && bound.inclusive) &&
    (v.change !== "none" ||
      (compareDecimal(v.difference, "0") === 0 && !v.requiresBeyondBoundary))
  );
}
function target(v: unknown, unit: string, derived: boolean): v is NextTarget {
  if (
    !object(v) ||
    !intervals(v.intervals) ||
    !Array.isArray(v.adjustments) ||
    v.adjustments.length !== v.intervals.length
  )
    return false;
  if (v.status !== "available")
    return (
      ["highest_grade", "unavailable"].includes(v.status as string) &&
      v.grade === null &&
      v.intervals.length === 0 &&
      text(v.reasonCode)
    );
  return (
    grade(v.grade) &&
    v.reasonCode === null &&
    v.intervals.length > 0 &&
    v.adjustments.every(
      (a, i) =>
        object(a) &&
        adjustment(
          a.lower,
          (v.intervals as CriterionInterval[])[i].lower,
          unit,
          derived,
        ) &&
        adjustment(
          a.upper,
          (v.intervals as CriterionInterval[])[i].upper,
          unit,
          derived,
        ),
    )
  );
}
function criterion(v: unknown): v is Criterion {
  if (
    !object(v) ||
    !text(v.id) ||
    !text(v.internalVersion) ||
    !nullableText(v.officialVersion) ||
    !(v.effectiveFrom === null || fitnessDate(v.effectiveFrom)) ||
    !(v.effectiveUntil === null || fitnessDate(v.effectiveUntil)) ||
    v.rounding !== "none" ||
    !text(v.measurementCode) ||
    !text(v.protocol) ||
    !text(v.unit) ||
    !["higher", "lower", "range"].includes(v.direction as string) ||
    !integer(v.minAge) ||
    !integer(v.maxAge) ||
    v.minAge > v.maxAge ||
    !["male", "female"].includes(v.sex as string) ||
    !strings(v.entryMethods) ||
    !v.entryMethods.length ||
    !strings(v.catalogVersions) ||
    !v.catalogVersions.length ||
    !object(v.source)
  )
    return false;
  const s = v.source;
  return (
    !(
      v.effectiveFrom &&
      v.effectiveUntil &&
      v.effectiveFrom > v.effectiveUntil
    ) &&
    safeSourceUrl(s.url) &&
    safeSourceUrl(s.protocolUrl) &&
    strings(s.supportingUrls) &&
    s.supportingUrls.every(safeSourceUrl) &&
    text(s.documentTitle) &&
    fitnessDate(s.checkedOn) &&
    nullableText(s.revision)
  );
}
/** Six explicit axes from one revision; no filling from another record. */
export function parsePolygonAxes(
  value: unknown,
  revision: number | null,
): PolygonAxis[] {
  if (
    !(revision === null || integer(revision)) ||
    !Array.isArray(value) ||
    value.length !== 6
  )
    return invalidFitness();
  const axes: PolygonAxis[] = [];
  for (const v of value) {
    if (
      !object(v) ||
      !fitnessFactors.some((f) => f.code === v.axis) ||
      !text(v.label) ||
      !text(v.reasonCode) ||
      v.recordRevision !== revision ||
      !strings(v.measuredMeasurementCodes) ||
      !["graded", "below_standard", "unevaluable", "not_measured"].includes(
        v.status as string,
      ) ||
      (v.status === "graded" ? !grade(v.grade) : v.grade !== null)
    )
      return invalidFitness();
    if (v.status === "not_measured") {
      if (
        v.measuredMeasurementCodes.length ||
        v.representativeMeasurementCode !== null
      )
        return invalidFitness();
    } else if (
      revision === null ||
      !text(v.representativeMeasurementCode) ||
      !v.measuredMeasurementCodes.includes(v.representativeMeasurementCode)
    )
      return invalidFitness();
    axes.push(v as unknown as PolygonAxis);
  }
  if (
    !unique(axes, (a) => a.axis) ||
    !unique(
      axes.flatMap((a) => a.measuredMeasurementCodes),
      (x) => x,
    )
  )
    return invalidFitness();
  return fitnessFactors.map((f) => axes.find((a) => a.axis === f.code)!);
}
export function polygonForDisplay(axes: PolygonAxis[]): FitnessAxis[] {
  return axes.map((a) => ({
    factor: a.axis,
    ...(a.status === "graded"
      ? { status: "evaluated" as const, grade: a.grade as TestGrade }
      : { status: a.status, grade: null }),
    reason:
      a.status === "not_measured" ? "이 기록에서 측정하지 않았어요." : null,
    sourceMeasurementCodes:
      ["graded", "below_standard"].includes(a.status) &&
      a.representativeMeasurementCode
        ? [a.representativeMeasurementCode]
        : [],
  }));
}
export function itemGradeResult(item: StoredItemEvaluation): GradeResult {
  if (item.status === "graded")
    return {
      status: "evaluated",
      grade: item.grade as TestGrade,
      reason: item.message,
    };
  const states = {
    below_standard: "below_standard",
    insufficient_information: "missing_input",
    criteria_unavailable: "unsupported_rule",
    not_evaluated: "not_evaluated",
  } as const;
  return { status: states[item.status], grade: null, reason: item.message };
}
function parseConversion(
  value: unknown,
  record: Measurement,
  raw: Measurement["items"][number],
): MeasurementConversion | undefined {
  if (value === undefined) return undefined;
  if (
    !object(value) ||
    !decimal(value.value, 512) ||
    compareDecimal(value.value, "0") < 0 ||
    !safeSourceUrl(value.sourceUrl) ||
    !Array.isArray(value.inputs) ||
    !unique(value.inputs, (input) =>
      object(input) ? input.measurementCode : null,
    )
  )
    return invalidFitness();
  let expected: Record<string, string>;
  if (value.formulaVersion === "nfa100-relative-grip-v1") {
    if (
      raw.measurementCode !== "absolute_grip_strength" ||
      raw.unit !== "kg" ||
      value.measurementCode !== "relative_grip_strength" ||
      value.unit !== "%"
    )
      return invalidFitness();
    expected = { absolute_grip_strength: "kg", weight: "kg" };
  } else if (value.formulaVersion === "nfa100-adult-step-vo2max-v1") {
    if (
      raw.measurementCode !== "ymca_recovery_heart_rate" ||
      raw.unit !== "bpm" ||
      value.measurementCode !== "step_test_vo2max" ||
      value.unit !== "ml/kg/min" ||
      compareDecimal(value.value, "0") <= 0 ||
      value.ageAtMeasurement !== record.ageAtMeasurement ||
      record.ageAtMeasurement < 19 ||
      record.ageAtMeasurement > 64 ||
      !["male", "female"].includes(value.sexAtMeasurement as string) ||
      value.sexAtMeasurement !== record.sexAtMeasurement ||
      value.assessmentKind !== "reference" ||
      value.protocol !==
        "nfa100-self-step-30cm-96bpm-180s-rest60s-pulse10s-v1" ||
      !safeSourceUrl(value.protocolUrl)
    )
      return invalidFitness();
    expected = { ymca_recovery_heart_rate: "bpm", height: "cm", weight: "kg" };
  } else return invalidFitness();
  if (value.inputs.length !== Object.keys(expected).length)
    return invalidFitness();
  for (const [code, unit] of Object.entries(expected)) {
    const input = value.inputs.find(
      (i: unknown) => object(i) && i.measurementCode === code,
    );
    const saved = record.items.find((i) => i.measurementCode === code);
    if (
      !object(input) ||
      !decimal(input.value) ||
      input.unit !== unit ||
      !saved ||
      saved.unit !== unit ||
      !decimal(saved.value) ||
      compareDecimal(input.value, saved.value) !== 0 ||
      (code === "absolute_grip_strength"
        ? compareDecimal(input.value, "0") < 0
        : compareDecimal(input.value, "0") <= 0)
    )
      return invalidFitness();
  }
  return value as unknown as MeasurementConversion;
}
function parseItem(
  value: unknown,
  record: Measurement,
  raw: Measurement["items"][number],
): StoredItemEvaluation {
  if (!object(value)) return invalidFitness();
  const conversion = parseConversion(value.conversion, record, raw);
  const evaluatedUnit = conversion?.unit ?? raw.unit;
  const evaluatedCode = conversion?.measurementCode ?? raw.measurementCode;
  if (
    !object(value) ||
    value.measurementId !== record.id ||
    value.measurementCode !== raw.measurementCode ||
    value.recordRevision !== record.revision ||
    value.ageAtMeasurement !== record.ageAtMeasurement ||
    value.sex !== record.sexAtMeasurement ||
    !text(value.reasonCode) ||
    !text(value.message) ||
    ![
      "graded",
      "below_standard",
      "insufficient_information",
      "criteria_unavailable",
      "not_evaluated",
    ].includes(value.status as string) ||
    (value.status === "graded" ? !grade(value.grade) : value.grade !== null) ||
    !(
      value.ageBand === null ||
      (object(value.ageBand) &&
        integer(value.ageBand.minAge) &&
        integer(value.ageBand.maxAge) &&
        value.ageBand.minAge <= value.ageBand.maxAge)
    ) ||
    !Array.isArray(value.thresholds) ||
    value.thresholds.length > 3 ||
    !value.thresholds.every(
      (t) =>
        object(t) &&
        grade(t.grade) &&
        intervals(t.intervals) &&
        t.intervals.length > 0,
    ) ||
    !unique(value.thresholds, (t) => t.grade) ||
    !target(value.nextTarget, evaluatedUnit, !!conversion)
  )
    return invalidFitness();
  if (
    value.status === "not_evaluated"
      ? value.evaluatedAt !== null
      : !text(value.evaluatedAt) ||
        !Number.isFinite(Date.parse(value.evaluatedAt))
  )
    return invalidFitness();
  const evaluated =
    value.status === "graded" || value.status === "below_standard";
  if (!evaluated) {
    if (
      value.criterion !== null ||
      value.ageBand !== null ||
      value.thresholds.length ||
      value.nextTarget.status !== "unavailable"
    )
      return invalidFitness();
  } else {
    const c = value.criterion;
    if (
      !criterion(c) ||
      c.measurementCode !== evaluatedCode ||
      c.unit !== evaluatedUnit ||
      (["absolute_grip_strength", "ymca_recovery_heart_rate"].includes(
        raw.measurementCode,
      ) &&
        !conversion) ||
      c.sex !== record.sexAtMeasurement ||
      record.ageAtMeasurement < c.minAge ||
      record.ageAtMeasurement > c.maxAge ||
      !object(value.ageBand) ||
      value.ageBand.minAge !== c.minAge ||
      value.ageBand.maxAge !== c.maxAge ||
      !c.entryMethods.includes(record.entryMethod) ||
      !c.catalogVersions.includes(record.catalogVersion) ||
      (c.effectiveFrom && record.measuredOn < c.effectiveFrom) ||
      (c.effectiveUntil && record.measuredOn > c.effectiveUntil) ||
      !value.thresholds.length ||
      (value.status === "graded" &&
        !value.thresholds.some((t) => t.grade === value.grade))
    )
      return invalidFitness();
    const next = value.nextTarget;
    if (next.status === "available") {
      const threshold = value.thresholds.find((t) => t.grade === next.grade);
      if (!threshold || !sameIntervals(threshold.intervals, next.intervals))
        return invalidFitness();
    }
  }
  return value as unknown as StoredItemEvaluation;
}
export function parseMeasurementEvaluation(
  record: Measurement,
  catalog: Catalog,
): MeasurementEvaluation | null {
  // Old servers without stored evaluations remain readable. Partial/malformed
  // new responses must never be silently treated as a successful empty result.
  if (
    record.axes === undefined &&
    record.items.every((i) => i.evaluation === undefined)
  )
    return null;
  if (
    !fitnessRecordId(record.id) ||
    !integer(record.revision) ||
    !fitnessDate(record.measuredOn) ||
    !integer(record.ageAtMeasurement) ||
    ![null, "male", "female"].includes(record.sexAtMeasurement) ||
    !record.items.length ||
    record.items.length > 100 ||
    !unique(record.items, (i) => i.measurementCode) ||
    record.catalogVersion !== catalog.version
  )
    return invalidFitness();
  const axes = parsePolygonAxes(record.axes, record.revision);
  const byCode = new Map(
    axes.flatMap((a) =>
      a.measuredMeasurementCodes.map((code) => [code, a.axis] as const),
    ),
  );
  const items = record.items.map((raw) => {
    const definition = catalog.definitions.find(
      (d) => d.code === raw.measurementCode,
    );
    const factor = byCode.get(raw.measurementCode) ?? null;
    const expected =
      fitnessFactors.find((f) => f.code === definition?.factor)?.code ?? null;
    if (
      !definition ||
      definition.unit !== raw.unit ||
      !decimal(raw.value) ||
      factor !== expected
    )
      return invalidFitness();
    return {
      measurementCode: raw.measurementCode,
      value: raw.value,
      unit: raw.unit,
      factor,
      evaluation: parseItem(raw.evaluation, record, raw),
    };
  });
  for (const axis of axes) {
    if (
      axis.measuredMeasurementCodes.some(
        (code) => !items.some((i) => i.measurementCode === code),
      )
    )
      return invalidFitness();
    const representative = items.find(
      (i) => i.measurementCode === axis.representativeMeasurementCode,
    );
    if (
      ["graded", "below_standard"].includes(axis.status) &&
      (!representative ||
        representative.evaluation.status !== axis.status ||
        representative.evaluation.grade !== axis.grade)
    )
      return invalidFitness();
    if (
      axis.status === "unevaluable" &&
      items.some(
        (i) =>
          i.factor === axis.axis &&
          ["graded", "below_standard"].includes(i.evaluation.status),
      )
    )
      return invalidFitness();
  }
  const display = polygonForDisplay(axes).map((axis) => {
    if (axis.status !== "unevaluable") return axis;
    const measured = items.filter((i) => i.factor === axis.factor);
    // Enrich only the explanation when every stored item has the same cause.
    if (
      measured.length &&
      measured.every(
        (i) => i.evaluation.status === measured[0].evaluation.status,
      )
    ) {
      return { ...axis, ...itemGradeResult(measured[0].evaluation) };
    }
    return axis;
  });
  return { axes: display, items };
}
export function formatInterval(
  interval: CriterionInterval,
  unit: string,
): string {
  const values = [];
  if (interval.lower)
    values.push(
      `${interval.lower.value} ${unit} ${interval.lower.inclusive ? "이상" : "초과"}`,
    );
  if (interval.upper)
    values.push(
      `${interval.upper.value} ${unit} ${interval.upper.inclusive ? "이하" : "미만"}`,
    );
  return values.join(" · ");
}
