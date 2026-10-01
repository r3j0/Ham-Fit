import { invalid, integer, object, timestamp, text } from "./api-contract.ts";
import { POSES } from "../components/hamster/poses.ts";
import type {
  HamsterPose,
  HamsterVariant,
} from "../components/hamster/types.ts";

// Keep BE's legacy a-plus readable so its owner can change their saved outfit.
// There is no v2 artwork for it; rendering support is checked separately.
export const avatarPoses = [...Object.keys(POSES), "a-plus"];
export interface AvatarOutfit {
  characterId: string;
  poseId: string;
  clothingIds: string[];
  revision: number;
  updatedAt: string;
  rendering: {
    variant: HamsterVariant;
    pose: HamsterPose | "a-plus";
    clothing: AvatarClothing[];
  };
}
export interface AvatarClothing {
  productId: string;
  slot: "hat" | "top" | "bottom";
  renderKey: string;
  occupiesSlots: ("hat" | "top" | "bottom")[];
}
export function parseAvatarClothing(value: unknown): AvatarClothing {
  const row = object(value);
  if (
    !text(row.productId) ||
    !text(row.renderKey) ||
    !["hat", "top", "bottom"].includes(String(row.slot)) ||
    !Array.isArray(row.occupiesSlots) ||
    !row.occupiesSlots.length ||
    !row.occupiesSlots.includes(row.slot) ||
    !row.occupiesSlots.every((s) => ["hat", "top", "bottom"].includes(s)) ||
    new Set(row.occupiesSlots).size !== row.occupiesSlots.length
  )
    invalid();
  return row as unknown as AvatarClothing;
}

/** Validate the server contract; artwork support is checked separately. */
export function parseAvatarOutfit(value: unknown): AvatarOutfit {
  const row = object(value),
    rendering = object(row.rendering);
  if (
    !["cream", "gray"].includes(String(rendering.variant)) ||
    !avatarPoses.includes(String(rendering.pose)) ||
    row.characterId !== `character.${rendering.variant}` ||
    row.poseId !== `pose.${rendering.pose}` ||
    !Array.isArray(row.clothingIds) ||
    !row.clothingIds.every(text) ||
    new Set(row.clothingIds).size !== row.clothingIds.length ||
    !Array.isArray(rendering.clothing) ||
    !integer(row.revision, 1) ||
    !timestamp(row.updatedAt)
  )
    invalid();
  const clothing = rendering.clothing.map(parseAvatarClothing);
  const ids = clothing.map((c) => c.productId);
  const slots = clothing.flatMap((c) => c.occupiesSlots);
  if (
    ids.length !== row.clothingIds.length ||
    new Set(ids).size !== ids.length ||
    !row.clothingIds.every((id) => ids.includes(id)) ||
    new Set(slots).size !== slots.length
  )
    invalid();
  return row as unknown as AvatarOutfit;
}
