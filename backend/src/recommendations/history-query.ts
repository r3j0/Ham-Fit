import { z } from 'zod';
import { isCalendarDate } from '../users/date-of-birth.js';
import { playbackInvalid } from './playback.js';

export type HistoryRange = { from: string; to: string };

export function parseHistoryQuery(query: unknown) {
  const parsed = z
    .strictObject({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.uuid().optional(),
      from: z.string().refine(isCalendarDate).optional(),
      to: z.string().refine(isCalendarDate).optional(),
    })
    .safeParse(query);
  if (!parsed.success) playbackInvalid('이력 조회 조건을 확인해 주세요.');
  const { from, to, ...page } = parsed.data;
  if (from === undefined && to === undefined)
    return { ...page, range: undefined };
  if (
    !from ||
    !to ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 62
  )
    playbackInvalid(
      '조회 시작일과 종료일을 모두 지정하고 62일 이내로 조회해 주세요.',
    );
  return { ...page, range: { from, to } };
}

// Assignment dates are SQL dates; actual completions are instants in Korea time.
// Include both so an older assignment completed later remains on that calendar day.
export function historyBounds(range: HistoryRange) {
  return {
    assignmentDate: {
      gte: new Date(`${range.from}T00:00:00Z`),
      lte: new Date(`${range.to}T00:00:00Z`),
    },
    completedAt: {
      gte: new Date(`${range.from}T00:00:00+09:00`),
      lt: new Date(Date.parse(`${range.to}T00:00:00+09:00`) + 86_400_000),
    },
  };
}
