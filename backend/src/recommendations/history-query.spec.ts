import { describe, expect, it } from 'vitest';
import { historyBounds, parseHistoryQuery } from './history-query.js';

describe('bounded workout history query', () => {
  it('preserves the original unbounded pagination contract for older clients', () => {
    expect(parseHistoryQuery({})).toEqual({ limit: 20, range: undefined });
  });
  it.each([
    { from: '2026-10-01' },
    { to: '2026-10-01' },
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-10-02', to: '2026-10-01' },
    { from: '2026-01-01', to: '2026-03-04' },
    { from: '2026-10-01', to: '2026-10-01', limit: 51 },
    { from: '2026-10-01', to: '2026-10-01', unexpected: 'x' },
  ])('rejects incomplete, invalid or oversized windows: %j', (query) => {
    expect(() => parseHistoryQuery(query)).toThrow();
  });
  it('includes exactly the requested Korea dates without including next midnight', () => {
    const { range } = parseHistoryQuery({
      from: '2026-09-30',
      to: '2026-10-01',
    });
    expect(historyBounds(range!)).toEqual({
      assignmentDate: {
        gte: new Date('2026-09-30T00:00:00Z'),
        lte: new Date('2026-10-01T00:00:00Z'),
      },
      completedAt: {
        gte: new Date('2026-09-29T15:00:00Z'),
        lt: new Date('2026-10-01T15:00:00Z'),
      },
    });
    expect(
      parseHistoryQuery({ from: '2026-01-01', to: '2026-03-03' }).range,
    ).toBeDefined();
  });
});
