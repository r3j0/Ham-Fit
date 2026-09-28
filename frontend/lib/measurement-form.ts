import type { Catalog, Measurement, MeasurementInput } from "./types.ts";
/** Retire adult self curl-ups only; official youth curl_up remains supported. */
export const isRetiredMeasurement = (code: string) => code === "self_curl_up";
export interface FormMetadata {
  measuredOn: string;
  age: string;
  sex: string;
  kind: "standard" | "simple" | "unknown";
  center: string;
  grade: string;
}
export interface FormItem {
  code: string;
  value: string;
  grade: string;
}
export const emptyMetadata: FormMetadata = {
  measuredOn: "",
  age: "",
  sex: "",
  kind: "unknown",
  center: "",
  grade: "",
};
export function metadataFrom(record: Measurement): FormMetadata {
  return {
    measuredOn: record.measuredOn,
    age: String(record.ageAtMeasurement),
    sex: record.sexAtMeasurement ?? "",
    kind: record.reportKind,
    center: record.centerName ?? "",
    grade: record.reportedOverallGrade ?? "",
  };
}
export function validateMetadata(
  meta: FormMetadata,
  today: string,
  { requireSex = false }: { requireSex?: boolean } = {},
) {
  const errors: Record<string, string> = {};
  const date = new Date(`${meta.measuredOn}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(meta.measuredOn) ||
    meta.measuredOn.startsWith("0000") ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== meta.measuredOn
  )
    errors.measuredOn = "실제로 측정한 날짜를 입력해 주세요.";
  else if (meta.measuredOn > today)
    errors.measuredOn = "미래 날짜는 입력할 수 없어요.";
  if (
    !/^\d{1,2}$/.test(meta.age) ||
    Number(meta.age) < 13 ||
    Number(meta.age) > 64
  )
    errors.ageAtMeasurement = "측정 당시 만 나이를 13~64세로 입력해 주세요.";
  if (requireSex && meta.sex !== "male" && meta.sex !== "female")
    errors.sexAtMeasurement = "성별을 선택해 주세요.";
  if (meta.center.trim().length > 200)
    errors.centerName = "센터명은 200자까지 입력할 수 있어요.";
  if (meta.grade.trim().length > 100)
    errors.reportedOverallGrade = "등급은 100자까지 입력할 수 있어요.";
  return errors;
}
// Compare decimal strings without converting measurement values through floating point.
export function compareDecimal(left: string, right: string): number {
  function parts(value: string) {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const integer = whole.replace(/^0+(?=\d)/, ""),
      decimals = fraction.replace(/0+$/, "");
    return {
      negative: negative && (integer !== "0" || decimals !== ""),
      integer,
      decimals,
    };
  }
  const a = parts(left),
    b = parts(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const sign = a.negative ? -1 : 1;
  if (a.integer.length !== b.integer.length)
    return Math.sign(a.integer.length - b.integer.length) * sign;
  if (a.integer !== b.integer) return (a.integer > b.integer ? 1 : -1) * sign;
  const length = Math.max(a.decimals.length, b.decimals.length);
  const af = a.decimals.padEnd(length, "0"),
    bf = b.decimals.padEnd(length, "0");
  return af === bf ? 0 : (af > bf ? 1 : -1) * sign;
}
export function buildInput(
  meta: FormMetadata,
  items: FormItem[],
  catalog: Catalog,
  today: string,
  options: { requireSex?: boolean } = {},
): { errors: Record<string, string>; input: MeasurementInput } {
  const errors = validateMetadata(meta, today, options);
  const saved = items.filter((i) => i.value !== "");
  if (!saved.length) errors.items = "측정값을 하나 이상 입력해 주세요.";
  const seen = new Set<string>();
  for (const item of saved) {
    const definition = catalog.definitions.find((d) => d.code === item.code),
      field = `item.${item.code}`;
    if (!definition || seen.has(item.code)) {
      errors[field] = "지원하지 않거나 중복된 검사 항목이에요.";
      continue;
    }
    seen.add(item.code);
    if (
      Number(meta.age) < definition.minAge ||
      Number(meta.age) > definition.maxAge
    )
      errors[field] =
        `이 검사는 만 ${definition.minAge}~${definition.maxAge}세에 적용돼요. 항목을 삭제하거나 나이를 확인해 주세요.`;
    else if (
      item.value.length > 128 ||
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(item.value)
    )
      errors[field] =
        "공백 없이 숫자를 입력해 주세요. 소수점과 음수 기호를 사용할 수 있어요.";
    else if (
      definition.valueType === "integer" &&
      !/^-?\d+(?:\.0+)?$/.test(item.value)
    )
      errors[field] = "횟수는 정수로 입력해 주세요.";
    else if (
      definition.minValue !== null &&
      (compareDecimal(item.value, definition.minValue) < 0 ||
        (!definition.minInclusive &&
          compareDecimal(item.value, definition.minValue) === 0))
    )
      errors[field] =
        `${definition.minValue} ${definition.minInclusive ? "이상" : "초과"}의 값을 입력해 주세요.`;
    else if (
      definition.maxValue !== null &&
      compareDecimal(item.value, definition.maxValue) > 0
    )
      errors[field] = `${definition.maxValue} 이하의 값을 입력해 주세요.`;
    if (item.grade.trim().length > 100)
      errors[`grade.${item.code}`] = "등급은 100자까지 입력할 수 있어요.";
  }
  for (const item of items)
    if (!item.value && item.grade.trim())
      errors[`item.${item.code}`] = "등급을 저장하려면 측정값도 입력해 주세요.";
  return {
    errors,
    input: {
      catalogVersion: catalog.version,
      measuredOn: meta.measuredOn,
      ageAtMeasurement: Number(meta.age),
      sexAtMeasurement:
        meta.sex === "male" || meta.sex === "female" ? meta.sex : null,
      reportKind: meta.kind,
      centerName: meta.center.trim() || null,
      reportedOverallGrade: meta.grade.trim() || null,
      items: saved.map((item) => ({
        measurementCode: item.code,
        value: item.value,
        unit: catalog.definitions.find((d) => d.code === item.code)?.unit ?? "",
        reportedGrade: item.grade.trim() || null,
      })),
    },
  };
}
