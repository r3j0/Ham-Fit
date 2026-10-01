import type {
  HamsterPose,
  HamsterVariant,
} from "../components/hamster/types.ts";

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function selectWelcomeMascots(
  poses: readonly HamsterPose[],
  random: () => number,
) {
  const available = [...new Set(poses)].filter((pose) => pose !== "basic");
  if (available.length < 4)
    throw new Error("Four distinct non-basic poses are required");
  const selected = shuffled(available, random).slice(0, 4);
  const variants = shuffled<HamsterVariant>(
    ["cream", "cream", "gray", "gray"],
    random,
  );
  return selected.map((pose, index) => ({ pose, variant: variants[index] }));
}
