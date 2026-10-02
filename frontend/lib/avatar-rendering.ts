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

export function canRenderAvatar(
  rendering: AvatarOutfit["rendering"],
  catalog: ItemCatalog = DEFAULT_ITEMS,
) {
  return (
    Object.hasOwn(POSES, rendering.pose) &&
    resolveHamster(avatarRenderSelection(rendering), catalog).warnings
      .length === 0
  );
}

/** Keep the whole outfit when a scene's pose has no matching garment artwork. */
export function avatarSceneRendering(
  rendering: AvatarOutfit["rendering"],
  pose: HamsterPose | undefined,
  catalog: ItemCatalog,
) {
  const scene = { ...rendering, pose: pose ?? rendering.pose };
  if (canRenderAvatar(scene, catalog)) return scene;
  return canRenderAvatar(rendering, catalog) ? rendering : null;
}

export function clothingAsset(
  renderKey: string,
  catalog: ItemCatalog = DEFAULT_ITEMS,
) {
  return Object.hasOwn(catalog, renderKey) ? catalog[renderKey] : undefined;
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
