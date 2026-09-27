import { BadRequestException } from '@nestjs/common';

/** Calendar dates only: never interpret a birthday in a client timezone. */
export function koreaDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isCalendarDate(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000')
  )
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseDateOfBirth(value: unknown, now = new Date()): string {
  if (!isCalendarDate(value) || value > koreaDate(now))
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_DATE_OF_BIRTH',
      message: '생년월일은 미래가 아닌 실제 날짜(YYYY-MM-DD)로 입력해 주세요.',
    });
  return value;
}

export function ageOnDate(dateOfBirth: string, today: string): number {
  if (
    !isCalendarDate(dateOfBirth) ||
    !isCalendarDate(today) ||
    dateOfBirth > today
  )
    throw new Error('Invalid age calculation dates');
  return (
    Number(today.slice(0, 4)) -
    Number(dateOfBirth.slice(0, 4)) -
    (today.slice(5) < dateOfBirth.slice(5) ? 1 : 0)
  );
}

export function birthProfile(dateOfBirth: Date | null, now = new Date()) {
  const date = dateOfBirth?.toISOString().slice(0, 10) ?? null;
  return {
    dateOfBirth: date,
    currentAge: date === null ? null : ageOnDate(date, koreaDate(now)),
  };
}
