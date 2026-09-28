/** Presentation of server grades. Only axis order and display geometry are local. */
export const fitnessFactors = [
  { code: "cardiorespiratory_endurance", label: "심폐지구력" },
  { code: "strength", label: "근력" },
  { code: "muscular_endurance", label: "근지구력" },
  { code: "flexibility", label: "유연성" },
  { code: "agility", label: "민첩성" },
  { code: "power", label: "순발력" },
] as const;
export type FitnessFactor = (typeof fitnessFactors)[number]["code"];
// Individual test thresholds are distinct from an overall certification (1–6).
export type TestGrade = 1 | 2 | 3;
export type GradeResult =
  | { status: "evaluated"; grade: TestGrade; reason: string | null }
  | {
      status:
        | "below_standard"
        | "missing_input"
        | "unsupported_rule"
        | "not_measured"
        | "unevaluable"
        | "not_evaluated";
      grade: null;
      reason: string | null;
    };
export type FitnessAxis = GradeResult & {
  factor: FitnessFactor;
  sourceMeasurementCodes: string[];
};
export function safeSourceUrl(v: unknown): v is string {
  if (typeof v !== "string" || !v.length || v.length > 5000) return false;
  try {
    const url = new URL(v);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function gradeLabel(result: GradeResult) {
  switch (result.status) {
    case "evaluated":
      return `${result.grade}등급`;
    case "below_standard":
      return "기준 미달";
    case "missing_input":
      return "평가 불가 · 정보 부족";
    case "unsupported_rule":
      return "평가 불가 · 기준 없음";
    case "unevaluable":
      return "평가 불가";
    case "not_evaluated":
      return "평가 미존재 · 미평가";
    case "not_measured":
      return "평가 미존재 · 미측정";
  }
}
/** Ordinal display positions only, never stored or sent as scores/grades. */
export function gradeRadius(result: GradeResult) {
  return result.status === "evaluated"
    ? (5 - result.grade) / 4
    : result.status === "below_standard"
      ? 0.25
      : 0;
}
export function radarPoint(index: number, radius: number) {
  const angle = (index * Math.PI) / 3 - Math.PI / 2;
  const round = (v: number) => Number(v.toFixed(3));
  return {
    x: round(180 + Math.cos(angle) * 108 * radius),
    y: round(158 + Math.sin(angle) * 108 * radius),
  };
}
export function radarGeometry(axes: readonly FitnessAxis[]) {
  const points = fitnessFactors.map((f, index) => {
    const axis = axes.find((a) => a.factor === f.code);
    if (!axis) throw new Error("체력 프로필의 여섯 축을 확인하지 못했어요.");
    return { ...radarPoint(index, gradeRadius(axis)), factor: f.code };
  });
  return {
    points,
    path:
      points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") + " Z",
  };
}
