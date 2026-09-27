/** Date-only input; age eligibility is determined by the server in Korea time. */
export function birthDateError(
  value: string,
  today: string,
): string | undefined {
  if (!value) return "생년월일을 입력해 주세요.";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000") ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    value > today
  )
    return "미래가 아닌 실제 생년월일을 입력해 주세요.";
}
