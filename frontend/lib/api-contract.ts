/** Runtime checks for API data. Invalid responses must never become empty success states. */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function invalid(): never {
  throw new Error("서버 응답을 확인할 수 없어요. 다시 불러와 주세요.");
}
export function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
export function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
  );
}
export function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
export function number(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min;
}
export function integer(value: unknown, min = 0): value is number {
  return number(value, min) && Number.isSafeInteger(value);
}
export function pageOf<T>(
  value: unknown,
  parse: (item: unknown) => T,
): { items: T[]; nextCursor: string | null } {
  const page = object(value);
  if (
    !Array.isArray(page.items) ||
    !(page.nextCursor === null || uuid(page.nextCursor))
  )
    invalid();
  return {
    items: page.items.map((item) => parse(item)),
    nextCursor: page.nextCursor,
  };
}
