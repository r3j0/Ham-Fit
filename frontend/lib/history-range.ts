export type HistoryRange = { from: string; to: string };
export const historyRangeQuery = (range?: HistoryRange) =>
  range
    ? `&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
    : "";
