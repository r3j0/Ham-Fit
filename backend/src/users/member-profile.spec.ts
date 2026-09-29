import { describe, expect, it } from 'vitest';
import { currentStreak, koreanDay } from './member-profile.js';
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
});
