import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAvatarOutfit } from "../../lib/avatar-outfit.ts";

const outfit = () => ({
  characterId: "character.gray",
  poseId: "pose.run",
  clothingIds: [],
  revision: 2,
  updatedAt: "2026-09-30T03:00:00Z",
  rendering: { variant: "gray", pose: "run", clothing: [] },
});
test("saved representative character uses server rendering identifiers", () => {
  assert.deepEqual(parseAvatarOutfit(outfit()), outfit());
});
test("unsupported assets, mismatched identifiers and incomplete outfits fail closed", () => {
  for (const patch of [
    { characterId: "character.cream" },
    { poseId: "pose.basic" },
    { revision: 0 },
    { updatedAt: "invalid" },
    { clothingIds: ["clothing.unknown"] },
    { rendering: { variant: "gray", pose: "phone", clothing: [] } },
    { rendering: { variant: "gray", pose: "run", clothing: ["unknown"] } },
  ])
    assert.throws(() => parseAvatarOutfit({ ...outfit(), ...patch }));
  assert.throws(() => parseAvatarOutfit(null));
});
