import { z } from 'zod';
import { STREAK_POLICY_VERSION } from './streak-ticket.js';

// amount on item rows is the fixed fallback seed amount, not an item price.
export const STREAK_POLICY = Object.freeze([
  Object.freeze({ result: 'seeds_1', weight: 600, amount: 1 }),
  Object.freeze({ result: 'seeds_3', weight: 250, amount: 3 }),
  Object.freeze({ result: 'seeds_5', weight: 100, amount: 5 }),
  Object.freeze({ result: 'seeds_10', weight: 43, amount: 10 }),
  Object.freeze({ result: 'clothing', weight: 6, amount: 50 }),
  Object.freeze({ result: 'pose', weight: 1, amount: 70 }),
]);
const schema = z
  .array(
    z.strictObject({
      result: z.enum([
        'seeds_1',
        'seeds_3',
        'seeds_5',
        'seeds_10',
        'clothing',
        'pose',
      ]),
      weight: z.number().int().positive(),
      amount: z.number().int().positive(),
    }),
  )
  .length(6);

export function streakResult(version: string, snapshot: unknown, roll: number) {
  const policy = schema.parse(snapshot);
  if (
    version !== STREAK_POLICY_VERSION ||
    policy.reduce((sum, row) => sum + row.weight, 0) !== 1000 ||
    policy.some(
      (row, i) =>
        row.result !== STREAK_POLICY[i].result ||
        row.weight !== STREAK_POLICY[i].weight ||
        row.amount !== STREAK_POLICY[i].amount,
    )
  ) {
    throw new Error('Unsupported or corrupt personal roulette policy.');
  }
  if (!Number.isInteger(roll) || roll < 0 || roll >= 1000)
    throw new Error('Personal roulette roll must be in [0, 1000).');
  let end = 0;
  for (const row of policy) {
    end += row.weight;
    if (roll < end) return row;
  }
  throw new Error('Invalid personal roulette intervals.');
}

// One uniform index over ALL eligible products, never a slot-first draw.
export function uniformProduct<T>(products: readonly T[], index: number): T {
  if (!Number.isInteger(index) || index < 0 || index >= products.length)
    throw new Error('Invalid product index.');
  return products[index];
}
