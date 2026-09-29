import { describe, expect, it } from 'vitest';
import { activityStats, currentStreak, koreanDay } from './member-profile.js';
describe('personal and group streak rule', () => {
  it('uses KST completion dates at midnight and calendar/leap boundaries', () => {
    expect(koreanDay(new Date('2026-09-29T14:59:59Z'))).toBe('2026-09-29');
    expect(koreanDay(new Date('2026-09-29T15:00:00Z'))).toBe('2026-09-30');
    expect(
      currentStreak(new Set(['2024-02-28', '2024-02-29']), '2024-03-01'),
    ).toBe(2);
    expect(
      currentStreak(new Set(['2025-12-31', '2026-01-01']), '2026-01-01'),
    ).toBe(2);
  });
  it('counts unique consecutive days, preserves yesterday, ignores future and stops at gaps', () => {
    const days = new Set([
      '2026-09-25',
      '2026-09-27',
      '2026-09-28',
      '2026-09-30',
    ]);
    expect(currentStreak(days, '2026-09-29')).toBe(2);
    expect(currentStreak(days, '2026-10-02')).toBe(0);
    expect(currentStreak(new Set(), '2026-09-29')).toBe(0);
  });
  it('counts all unique days and the longest run independently of the current run', () => {
    const days = new Set([
      '2026-09-24',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-28',
      '2026-09-30',
    ]);
    expect(activityStats(days, '2026-09-29')).toEqual({
      streak: 1,
      longestStreak: 3,
      totalWorkoutDays: 4,
    });
    expect(activityStats(days, '2026-10-02')).toEqual({
      streak: 0,
      longestStreak: 3,
      totalWorkoutDays: 5,
    });
    expect(activityStats(new Set(), '2026-09-29')).toEqual({
      streak: 0,
      longestStreak: 0,
      totalWorkoutDays: 0,
    });
    expect(
      activityStats(
        new Set(['2024-02-28', '2024-02-29', '2024-03-01']),
        '2024-03-01',
      ),
    ).toEqual({ streak: 3, longestStreak: 3, totalWorkoutDays: 3 });
  });
});
