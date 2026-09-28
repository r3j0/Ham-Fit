import { compareDecimal } from "./measurement-form.ts";
import type { GradeResult } from "./fitness-evaluation.ts";
import type {
  Boundary,
  CriterionInterval,
  StoredItemEvaluation,
} from "./fitness-contract.ts";

/** Display tokens only. Grading and next-target calculations remain on the server. */
export function gradeTone(result: Pick<GradeResult, "grade" | "status">) {
  return result.grade !== null
    ? String(result.grade)
    : result.status === "below_standard"
      ? "below"
      : "none";
}

/** Complement the union of supplied grade intervals, retaining open boundaries. */
export function belowGradeIntervals(
  intervals: readonly CriterionInterval[],
): CriterionInterval[] {
  if (!intervals.length) return [];
  const sorted = structuredClone([...intervals]).sort((a, b) => {
    if (!a.lower) return b.lower ? -1 : 0;
    if (!b.lower) return 1;
    return (
      compareDecimal(a.lower.value, b.lower.value) ||
      Number(b.lower.inclusive) - Number(a.lower.inclusive)
    );
  });
  const union: CriterionInterval[] = [];
  for (const interval of sorted) {
    const last = union.at(-1);
    const order =
      last?.upper && interval.lower
        ? compareDecimal(last.upper.value, interval.lower.value)
        : 1;
    const overlaps =
      last &&
      (!last.upper ||
        !interval.lower ||
        order > 0 ||
        (order === 0 && (last.upper.inclusive || interval.lower.inclusive)));
    if (!overlaps) union.push(interval);
    else if (
      last.upper &&
      (!interval.upper ||
        compareDecimal(interval.upper.value, last.upper.value) > 0)
    )
      last.upper = interval.upper;
    else if (
      last.upper &&
      interval.upper &&
      compareDecimal(interval.upper.value, last.upper.value) === 0
    )
      last.upper.inclusive ||= interval.upper.inclusive;
  }
  const result: CriterionInterval[] = [];
  let lower: Boundary | null = null;
  for (const interval of union) {
    if (interval.lower) {
      const upper = { ...interval.lower, inclusive: !interval.lower.inclusive };
      if (
        !lower ||
        compareDecimal(lower.value, upper.value) < 0 ||
        (compareDecimal(lower.value, upper.value) === 0 &&
          lower.inclusive &&
          upper.inclusive)
      )
        result.push({ lower, upper });
    }
    if (!interval.upper) return result;
    lower = { ...interval.upper, inclusive: !interval.upper.inclusive };
  }
  result.push({ lower, upper: null });
  return result;
}

export type GradeStep = {
  label: string;
  title: string;
  intervals: CriterionInterval[];
  current?: boolean;
  highest?: boolean;
};
export function reportGradeSteps(
  evaluation: StoredItemEvaluation,
): GradeStep[] {
  const { criterion, status, grade, thresholds, nextTarget } = evaluation;
  if (!criterion || (status !== "graded" && status !== "below_standard"))
    return [];
  const below = belowGradeIntervals(thresholds.flatMap((t) => t.intervals));
  const result: GradeStep[] = [];
  if (grade !== null) {
    const previous = [...thresholds]
      .sort((a, b) => a.grade - b.grade)
      .find((t) => t.grade > grade);
    result.push({
      label: "이전 기준",
      title: previous ? `${previous.grade}등급` : "기준 미달",
      intervals: previous?.intervals ?? below,
    });
  }
  result.push({
    label: "현재",
    title: grade !== null ? `${grade}등급` : "기준 미달",
    intervals:
      grade !== null
        ? thresholds.find((t) => t.grade === grade)!.intervals
        : below,
    current: true,
  });
  if (nextTarget.status === "available")
    result.push({
      label: "다음 목표",
      title: `${nextTarget.grade}등급`,
      intervals: nextTarget.intervals,
    });
  else if (nextTarget.status === "highest_grade")
    result.push({
      label: "현재",
      title: "최고 등급!",
      intervals: [],
      highest: true,
    });
  else result.push({ label: "다음 목표", title: "목표 미제공", intervals: [] });
  return result;
}
