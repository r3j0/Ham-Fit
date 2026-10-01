import { describe, expect, it } from 'vitest';
import {
  MISSION_POLICY_VERSION,
  missionStage,
  roulettePolicy,
  rouletteResult,
  ticketCount,
  validatedPolicy,
} from './mission-policy.js';

describe('frozen sunflower policy', () => {
  it.each([
    [0, 'seed'],
    [1, 'seed'],
    [2, 'sprout'],
    [5, 'sprout'],
    [6, 'stem'],
    [13, 'stem'],
    [14, 'bud'],
    [27, 'bud'],
    [28, 'sunflower'],
  ])('water %i with N=2 is %s', (water, stage) => {
    expect(missionStage(water as number, 2)).toBe(stage);
  });
  it.each([
    [6, 0],
    [7, 1],
    [14, 2],
    [20, 2],
    [21, 3],
  ])('mints %i water into %i tickets', (water, count) => {
    expect(ticketCount(water)).toBe(count);
  });
  it.each([
    [0, 'self_1'],
    [49, 'self_1'],
    [50, 'self_3'],
    [74, 'self_3'],
    [75, 'self_5'],
    [87, 'self_5'],
    [88, 'self_7'],
    [94, 'self_7'],
    [95, 'contributors_3'],
    [98, 'contributors_3'],
    [99, 'contributors_7'],
  ])('roll %i produces %s', (roll, result) => {
    expect(
      rouletteResult(MISSION_POLICY_VERSION, roulettePolicy, roll as number)
        .result,
    ).toBe(result);
  });
  it('validates all probabilities and rejects corrupted versions/snapshots/randomness', () => {
    expect(roulettePolicy.reduce((sum, row) => sum + row.weight, 0)).toBe(100);
    for (const roll of [-1, 100, 1.2, NaN])
      expect(() =>
        rouletteResult(MISSION_POLICY_VERSION, roulettePolicy, roll),
      ).toThrow();
    expect(() => validatedPolicy('unknown', roulettePolicy)).toThrow();
    expect(() =>
      validatedPolicy(
        MISSION_POLICY_VERSION,
        roulettePolicy.map((row, i) => ({
          ...row,
          weight: i ? row.weight : 51,
        })),
      ),
    ).toThrow();
    expect(() =>
      validatedPolicy(
        MISSION_POLICY_VERSION,
        roulettePolicy.map((row) => ({ ...row, amount: 7 })),
      ),
    ).toThrow();
  });
});
