import { describe, expect, it } from 'vitest';
import { STREAK_POLICY_VERSION } from './streak-ticket.js';
import {
  STREAK_POLICY,
  streakResult,
  uniformProduct,
} from './streak-policy.js';

describe('fixed personal roulette policy', () => {
  it.each([
    [0, 'seeds_1'],
    [599, 'seeds_1'],
    [600, 'seeds_3'],
    [849, 'seeds_3'],
    [850, 'seeds_5'],
    [949, 'seeds_5'],
    [950, 'seeds_10'],
    [992, 'seeds_10'],
    [993, 'clothing'],
    [998, 'clothing'],
    [999, 'pose'],
  ])('maps boundary %i to %s', (roll, result) => {
    expect(
      streakResult(STREAK_POLICY_VERSION, STREAK_POLICY, roll as number).result,
    ).toBe(result);
  });
  it('has exactly the prescribed integer weights and grants over all 1000 outcomes', () => {
    const counts = new Map<string, number>();
    for (let roll = 0; roll < 1000; roll++) {
      const row = streakResult(STREAK_POLICY_VERSION, STREAK_POLICY, roll);
      counts.set(row.result, (counts.get(row.result) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([600, 250, 100, 43, 6, 1]);
    expect(STREAK_POLICY.map((row) => row.amount)).toEqual([
      1, 3, 5, 10, 50, 70,
    ]);
  });
  it('rejects unknown/mutated policy, amount, kind, sum, order, and invalid rolls', () => {
    expect(() => streakResult('unknown', STREAK_POLICY, 0)).toThrow();
    for (const patch of [
      { amount: 999 },
      { weight: 601 },
      { result: 'contributors_7' },
    ]) {
      expect(() =>
        streakResult(
          STREAK_POLICY_VERSION,
          STREAK_POLICY.map((row, i) => (i === 0 ? { ...row, ...patch } : row)),
          0,
        ),
      ).toThrow();
    }
    expect(() =>
      streakResult(STREAK_POLICY_VERSION, [...STREAK_POLICY].reverse(), 0),
    ).toThrow();
    for (const roll of [-1, 1000, NaN, Infinity, 0.5])
      expect(() =>
        streakResult(STREAK_POLICY_VERSION, STREAK_POLICY, roll),
      ).toThrow();
  });
  it('selects each product once over indices even with uneven clothing slots', () => {
    const products = [
      { id: 'hat1', slot: 'hat' },
      { id: 'hat2', slot: 'hat' },
      { id: 'top1', slot: 'top' },
      { id: 'bottom1', slot: 'bottom' },
    ];
    expect(products.map((_, i) => uniformProduct(products, i).id)).toEqual([
      'hat1',
      'hat2',
      'top1',
      'bottom1',
    ]);
    for (const index of [-1, 4, 0.1])
      expect(() => uniformProduct(products, index)).toThrow();
    expect(() => uniformProduct([], 0)).toThrow();
  });
});
