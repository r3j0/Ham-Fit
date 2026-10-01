import { POSES } from "../components/hamster/poses.ts";
import { DEFAULT_ITEMS } from "../components/hamster/items.ts";
import { resolveHamster } from "../components/hamster/resolve.ts";
import type { HamsterPose, ItemCatalog } from "../components/hamster/types.ts";
import type { AvatarOutfit } from "./avatar-outfit.ts";

export function avatarRenderSelection(rendering: AvatarOutfit["rendering"]) {
  return {
    variant: rendering.variant,
    pose: rendering.pose as HamsterPose,
    ...Object.fromEntries(
      rendering.clothing.map((item) => [item.slot, item.renderKey]),
    ),
  };
}

export function canRenderAvatar(rendering: AvatarOutfit["rendering"]) {
  return (
    Object.hasOwn(POSES, rendering.pose) &&
    resolveHamster(avatarRenderSelection(rendering), DEFAULT_ITEMS).warnings
      .length === 0
  );
}

export function clothingAsset(renderKey: string) {
  return Object.hasOwn(DEFAULT_ITEMS, renderKey)
    ? (DEFAULT_ITEMS as ItemCatalog)[renderKey]
    : undefined;
}

const retiredSportswear = new Set([
  "blue-sportswear",
  "black-sportswear",
  "white-sportswear",
  "green-sportswear",
]);
export function isExcludedSportswear(renderKey: string) {
  return retiredSportswear.has(renderKey.replace(/^clothing\./, ""));
}
