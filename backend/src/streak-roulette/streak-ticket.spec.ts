import { describe, expect, it } from 'vitest';
import { streakMilestone } from './streak-ticket.js';
import { koreanDay } from '../users/member-profile.js';

const daysEnding = (day: string, count: number) =>
  new Set(
    Array.from({ length: count }, (_, i) =>
      new Date(Date.parse(`${day}T00:00:00Z`) - i * 86_400_000)
        .toISOString()
        .slice(0, 10),
    ),
  );
describe('actual streak milestones', () => {
  it.each([4, 5, 9, 10, 15, 20])(
    'rewards only each fifth actual day (%i)',
    (n) => {
      expect(
        streakMilestone(daysEnding('2026-10-01', n), '2026-10-01')
          ?.streakDays ?? null,
      ).toBe(n % 5 === 0 ? n : null);
    },
  );
  it('does not reward yesterday grace, total days or longest streak', () => {
    const days = daysEnding('2026-09-30', 15);
    expect(streakMilestone(days, '2026-10-01')).toBeNull();
    days.add('2026-10-02');
    expect(streakMilestone(days, '2026-10-02')).toBeNull();
  });
  it.each(['2024-03-01', '2027-01-02', '2026-05-02'])(
    'uses calendar days across %s',
    (end) => {
      expect(streakMilestone(daysEnding(end, 5), end)).toEqual({
        segmentStartDate: [...daysEnding(end, 5)].at(-1),
        streakDays: 5,
      });
    },
  );
  it('switches KST day at 15:00 UTC', () => {
    expect(koreanDay(new Date('2026-12-31T14:59:59.999Z'))).toBe('2026-12-31');
    expect(koreanDay(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });
});
