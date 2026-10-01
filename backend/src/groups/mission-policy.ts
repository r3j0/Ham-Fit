import { z } from 'zod';

export const MISSION_POLICY_VERSION = 'sunflower-2026-09-30-v1';
export const roulettePolicy = [
  { result: 'self_1', weight: 50, amount: 1, audience: 'self' },
  { result: 'self_3', weight: 25, amount: 3, audience: 'self' },
  { result: 'self_5', weight: 13, amount: 5, audience: 'self' },
  { result: 'self_7', weight: 7, amount: 7, audience: 'self' },
  { result: 'contributors_3', weight: 4, amount: 3, audience: 'contributors' },
  { result: 'contributors_7', weight: 1, amount: 7, audience: 'contributors' },
];
const policySchema = z
  .array(
    z.strictObject({
      result: z.enum([
        'self_1',
        'self_3',
        'self_5',
        'self_7',
        'contributors_3',
        'contributors_7',
      ]),
      weight: z.number().int().positive(),
      amount: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7)]),
      audience: z.enum(['self', 'contributors']),
    }),
  )
  .length(6);

export function validatedPolicy(version: string, snapshot: unknown) {
  const policy = policySchema.parse(snapshot);
  // New versions must be explicitly registered; retained rounds use their own
  // immutable snapshot, never the current default policy.
  if (
    version !== MISSION_POLICY_VERSION ||
    policy.reduce((sum, entry) => sum + entry.weight, 0) !== 100 ||
    policy.some((entry, i) =>
      Object.entries(entry).some(
        ([key, value]) =>
          value !== roulettePolicy[i][key as keyof typeof entry],
      ),
    )
  )
    throw new Error('Unsupported or corrupt roulette policy.');
  return policy;
}
export function rouletteResult(
  version: string,
  snapshot: unknown,
  roll: number,
) {
  const policy = validatedPolicy(version, snapshot);
  if (!Number.isInteger(roll) || roll < 0 || roll >= 100)
    throw new Error('Roulette roll must be an integer in [0, 100).');
  let end = 0;
  for (const entry of policy) {
    end += entry.weight;
    if (roll < end) return entry;
  }
  throw new Error('Invalid roulette intervals.');
}
export function missionStage(water: number, members: number) {
  if (water >= 14 * members) return 'sunflower';
  if (water >= 7 * members) return 'bud';
  if (water >= 3 * members) return 'stem';
  if (water >= members) return 'sprout';
  return 'seed';
}
export const ticketCount = (water: number) => Math.floor(water / 7);
