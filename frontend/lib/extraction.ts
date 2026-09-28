import type { FormItem, FormMetadata } from "./measurement-form.ts";
export const extractionStatuses = [
  "extracted",
  "partial",
  "needs_review",
  "not_target",
  "unreadable",
  "grades_only",
  "mixed_sessions",
  "multiple_people",
  "unsupported_age",
] as const;
type Evidence = {
  label: string | null;
  value: string | null;
  unit: string | null;
};
export interface ExtractionDraft {
  catalogVersion: string;
  status: (typeof extractionStatuses)[number];
  metadata: {
    measuredOn: string | null;
    ageAtMeasurement: number | null;
    sexAtMeasurement: "male" | "female" | null;
    centerName: string | null;
    reportedOverallGrade: string | null;
  };
  items: {
    measurementCode: string;
    value: string;
    unit: string;
    reportedGrade: string | null;
    evidence: Evidence;
  }[];
  reviewItems: {
    measurementCode: string | null;
    value: string | null;
    unit: string | null;
    reportedGrade: string | null;
    evidence: Evidence;
    reasons: string[];
  }[];
  issues: { code: string; field: string; requiresInput: boolean }[];
  notDetectedMeasurementCodes: string[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nullableText = (v: unknown) =>
  v === null || (typeof v === "string" && v.length <= 1000);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 100 &&
  v.every((s) => typeof s === "string" && s.length <= 1000);
const evidence = (v: unknown) =>
  object(v) && [v.label, v.value, v.unit].every(nullableText);
export function parseExtraction(value: unknown): ExtractionDraft {
  const invalid = () => {
    throw new Error("사진 분석 응답을 확인하지 못했어요. 다시 시도해 주세요.");
  };
  if (
    !object(value) ||
    typeof value.catalogVersion !== "string" ||
    !value.catalogVersion ||
    !extractionStatuses.includes(value.status as ExtractionDraft["status"]) ||
    !object(value.metadata)
  )
    return invalid();
  const meta = value.metadata;
  if (
    ![meta.measuredOn, meta.centerName, meta.reportedOverallGrade].every(
      nullableText,
    ) ||
    !(
      meta.ageAtMeasurement === null || Number.isInteger(meta.ageAtMeasurement)
    ) ||
    ![null, "male", "female"].includes(meta.sexAtMeasurement as never)
  )
    return invalid();
  if (
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !value.items.every(
      (i) =>
        object(i) &&
        typeof i.measurementCode === "string" &&
        typeof i.value === "string" &&
        i.value.length <= 128 &&
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(i.value) &&
        typeof i.unit === "string" &&
        nullableText(i.reportedGrade) &&
        evidence(i.evidence),
    )
  )
    return invalid();
  if (
    new Set(value.items.map((i) => i.measurementCode)).size !==
    value.items.length
  )
    return invalid();
  if (
    !Array.isArray(value.reviewItems) ||
    value.reviewItems.length > 100 ||
    !value.reviewItems.every(
      (i) =>
        object(i) &&
        [i.measurementCode, i.value, i.unit, i.reportedGrade].every(
          nullableText,
        ) &&
        evidence(i.evidence) &&
        strings(i.reasons),
    )
  )
    return invalid();
  if (
    !Array.isArray(value.issues) ||
    value.issues.length > 100 ||
    !value.issues.every(
      (i) =>
        object(i) &&
        typeof i.code === "string" &&
        typeof i.field === "string" &&
        typeof i.requiresInput === "boolean",
    ) ||
    !strings(value.notDetectedMeasurementCodes)
  )
    return invalid();
  return value as unknown as ExtractionDraft;
}
export const extractionStatusText: Record<ExtractionDraft["status"], string> = {
  extracted: "측정값을 읽었어요. 결과표와 비교한 뒤 저장해 주세요.",
  partial: "일부 내용을 확인해야 해요. 읽은 값과 누락 정보를 확인해 주세요.",
  needs_review:
    "확인 가능한 측정값이 없어요. 결과표를 보며 직접 입력해 주세요.",
  not_target:
    "국민체력100 결과표를 확인하지 못했어요. 다른 사진을 선택해 주세요.",
  unreadable: "사진을 읽기 어려워요. 선명한 사진으로 다시 선택해 주세요.",
  grades_only: "등급만 확인됐어요. 기록을 저장하려면 실제 측정값이 필요해요.",
  mixed_sessions:
    "여러 측정 회차가 섞여 있어요. 한 회차만 보이도록 사진을 선택해 주세요.",
  multiple_people:
    "여러 사람의 결과가 섞여 있어요. 본인의 결과만 선택해 주세요.",
  unsupported_age: "지원하는 측정 연령(만 13~64세)의 결과표가 아니에요.",
};
export function canReviewExtraction(draft: ExtractionDraft) {
  return ["extracted", "partial", "needs_review", "grades_only"].includes(
    draft.status,
  );
}
export function extractionSeed(draft: ExtractionDraft): {
  meta: FormMetadata;
  items: FormItem[];
  catalogVersion: string;
  extractionNotes: string[];
} {
  if (!canReviewExtraction(draft))
    throw new Error("이 분석 결과로 기록을 만들 수 없어요.");
  return {
    catalogVersion: draft.catalogVersion,
    meta: {
      measuredOn: draft.metadata.measuredOn ?? "",
      age: draft.metadata.ageAtMeasurement?.toString() ?? "",
      sex: draft.metadata.sexAtMeasurement ?? "",
      kind: "unknown",
      center: draft.metadata.centerName ?? "",
      grade: draft.metadata.reportedOverallGrade ?? "",
    },
    items: draft.items.map((i) => ({
      code: i.measurementCode,
      value: i.value,
      grade: i.reportedGrade ?? "",
    })),
    extractionNotes: draft.reviewItems.map(
      (i) =>
        `${i.evidence.label ?? "확인할 항목"}: ${i.evidence.value ?? "판독 불가"} ${i.evidence.unit ?? "단위 미확인"} — 자동 입력에서 제외됐어요. 결과표와 대조한 뒤 필요한 항목을 직접 추가해 주세요.`,
    ),
  };
}
